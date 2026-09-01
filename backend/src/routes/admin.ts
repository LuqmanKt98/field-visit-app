import { Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth, requirePasswordChanged } from '../middleware/adminAuth';
import {
    createTask,
    getTaskById,
    getTaskMedia,
    listTasksForAdmin,
    reopenTask,
    suggestTaskId,
    updateTaskLocation,
} from '../services/taskService';
import { createPresignedDownloadUrl, deleteObject } from '../services/s3Service';
import { isValidTaskId } from '../utils/taskId';
import { config } from '../config';

export const adminRouter = Router();
adminRouter.use(requireAdminAuth);
// A starting password opens nothing but the change-password form, which lives on the
// auth router and is deliberately not behind this.
adminRouter.use(requirePasswordChanged);

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
    // Optional on purpose. Most of these properties are vacant land with no address of
    // any kind, so the position is the identity and a name is a convenience. When it is
    // missing the service names the visit after its coordinates.
    streetAddress: z.string().max(60).optional(),
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

/**
 * Hosts this server is willing to follow. The endpoint below fetches a URL supplied by
 * a signed-in user, which is a request-forgery hole unless it is fenced in: without
 * this an admin account could aim it at an internal address and read what came back
 * through the redirect chain. Every hop is re-checked, not just the first.
 */
const MAP_LINK_HOSTS = /^(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.|maps\.)?google\.(?:com|co\.[a-z]{2}|[a-z]{2}))$/i;

const mapLinkSchema = z.object({ url: z.string().url().max(2048) });

// POST /api/admin/resolve-map-link
// Expands a shortened Google Maps link to the URL it points at.
//
// Sharing a dropped pin from the Maps app gives a maps.app.goo.gl link, and that is
// what someone standing on a vacant plot actually has to hand. The coordinates only
// appear after a redirect, and a browser is not allowed to read one cross-origin, so
// the expansion has to happen here. Only the final URL is returned -- never the page.
adminRouter.post('/resolve-map-link', async (req, res) => {
    const parsed = mapLinkSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'A link is required' });
        return;
    }

    let current: URL;
    try {
        current = new URL(parsed.data.url);
    } catch {
        res.status(400).json({ error: 'That does not look like a link' });
        return;
    }

    // One budget for the whole chain, not per hop. Six hops at eight seconds each could
    // reach 48 s, which outlives the serverless function it runs in -- the caller would
    // get a platform timeout rather than the plain message below.
    const deadline = Date.now() + 10_000;

    for (let hop = 0; hop < 6; hop++) {
        if (current.protocol !== 'https:' || !MAP_LINK_HOSTS.test(current.hostname)) {
            res.status(400).json({ error: 'Only Google Maps links can be opened here.' });
            return;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            res.status(504).json({ error: 'That link took too long to open. Paste the full link instead.' });
            return;
        }

        let response: Response;
        try {
            response = await fetch(current.toString(), {
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(remaining),
                // Maps hands a plain client a consent page instead of the redirect.
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FieldVisit/1.0)' },
            });
        } catch {
            res.status(502).json({ error: 'That link could not be opened. Paste the full link instead.' });
            return;
        }

        const next = response.headers.get('location');
        if (!next) {
            // Chain finished. The long URL is whatever we last landed on, and the
            // caller does the coordinate parsing -- it already handles every form.
            res.json({ url: current.toString() });
            return;
        }
        try {
            current = new URL(next, current);
        } catch {
            res.status(502).json({ error: 'That link could not be followed.' });
            return;
        }
    }

    res.status(502).json({ error: 'That link redirected too many times.' });
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

// POST /api/admin/tasks/:taskId/reopen
// Sends a finished visit back out to be redone, clearing what was captured. Without
// this, a visit that came back unusable was stuck: the rep's link showed the completion
// screen and the only workaround was a duplicate Task ID.
adminRouter.post('/tasks/:taskId/reopen', async (req, res) => {
    if (!isValidTaskId(req.params.taskId)) {
        res.status(400).json({ error: 'taskId must be numeric' });
        return;
    }

    const clearedKeys = await reopenTask(req.params.taskId, req.admin!.username);
    if (clearedKeys === null) {
        res.status(404).json({ error: `No task found for ID ${req.params.taskId}` });
        return;
    }

    // Best-effort. Upload keys are derived from the task and sequence number, so a file
    // left behind here is overwritten by the redo anyway -- failing the whole request
    // over tidy-up would leave the admin looking at an error for work that succeeded.
    await Promise.all(
        clearedKeys.map((key) =>
            deleteObject(key).catch((err: unknown) => {
                console.error(`Could not remove ${key} while reopening ${req.params.taskId}`, err);
            }),
        ),
    );

    res.json({ ok: true, clearedMediaCount: clearedKeys.length });
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
