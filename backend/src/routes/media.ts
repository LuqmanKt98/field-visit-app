import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { haversineDistanceMeters } from '../utils/geo';
import { uploadTaskMedia, taskFolderUrl } from '../services/s3Service';
import {
    getTaskById,
    getTaskMedia,
    insertTaskMedia,
    setTaskCloudUrl,
    setTaskStatus,
} from '../services/taskService';
import { TaskStatus } from '../types';

export const mediaRouter = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB, generous headroom for a ~1min stamped video
});

const uploadBodySchema = z.object({
    mediaType: z.enum(['photo', 'video']),
    sequenceNumber: z.coerce.number().int().min(1),
    directionDegrees: z.coerce.number().min(0).max(360).optional(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    capturedAt: z.string().datetime().optional(),
});

function directionToCardinal(degrees: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

// POST /api/tasks/:taskId/media  (multipart/form-data, field name "file")
mediaRouter.post('/:taskId/media', upload.single('file'), async (req, res) => {
    const { taskId } = req.params;

    if (!req.file) {
        res.status(400).json({ error: 'file is required' });
        return;
    }

    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid upload metadata', details: parsed.error.flatten() });
        return;
    }
    const { mediaType, sequenceNumber, directionDegrees, latitude, longitude, capturedAt } = parsed.data;

    const maxSequence = mediaType === 'photo' ? config.fieldVisit.requiredPhotoCount : config.fieldVisit.requiredVideoCount;
    if (sequenceNumber > maxSequence) {
        res.status(400).json({ error: `sequenceNumber for ${mediaType} must be between 1 and ${maxSequence}` });
        return;
    }

    const task = await getTaskById(taskId);
    if (!task) {
        res.status(404).json({ error: `No task found for ID ${taskId}` });
        return;
    }
    if (task.task_status === TaskStatus.Completed) {
        res.status(409).json({ error: 'This task has already been completed' });
        return;
    }

    if (config.fieldVisit.enforceServerSideDistanceCheck && task.g_latitude && task.g_longitude) {
        const distance = haversineDistanceMeters(
            latitude,
            longitude,
            Number(task.g_latitude),
            Number(task.g_longitude),
        );
        if (distance > config.fieldVisit.cameraUnlockDistanceMeters) {
            res.status(403).json({
                error: `You must be within ${config.fieldVisit.cameraUnlockDistanceMeters}m of the property to upload media`,
                distanceMeters: Math.round(distance),
            });
            return;
        }
    }

    const extension = mediaType === 'photo' ? 'jpg' : 'webm';
    const fileName = mediaType === 'photo' ? `photo_${sequenceNumber}.${extension}` : `video.${extension}`;

    const uploadResult = await uploadTaskMedia({
        taskId,
        fileName,
        body: req.file.buffer,
        contentType: req.file.mimetype,
    });

    const media = await insertTaskMedia({
        taskId,
        mediaType,
        sequenceNumber,
        s3Bucket: uploadResult.bucket,
        s3Key: uploadResult.key,
        s3Url: uploadResult.url,
        directionDegrees: directionDegrees ?? null,
        directionCardinal: directionDegrees !== undefined ? directionToCardinal(directionDegrees) : null,
        capturedLatitude: latitude,
        capturedLongitude: longitude,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        fileSizeBytes: req.file.size,
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
        media: {
            mediaType: media.media_type,
            sequenceNumber: media.sequence_number,
            url: media.s3_url,
        },
        uploadedCounts: { photos: photoCount, video: videoCount },
        requiredCounts: {
            photos: config.fieldVisit.requiredPhotoCount,
            video: config.fieldVisit.requiredVideoCount,
        },
        taskComplete,
    });
});
