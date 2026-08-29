import { pool } from '../db/pool';
import { TaskFieldRow, TaskMediaRow, TaskStatus } from '../types';

export async function getTaskById(taskId: string): Promise<TaskFieldRow | null> {
    const { rows } = await pool.query<TaskFieldRow>(
        'SELECT * FROM tasks_field WHERE task_id = $1',
        [taskId],
    );
    return rows[0] ?? null;
}

export interface CreateTaskInput {
    taskId?: string;
    jobId?: string;
    vendorTaskId?: string;
    streetAddress: string;
    city?: string;
    pinCode?: string;
    district?: string;
    latitude: number;
    longitude: number;
    agentFirstName?: string;
    agentLastName?: string;
    propertyManagerPhone?: string;
    createdBy: string;
}

/**
 * Suggests a free Task ID.
 *
 * Real tasks normally arrive from the client's own systems with their own numbering,
 * so the ID is only generated when the person creating the visit has not supplied one.
 * Built from the date plus a random tail, which keeps it readable and short enough to
 * read off a job sheet.
 */
export async function suggestTaskId(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
        const now = new Date();
        const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const candidate = `${stamp}${Math.floor(1000 + Math.random() * 9000)}`;
        const { rows } = await pool.query('SELECT 1 FROM tasks_field WHERE task_id = $1', [candidate]);
        if (rows.length === 0) return candidate;
    }
    throw new Error('Could not allocate a Task ID, please try again');
}

export async function createTask(input: CreateTaskInput): Promise<TaskFieldRow> {
    const taskId = input.taskId ?? (await suggestTaskId());

    const fullAddress = [input.streetAddress, input.city, input.pinCode].filter(Boolean).join(', ');

    const { rows } = await pool.query<TaskFieldRow>(
        `INSERT INTO tasks_field (
            task_id, task_status, job_id, vendor_task_id,
            prop_full_addr, prop_st_addr, prop_city, prop_pin_cd, prop_district,
            g_address, g_latitude, g_longitude,
            agent_fm, agent_lm, prop_mgr_phone,
            created_by, created_timestamp, updated_by, updated_timestamp
        ) VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $15, now())
        RETURNING *`,
        [
            taskId,
            input.jobId ?? null,
            input.vendorTaskId ?? null,
            fullAddress.slice(0, 100),
            input.streetAddress.slice(0, 60),
            input.city?.slice(0, 55) ?? null,
            input.pinCode?.slice(0, 15) ?? null,
            input.district?.slice(0, 55) ?? null,
            fullAddress.slice(0, 100),
            String(input.latitude),
            String(input.longitude),
            input.agentFirstName?.slice(0, 55) ?? null,
            input.agentLastName?.slice(0, 55) ?? null,
            input.propertyManagerPhone?.slice(0, 15) ?? null,
            input.createdBy.slice(0, 35),
        ],
    );
    return rows[0];
}

