import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { haversineDistanceMeters } from '../utils/geo';
import { createPresignedUploadUrl, taskFolderUrl } from '../services/s3Service';
import {
    getTaskById,
    getTaskMedia,
    insertTaskMedia,
    setTaskCloudUrl,
    setTaskStatus,
} from '../services/taskService';
import { TaskStatus } from '../types';

export const mediaRouter = Router();

function directionToCardinal(degrees: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

function fileNameFor(mediaType: 'photo' | 'video', sequenceNumber: number, contentType: string): string {
    if (mediaType === 'video') return 'video.webm';
    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    return `photo_${sequenceNumber}.${extension}`;
}

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
    contentType: z.enum(['image/jpeg', 'image/png', 'video/webm']),
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
    fileSizeBytes: z.coerce.number().int().min(0),
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
    const { mediaType, sequenceNumber, key, directionDegrees, latitude, longitude, capturedAt, fileSizeBytes } = parsed.data;

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

    const fileUrl = `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`;

    await insertTaskMedia({
        taskId,
        mediaType,
        sequenceNumber,
        s3Bucket: config.aws.bucketName,
        s3Key: key,
        s3Url: fileUrl,
        directionDegrees: directionDegrees ?? null,
        directionCardinal: directionDegrees !== undefined ? directionToCardinal(directionDegrees) : null,
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
