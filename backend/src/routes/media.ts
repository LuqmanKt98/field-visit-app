import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { haversineDistanceMeters, headingToCardinal } from '../utils/geo';
import { createPresignedUploadUrl, headUploadedObject, taskFolderUrl } from '../services/s3Service';
import {
    getTaskById,
    getTaskMedia,
    insertTaskMedia,
    setTaskCloudUrl,
    setTaskStatus,
} from '../services/taskService';
import { TaskStatus } from '../types';
import { contentTypeMatchesMedia, fileNameFor } from '../utils/mediaTypes';
import { isValidTaskId } from '../utils/taskId';

export const mediaRouter = Router();

// The client's clock is an allowance for skew, not a free-text field: a capture time
// far from server time would otherwise let the audit trail be back- or post-dated
// arbitrarily. Outside the window we record when the server actually saw the upload.
const CLOCK_SKEW_ALLOWANCE_MS = 15 * 60 * 1000;

function resolveCapturedAt(clientValue: string | undefined): Date {
    const now = Date.now();
    if (!clientValue) return new Date(now);
    const claimed = new Date(clientValue);
    if (Number.isNaN(claimed.getTime())) return new Date(now);
    return Math.abs(now - claimed.getTime()) > CLOCK_SKEW_ALLOWANCE_MS ? new Date(now) : claimed;
}

async function assertUploadAllowed(taskId: string, latitude: number, longitude: number) {
    if (!isValidTaskId(taskId)) {
        return { error: { status: 400, body: { error: 'taskId must be numeric' } } };
    }

    const task = await getTaskById(taskId);
    if (!task) {
        return { error: { status: 404, body: { error: `No task found for ID ${taskId}` } } };
    }
    if (task.task_status === TaskStatus.Completed) {
        return { error: { status: 409, body: { error: 'This task has already been completed' } } };
    }

    if (config.fieldVisit.enforceServerSideDistanceCheck) {
        // Note the explicit null/blank test before Number(): Number(null) is 0, not NaN,
        // so a finite-check alone would silently treat a task with no location as being
        // at (0, 0) and compare against Null Island.
        const rawLat = task.g_latitude?.trim();
        const rawLng = task.g_longitude?.trim();
        const propertyLat = rawLat ? Number(rawLat) : Number.NaN;
        const propertyLng = rawLng ? Number(rawLng) : Number.NaN;

        // Fail closed. Both coordinate columns are nullable and are populated from a
        // Google lookup that can fail, so treating "no location on file" as "skip the
        // check" would let any such task be captured from anywhere.
        if (!Number.isFinite(propertyLat) || !Number.isFinite(propertyLng)) {
            return {
                error: {
                    status: 409,
                    body: { error: 'This task has no location on file and cannot be captured. Contact your administrator.' },
                },
            };
        }

        const distance = haversineDistanceMeters(latitude, longitude, propertyLat, propertyLng);
        if (distance > config.fieldVisit.cameraUnlockDistanceMeters) {
            return {
                error: {
                    status: 403,
                    body: {
                        error: `You must be within ${config.fieldVisit.cameraUnlockDistanceMeters}m of the property to upload media`,
                        distanceMeters: Math.round(distance),
                    },
                },
            };
        }
    }

    return { task };
}

const presignBodySchema = z.object({
    mediaType: z.enum(['photo', 'video']),
    sequenceNumber: z.coerce.number().int().min(1),
    contentType: z.enum(['image/jpeg', 'image/png', 'video/webm', 'video/mp4']),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
});

// POST /api/tasks/:taskId/media/presign
// Step 1: validate the rep is allowed to upload, then hand back a short-lived
// URL the browser can PUT the photo/video to directly (never through our API).
mediaRouter.post('/:taskId/media/presign', async (req, res) => {
    const { taskId } = req.params;
    const parsed = presignBodySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        return;
    }
    const { mediaType, sequenceNumber, contentType, latitude, longitude } = parsed.data;

    const maxSequence = mediaType === 'photo' ? config.fieldVisit.requiredPhotoCount : config.fieldVisit.requiredVideoCount;
    if (sequenceNumber > maxSequence) {
        res.status(400).json({ error: `sequenceNumber for ${mediaType} must be between 1 and ${maxSequence}` });
        return;
    }

    if (!contentTypeMatchesMedia(mediaType, contentType)) {
        res.status(400).json({ error: `contentType ${contentType} is not valid for mediaType ${mediaType}` });
        return;
    }

    const check = await assertUploadAllowed(taskId, latitude, longitude);
    if (check.error) {
        res.status(check.error.status).json(check.error.body);
        return;
    }

    const fileName = fileNameFor(mediaType, sequenceNumber, contentType);
    const { uploadUrl, key } = await createPresignedUploadUrl({ taskId, fileName, contentType });

    res.json({ uploadUrl, key, contentType });
});

