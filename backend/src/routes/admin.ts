import { Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth';
import { getTaskMedia, listTasksForAdmin } from '../services/taskService';
import { createPresignedDownloadUrl } from '../services/s3Service';
import { config } from '../config';

export const adminRouter = Router();
adminRouter.use(requireAdminAuth);

const listQuerySchema = z.object({
    search: z.string().optional(),
    sortBy: z.enum(['created_timestamp', 'updated_timestamp']).default('updated_timestamp'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
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

// GET /api/admin/tasks/:taskId/media
// Returns short-lived presigned URLs. The bucket blocks all public access, so the
// stored s3_url is a 403 for anyone who opens it -- viewing has to be signed.
adminRouter.get('/tasks/:taskId/media', async (req, res) => {
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
        expiresInSeconds: config.aws.presignedUrlExpirySeconds,
    });
});
