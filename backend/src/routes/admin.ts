import { Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth';
import {
    createTask,
    getTaskById,
    getTaskMedia,
    listTasksForAdmin,
    suggestTaskId,
    updateTaskLocation,
} from '../services/taskService';
import { createPresignedDownloadUrl } from '../services/s3Service';
import { isValidTaskId } from '../utils/taskId';
import { config } from '../config';

export const adminRouter = Router();
adminRouter.use(requireAdminAuth);

const listQuerySchema = z.object({
    search: z.string().optional(),
    sortBy: z.enum(['created_timestamp', 'updated_timestamp']).default('updated_timestamp'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
    // Bounded like pageSize: an unbounded page number overflows the OFFSET bigint and
    // surfaces as a 500 rather than a validation error.
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/admin/tasks?search=&sortBy=&sortDir=&page=&pageSize=
adminRouter.get('/tasks', async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
        return;
    }

    const { tasks, total } = await listTasksForAdmin(parsed.data);
    res.json({
        tasks: tasks.map((t) => ({
            taskId: t.task_id,
            status: t.task_status,
            vendorTaskId: t.vendor_task_id,
            address: t.prop_full_addr ?? t.g_address,
            city: t.prop_city,
            agent: [t.agent_fm, t.agent_lm].filter(Boolean).join(' '),
            cloudUrl: t.cloud_url,
            createdTimestamp: t.created_timestamp,
            updatedTimestamp: t.updated_timestamp,
        })),
        pagination: {
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            total,
            totalPages: Math.ceil(total / parsed.data.pageSize),
        },
    });
});

// GET /api/admin/tasks/new/suggested-id
// A free Task ID to pre-fill the "new visit" form with.
adminRouter.get('/tasks/new/suggested-id', async (_req, res) => {
    res.json({ taskId: await suggestTaskId() });
});

const createTaskSchema = z.object({
    // Optional: real visits usually carry the client's own reference, so the field is
    // pre-filled with a suggestion but can be overwritten with theirs.
    taskId: z.string().regex(/^\d{1,19}$/).optional(),
    jobId: z.string().max(23).optional(),
    vendorTaskId: z.string().max(35).optional(),
    streetAddress: z.string().min(3).max(60),
    city: z.string().max(55).optional(),
    pinCode: z.string().max(15).optional(),
    district: z.string().max(55).optional(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    agentFirstName: z.string().max(55).optional(),
    agentLastName: z.string().max(55).optional(),
    propertyManagerPhone: z.string().max(15).optional(),
});

// POST /api/admin/tasks
// Creates a field visit. Without this there is no way to get a visit into the system
// short of writing SQL by hand, which is not something an office user can do.
adminRouter.post('/tasks', async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Please check the details', details: parsed.error.flatten() });
        return;
    }

    if (parsed.data.taskId) {
        const existing = await getTaskById(parsed.data.taskId);
        if (existing) {
            res.status(409).json({ error: `Task ID ${parsed.data.taskId} is already in use.` });
            return;
        }
    }

    const task = await createTask({ ...parsed.data, createdBy: req.admin!.username });
    res.status(201).json({
        taskId: task.task_id,
        address: task.prop_full_addr,
        latitude: Number(task.g_latitude),
        longitude: Number(task.g_longitude),
    });
});

const locationSchema = z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
});

// PATCH /api/admin/tasks/:taskId/location
// Lets an office user correct a pin that was dropped in the wrong place, without
// needing anyone to touch the database.
adminRouter.patch('/tasks/:taskId/location', async (req, res) => {
    if (!isValidTaskId(req.params.taskId)) {
        res.status(400).json({ error: 'taskId must be numeric' });
        return;
    }
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'A latitude and longitude are required' });
        return;
    }
    const updated = await updateTaskLocation(
        req.params.taskId,
        parsed.data.latitude,
        parsed.data.longitude,
        req.admin!.username,
    );
    if (!updated) {
        res.status(404).json({ error: `No task found for ID ${req.params.taskId}` });
        return;
    }
    res.json({ ok: true });
});

// GET /api/admin/tasks/:taskId/media
// Returns short-lived presigned URLs. The bucket blocks all public access, so the
// stored s3_url is a 403 for anyone who opens it -- viewing has to be signed.
adminRouter.get('/tasks/:taskId/media', async (req, res) => {
    if (!isValidTaskId(req.params.taskId)) {
        res.status(400).json({ error: 'taskId must be numeric' });
        return;
    }

    const media = await getTaskMedia(req.params.taskId);
    res.json({
        media: await Promise.all(
            media.map(async (m) => ({
                mediaType: m.media_type,
                sequenceNumber: m.sequence_number,
                url: await createPresignedDownloadUrl(m.s3_key),
                directionCardinal: m.direction_cardinal,
                capturedAt: m.captured_at,
                fileSizeBytes: m.file_size_bytes === null ? null : Number(m.file_size_bytes),
                capturedLatitude: m.captured_latitude === null ? null : Number(m.captured_latitude),
                capturedLongitude: m.captured_longitude === null ? null : Number(m.captured_longitude),
            })),
        ),
        expiresInSeconds: config.aws.downloadUrlExpirySeconds,
    });
});
