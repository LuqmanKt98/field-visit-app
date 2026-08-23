import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../app';
import { pool } from '../db/pool';
import { config } from '../config';
import { deleteObject } from '../services/s3Service';
import { createAdmin } from '../services/adminService';

/**
 * Integration cover for the rules that actually protect the client's money:
 * the geofence, the "completed means the files exist" guarantee, and admin auth.
 *
 * These are the paths where every serious defect in the QA audit lived, and unit
 * tests over pure helpers could not have caught any of them -- the C1 exploit was a
 * property of how the route, S3 and the database interacted, not of any one function.
 *
 * Runs against the real database and the real bucket, so it is skipped unless
 * DATABASE_URL is configured. Everything it creates is cleaned up afterwards.
 */
const CONFIGURED = Boolean(config.database.connectionString && config.aws.accessKeyId);
const describeIntegration = CONFIGURED ? describe : describe.skip;

const TASK_ID = '990000001';
const NO_COORDS_TASK_ID = '990000002';
const PROPERTY = { latitude: 12.9757, longitude: 77.6079 }; // 1 MG Road, Bengaluru
const FAR_AWAY = { latitude: 51.5072, longitude: -0.1276 }; // London

let server: Server;
let baseUrl: string;
const createdKeys = new Set<string>();

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, init);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
}

function postJson(path: string, payload: unknown, headers: Record<string, string> = {}) {
    return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
    });
}

/** Presign, PUT real bytes to S3, then confirm -- exactly what the browser does. */
async function captureMedia(
    taskId: string,
    mediaType: 'photo' | 'video',
    sequenceNumber: number,
    coords = PROPERTY,
    bytes = Buffer.from(`media-${mediaType}-${sequenceNumber}-${'x'.repeat(64)}`),
) {
    const contentType = mediaType === 'photo' ? 'image/jpeg' : 'video/webm';
    const pre = await postJson(`/api/tasks/${taskId}/media/presign`, {
        mediaType, sequenceNumber, contentType, ...coords,
    });
    if (pre.status !== 200) return { stage: 'presign' as const, status: pre.status, body: pre.body };

    createdKeys.add(pre.body.key);
    const put = await fetch(pre.body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: bytes,
    });
    if (!put.ok) return { stage: 'put' as const, status: put.status, body: null };

    const confirmed = await postJson(`/api/tasks/${taskId}/media/confirm`, {
        mediaType, sequenceNumber, contentType, directionDegrees: 45,
        capturedAt: new Date().toISOString(), ...coords,
    });
    return { stage: 'confirm' as const, status: confirmed.status, body: confirmed.body };
}

async function resetTask(taskId: string): Promise<void> {
    await pool.query('DELETE FROM task_media WHERE task_id = $1', [taskId]);
    await pool.query('UPDATE tasks_field SET task_status = 0, cloud_url = NULL WHERE task_id = $1', [taskId]);
}

