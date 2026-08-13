import { pool } from '../db/pool';
import { TaskFieldRow, TaskMediaRow, TaskStatus } from '../types';

export async function getTaskById(taskId: string): Promise<TaskFieldRow | null> {
    const { rows } = await pool.query<TaskFieldRow>(
        'SELECT * FROM tasks_field WHERE task_id = $1',
        [taskId],
    );
    return rows[0] ?? null;
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
