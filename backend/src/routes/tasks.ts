import { Router } from 'express';
import { getTaskById, getTaskMedia } from '../services/taskService';
import { isValidTaskId } from '../utils/taskId';
import { config } from '../config';

export const tasksRouter = Router();

// GET /api/tasks/:taskId
// Loads property/location details for the rep's task-ID entry screen.
tasksRouter.get('/:taskId', async (req, res) => {
    const { taskId } = req.params;
    if (!isValidTaskId(taskId)) {
        res.status(400).json({ error: 'taskId must be numeric' });
        return;
    }

    const task = await getTaskById(taskId);
    if (!task) {
        res.status(404).json({ error: `No task found for ID ${taskId}` });
        return;
    }

    const latitude = task.g_latitude ? Number(task.g_latitude) : null;
    const longitude = task.g_longitude ? Number(task.g_longitude) : null;

    res.json({
        taskId: task.task_id,
        status: task.task_status,
        address: {
            fullAddress: task.prop_full_addr ?? task.g_address,
            street: task.prop_st_addr,
            city: task.prop_city,
            pinCode: task.prop_pin_cd,
            district: task.prop_district,
        },
        location: latitude !== null && longitude !== null ? { latitude, longitude } : null,
        propertyManager: {
            firstName: task.prop_mgr_fn,
            lastName: task.prop_mgr_ln,
            phone: task.prop_mgr_phone,
        },
        agent: {
            id: task.agent_id,
            firstName: task.agent_fm,
            lastName: task.agent_lm,
        },
        cloudUrl: task.cloud_url,
        cameraUnlockDistanceMeters: config.fieldVisit.cameraUnlockDistanceMeters,
        requiredPhotoCount: config.fieldVisit.requiredPhotoCount,
        requiredVideoCount: config.fieldVisit.requiredVideoCount,
    });
});

// GET /api/tasks/:taskId/media
// Lets the rep's browser resume progress after a page reload.
//
// This endpoint is deliberately unauthenticated -- reps have no login, the Task ID is
// their only credential -- so it returns NO presigned URLs. Handing out working links
// to every photo on a task to anyone who can guess a 9-digit ID is not a trade worth
// making for a progress counter, which is all the resume logic actually needs.
// Media playback lives behind admin auth (GET /api/admin/tasks/:taskId/media).
tasksRouter.get('/:taskId/media', async (req, res) => {
    const { taskId } = req.params;
    if (!isValidTaskId(taskId)) {
        res.status(400).json({ error: 'taskId must be numeric' });
        return;
    }

    const task = await getTaskById(taskId);
    if (!task) {
        res.status(404).json({ error: `No task found for ID ${taskId}` });
        return;
    }

    const media = await getTaskMedia(taskId);
    res.json({
        media: media.map((m) => ({
            mediaType: m.media_type,
            sequenceNumber: m.sequence_number,
            directionCardinal: m.direction_cardinal,
            capturedAt: m.captured_at,
        })),
    });
});