/** Moves an existing visit to a new position, for a mistyped or mis-pinned address. */
export async function updateTaskLocation(
    taskId: string,
    latitude: number,
    longitude: number,
    updatedBy: string,
): Promise<boolean> {
    const result = await pool.query(
        `UPDATE tasks_field
         SET g_latitude = $2, g_longitude = $3, updated_by = $4, updated_timestamp = now()
         WHERE task_id = $1`,
        [taskId, String(latitude), String(longitude), updatedBy.slice(0, 35)],
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Puts a finished visit back into the field, and reports which stored files were
 * dropped so the caller can clear them from S3.
 *
 * A visit can come back unusable -- a camera that froze, a handset with no compass, a
 * rep who photographed the wrong building -- and until now that was final. The task
 * read Completed, the rep's link showed the completion screen, and the only way to get
 * a redo was to invent a second Task ID. Task IDs come from the client's own systems,
 * so a made-up one breaks the link back to their records and leaves two entries for
 * one property.
 *
 * Clearing the media is not incidental: completion is counted from the rows in
 * task_media, so a redo is impossible while they stand. That makes this deliberately
 * destructive, and the caller is expected to have confirmed it with a human first.
 */
export async function reopenTask(taskId: string, updatedBy: string): Promise<string[] | null> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Locked for the duration: a rep mid-upload on the same task would otherwise
        // slip a row in between the delete and the status reset, leaving one orphaned
        // photo counted against the fresh visit.
        const { rowCount } = await client.query(
            'SELECT 1 FROM tasks_field WHERE task_id = $1 FOR UPDATE',
            [taskId],
        );
        if (!rowCount) {
            await client.query('ROLLBACK');
            return null;
        }

        const { rows: cleared } = await client.query<{ s3_key: string }>(
            'DELETE FROM task_media WHERE task_id = $1 RETURNING s3_key',
            [taskId],
        );
        await client.query(
            `UPDATE tasks_field
             SET task_status = $2, cloud_url = NULL, updated_by = $3, updated_timestamp = now()
             WHERE task_id = $1`,
            [taskId, TaskStatus.NotStarted, updatedBy.slice(0, 35)],
        );
        await client.query('COMMIT');
        return cleared.map((row) => row.s3_key);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function getTaskMedia(taskId: string): Promise<TaskMediaRow[]> {
    const { rows } = await pool.query<TaskMediaRow>(
        `SELECT * FROM task_media WHERE task_id = $1 ORDER BY media_type, sequence_number`,
        [taskId],
    );
    return rows;
}

export async function setTaskStatus(taskId: string, status: TaskStatus, updatedBy = 'system'): Promise<void> {
    await pool.query(
        `UPDATE tasks_field
         SET task_status = $2, updated_by = $3, updated_timestamp = now()
         WHERE task_id = $1`,
        [taskId, status, updatedBy],
    );
}

export async function setTaskCloudUrl(taskId: string, cloudUrl: string): Promise<void> {
    await pool.query(
        `UPDATE tasks_field
         SET cloud_url = $2, updated_timestamp = now()
         WHERE task_id = $1`,
        [taskId, cloudUrl],
    );
}

export interface InsertMediaParams {
    taskId: string;
    mediaType: 'photo' | 'video';
    sequenceNumber: number;
    s3Bucket: string;
    s3Key: string;
    s3Url: string;
    directionDegrees: number | null;
    directionCardinal: string | null;
    capturedLatitude: number | null;
    capturedLongitude: number | null;
    capturedAt: Date;
    fileSizeBytes: number;
}

export async function insertTaskMedia(params: InsertMediaParams): Promise<TaskMediaRow> {
    const { rows } = await pool.query<TaskMediaRow>(
        `INSERT INTO task_media (
            task_id, media_type, sequence_number, s3_bucket, s3_key, s3_url,
            direction_degrees, direction_cardinal, captured_latitude, captured_longitude,
            captured_at, file_size_bytes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (task_id, media_type, sequence_number)
        DO UPDATE SET
            s3_bucket = EXCLUDED.s3_bucket,
            s3_key = EXCLUDED.s3_key,
            s3_url = EXCLUDED.s3_url,
            direction_degrees = EXCLUDED.direction_degrees,
            direction_cardinal = EXCLUDED.direction_cardinal,
            captured_latitude = EXCLUDED.captured_latitude,
            captured_longitude = EXCLUDED.captured_longitude,
            captured_at = EXCLUDED.captured_at,
            file_size_bytes = EXCLUDED.file_size_bytes
        RETURNING *`,
        [
            params.taskId,
            params.mediaType,
            params.sequenceNumber,
            params.s3Bucket,
            params.s3Key,
            params.s3Url,
            params.directionDegrees,
            params.directionCardinal,
            params.capturedLatitude,
            params.capturedLongitude,
            params.capturedAt,
            params.fileSizeBytes,
        ],
    );
    return rows[0];
}

export interface AdminTaskListParams {
    search?: string;
    sortBy: 'created_timestamp' | 'updated_timestamp';
    sortDir: 'asc' | 'desc';
    page: number;
    pageSize: number;
}

export async function listTasksForAdmin(params: AdminTaskListParams): Promise<{ tasks: TaskFieldRow[]; total: number }> {
    const { search, sortBy, sortDir, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const whereClause = search ? 'WHERE task_id::text ILIKE $1 OR vendor_task_id ILIKE $1' : '';
    const searchParam = search ? [`%${search}%`] : [];

    const { rows: countRows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM tasks_field ${whereClause}`,
        searchParam,
    );

    const { rows } = await pool.query<TaskFieldRow>(
        `SELECT * FROM tasks_field
         ${whereClause}
         ORDER BY ${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST
         LIMIT $${searchParam.length + 1} OFFSET $${searchParam.length + 2}`,
        [...searchParam, pageSize, offset],
    );

    return { tasks: rows, total: Number(countRows[0]?.count ?? 0) };
}
