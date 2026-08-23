import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { haversineDistanceMeters, headingToCardinal } from '../utils/geo';
import { createPresignedUploadUrl, getUploadedObjectSize, taskFolderUrl } from '../services/s3Service';
import {
    getTaskById,
    getTaskMedia,
    insertTaskMedia,
    setTaskCloudUrl,
    setTaskStatus,
} from '../services/taskService';
import { TaskStatus } from '../types';
import { contentTypeMatchesMedia, fileNameFor } from '../utils/mediaTypes';

export const mediaRouter = Router();

async function assertUploadAllowed(taskId: string, latitude: number, longitude: number) {
    const task = await getTaskById(taskId);
    if (!task) {
        return { error: { status: 404, body: { error: `No task found for ID ${taskId}` } } };
    }
    if (task.task_status === TaskStatus.Completed) {
        return { error: { status: 409, body: { error: 'This task has already been completed' } } };
    }

    if (config.fieldVisit.enforceServerSideDistanceCheck && task.g_latitude && task.g_longitude) {
        const distance = haversineDistanceMeters(latitude, longitude, Number(task.g_latitude), Number(task.g_longitude));
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
    key: z.string().min(1),
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
    const { mediaType, sequenceNumber, key, directionDegrees, latitude, longitude, capturedAt } = parsed.data;

    if (!key.startsWith(`${taskId}/`)) {
        res.status(400).json({ error: 'key does not belong to this task' });
        return;
    }

    const check = await assertUploadAllowed(taskId, latitude, longitude);
    if (check.error) {
        res.status(check.error.status).json(check.error.body);
        return;
    }
    const task = check.task!;

    // The bytes went browser -> S3 without passing through here, so confirm with S3
    // that the object actually exists before counting it. Otherwise a task could be
    // marked complete while files are missing. The size is read back from S3 rather
    // than taken from the request for the same reason.
    const fileSizeBytes = await getUploadedObjectSize(key);
    if (fileSizeBytes === null) {
        res.status(409).json({ error: 'That file is not in storage yet -- the upload did not complete. Please retry.' });
        return;
    }

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
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
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