describeIntegration('field visit rules (integration)', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve) => {
            server = app.listen(0, () => {
                const address = server.address();
                baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
                resolve();
            });
        });

        await pool.query(
            `INSERT INTO tasks_field (task_id, task_status, prop_full_addr, prop_city, g_latitude, g_longitude, created_by, created_timestamp)
             VALUES ($1, 0, 'Integration Test Property', 'Bengaluru', '12.9757', '77.6079', 'vitest', now())
             ON CONFLICT (task_id) DO UPDATE SET task_status = 0, cloud_url = NULL,
                 g_latitude = '12.9757', g_longitude = '77.6079'`,
            [TASK_ID],
        );
        await pool.query(
            `INSERT INTO tasks_field (task_id, task_status, prop_full_addr, created_by, created_timestamp)
             VALUES ($1, 0, 'No Coordinates Property', 'vitest', now())
             ON CONFLICT (task_id) DO UPDATE SET task_status = 0, g_latitude = NULL, g_longitude = NULL`,
            [NO_COORDS_TASK_ID],
        );
    }, 60_000);

    afterAll(async () => {
        for (const key of createdKeys) {
            await deleteObject(key).catch(() => undefined);
        }
        await pool.query('DELETE FROM task_media WHERE task_id = ANY($1)', [[TASK_ID, NO_COORDS_TASK_ID]]);
        await pool.query('DELETE FROM tasks_field WHERE task_id = ANY($1)', [[TASK_ID, NO_COORDS_TASK_ID]]);
        await pool.query("DELETE FROM admin_users WHERE username = 'vitest_admin'");
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await pool.end();
    }, 60_000);

    describe('the geofence', () => {
        it('refuses an upload from far away', async () => {
            const result = await captureMedia(TASK_ID, 'photo', 1, FAR_AWAY);
            expect(result.stage).toBe('presign');
            expect(result.status).toBe(403);
            expect(result.body.distanceMeters).toBeGreaterThan(1000);
        }, 60_000);

        it('fails closed when the task has no coordinates on file', async () => {
            const result = await captureMedia(NO_COORDS_TASK_ID, 'photo', 1, PROPERTY);
            expect(result.stage).toBe('presign');
            expect(result.status).toBe(409);
            expect(result.body.error).toMatch(/no location on file/i);
        }, 60_000);

        it('allows an upload from the property', async () => {
            await resetTask(TASK_ID);
            const result = await captureMedia(TASK_ID, 'photo', 1);
            expect(result.status).toBe(201);
        }, 60_000);
    });

    describe('"completed" means the files really exist', () => {
        it('will not count one uploaded object under several sequence numbers', async () => {
            await resetTask(TASK_ID);

            // Upload exactly one object, into photo slot 1.
            const first = await captureMedia(TASK_ID, 'photo', 1);
            expect(first.status).toBe(201);

            // Then try to claim slots 2..10 without uploading anything more.
            // This is the C1 exploit: it previously returned 201 every time.
            const claims = [];
            for (let seq = 2; seq <= 10; seq++) {
                claims.push(
                    await postJson(`/api/tasks/${TASK_ID}/media/confirm`, {
                        mediaType: 'photo', sequenceNumber: seq, contentType: 'image/jpeg',
                        directionDegrees: 0, ...PROPERTY,
                    }),
                );
            }
            expect(claims.every((c) => c.status === 409)).toBe(true);

            const { rows } = await pool.query<{ rows_count: string; distinct_keys: string }>(
                `SELECT count(*) AS rows_count, count(DISTINCT s3_key) AS distinct_keys
                 FROM task_media WHERE task_id = $1`,
                [TASK_ID],
            );
            expect(Number(rows[0].rows_count)).toBe(1);
            expect(Number(rows[0].distinct_keys)).toBe(1);
        }, 180_000);

        it('completes only after every photo and the video are genuinely stored', async () => {
            await resetTask(TASK_ID);

            for (let seq = 1; seq <= config.fieldVisit.requiredPhotoCount; seq++) {
                const r = await captureMedia(TASK_ID, 'photo', seq);
                expect(r.status).toBe(201);
                expect(r.body.taskComplete).toBe(false); // not complete until the video lands
            }

            const video = await captureMedia(TASK_ID, 'video', 1);
            expect(video.status).toBe(201);
            expect(video.body.taskComplete).toBe(true);

            const { rows } = await pool.query<{ distinct_keys: string }>(
                'SELECT count(DISTINCT s3_key) AS distinct_keys FROM task_media WHERE task_id = $1',
                [TASK_ID],
            );
            expect(Number(rows[0].distinct_keys)).toBe(config.fieldVisit.requiredPhotoCount + 1);

            const { rows: taskRows } = await pool.query<{ task_status: number }>(
                'SELECT task_status FROM tasks_field WHERE task_id = $1',
                [TASK_ID],
            );
            expect(taskRows[0].task_status).toBe(2); // Completed
        }, 300_000);

        it('locks a completed task against further uploads', async () => {
            const result = await captureMedia(TASK_ID, 'photo', 1);
            expect(result.stage).toBe('presign');
            expect(result.status).toBe(409);
        }, 60_000);
    });

    describe('upload validation', () => {
        it('rejects a video content type submitted as a photo', async () => {
            await resetTask(TASK_ID);
            const r = await postJson(`/api/tasks/${TASK_ID}/media/presign`, {
                mediaType: 'photo', sequenceNumber: 1, contentType: 'video/mp4', ...PROPERTY,
            });
            expect(r.status).toBe(400);
        }, 60_000);

        it('rejects a sequence number beyond the required count', async () => {
            const r = await postJson(`/api/tasks/${TASK_ID}/media/presign`, {
                mediaType: 'photo', sequenceNumber: 11, contentType: 'image/jpeg', ...PROPERTY,
            });
            expect(r.status).toBe(400);
        }, 60_000);

        it('returns 400, not 500, for a malformed task id', async () => {
            const r = await api('/api/tasks/not-a-number/media');
            expect(r.status).toBe(400);
        }, 60_000);
    });

    describe('admin auth', () => {
        beforeAll(async () => {
            await pool.query("DELETE FROM admin_users WHERE username = 'vitest_admin'");
            await createAdmin('vitest_admin', 'vitest@example.com', 'vitest-password-1');
        }, 60_000);

        it('rejects unauthenticated, forged and malformed tokens', async () => {
            const forged =
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjoiMSJ9.not-a-valid-signature';
            const attempts = await Promise.all([
                api('/api/admin/tasks'),
                api('/api/admin/tasks', { headers: { Authorization: `Bearer ${forged}` } }),
                api('/api/admin/tasks', { headers: { Authorization: 'Bearer ' } }),
                api('/api/admin/tasks', { headers: { Authorization: 'Basic abc' } }),
            ]);
            expect(attempts.map((a) => a.status)).toEqual([401, 401, 401, 401]);
        }, 60_000);

        it('rejects a wrong password but accepts the right one', async () => {
            const bad = await postJson('/api/admin/auth/login', {
                username: 'vitest_admin', password: 'wrong',
            });
            expect(bad.status).toBe(401);

            const good = await postJson('/api/admin/auth/login', {
                username: 'vitest_admin', password: 'vitest-password-1',
            });
            expect(good.status).toBe(200);
            expect(good.body.token).toBeTruthy();

            const listed = await api('/api/admin/tasks', {
                headers: { Authorization: `Bearer ${good.body.token}` },
            });
            expect(listed.status).toBe(200);
        }, 60_000);

        it('never exposes presigned URLs from the unauthenticated rep endpoint', async () => {
            const r = await api(`/api/tasks/${TASK_ID}/media`);
            expect(r.status).toBe(200);
            for (const item of r.body.media) {
                expect(item).not.toHaveProperty('url');
            }
        }, 60_000);
    });
});