const confirmBodySchema = z.object({
    mediaType: z.enum(['photo', 'video']),
    sequenceNumber: z.coerce.number().int().min(1),
    contentType: z.enum(['image/jpeg', 'image/png', 'video/webm', 'video/mp4']),
    directionDegrees: z.coerce.number().min(0).max(360).optional(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    capturedAt: z.string().datetime().optional(),
});

// POST /api/tasks/:taskId/media/confirm
// Step 2: called after the browser's direct PUT to S3 succeeds. Records the
// upload and recomputes whether the task is now complete.
mediaRouter.post('/:taskId/media/confirm', async (req, res) => {
    const { taskId } = req.params;
    const parsed = confirmBodySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        return;
    }
    const { mediaType, sequenceNumber, contentType, directionDegrees, latitude, longitude, capturedAt } = parsed.data;

    if (!contentTypeMatchesMedia(mediaType, contentType)) {
        res.status(400).json({ error: `contentType ${contentType} is not valid for mediaType ${mediaType}` });
        return;
    }

    const maxSequence =
        mediaType === 'photo' ? config.fieldVisit.requiredPhotoCount : config.fieldVisit.requiredVideoCount;
    if (sequenceNumber > maxSequence) {
        res.status(400).json({ error: `sequenceNumber for ${mediaType} must be between 1 and ${maxSequence}` });
        return;
    }

    const check = await assertUploadAllowed(taskId, latitude, longitude);
    if (check.error) {
        res.status(check.error.status).json(check.error.body);
        return;
    }
    const task = check.task!;

    // The key is derived here, never accepted from the caller.
    //
    // Taking it from the request meant one legitimately uploaded photo could be
    // confirmed under all ten sequence numbers (and again as the video), marking the
    // task Completed with a single file in the bucket. Deriving it makes each
    // (mediaType, sequenceNumber) map to exactly one object, so a distinct file must
    // genuinely exist for each slot.
    const key = `${taskId}/${fileNameFor(mediaType, sequenceNumber, contentType)}`;

    // The bytes went browser -> S3 without passing through here, so confirm with S3
    // that the object actually exists before counting it, and that it is the type
    // being claimed -- the upload presign binds Content-Type, so a stored type that
    // disagrees means the object is not what this confirm says it is.
    const stored = await headUploadedObject(key);
    if (stored === null) {
        res.status(409).json({ error: 'That file is not in storage yet -- the upload did not complete. Please retry.' });
        return;
    }
    if (stored.contentType && !contentTypeMatchesMedia(mediaType, stored.contentType)) {
        res.status(409).json({
            error: `The stored file is ${stored.contentType}, which is not a valid ${mediaType}.`,
        });
        return;
    }
    const fileSizeBytes = stored.sizeBytes;

    const fileUrl = `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`;

    await insertTaskMedia({
        taskId,
        mediaType,
        sequenceNumber,
        s3Bucket: config.aws.bucketName,
        s3Key: key,
        s3Url: fileUrl,
        directionDegrees: directionDegrees ?? null,
        directionCardinal: directionDegrees !== undefined ? headingToCardinal(directionDegrees) : null,
        capturedLatitude: latitude,
        capturedLongitude: longitude,
        capturedAt: resolveCapturedAt(capturedAt),
        fileSizeBytes,
    });

    if (task.task_status === TaskStatus.NotStarted) {
        await setTaskStatus(taskId, TaskStatus.InProgress);
    }
    await setTaskCloudUrl(taskId, taskFolderUrl(taskId));

    const allMedia = await getTaskMedia(taskId);
    const photoCount = allMedia.filter((m) => m.media_type === 'photo').length;
    const videoCount = allMedia.filter((m) => m.media_type === 'video').length;
    const taskComplete =
        photoCount >= config.fieldVisit.requiredPhotoCount && videoCount >= config.fieldVisit.requiredVideoCount;

    if (taskComplete) {
        await setTaskStatus(taskId, TaskStatus.Completed);
    }

    res.status(201).json({
        media: { mediaType, sequenceNumber, url: fileUrl },
        uploadedCounts: { photos: photoCount, video: videoCount },
        requiredCounts: {
            photos: config.fieldVisit.requiredPhotoCount,
            video: config.fieldVisit.requiredVideoCount,
        },
        taskComplete,
    });
});
