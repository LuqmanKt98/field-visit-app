import { config } from '../config/config';
import { AdminTaskSummary, TaskDetails, TaskMediaItem, UploadMediaResponse } from '../types';

class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public body?: unknown,
    ) {
        super(message);
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${config.apiBaseUrl}${path}`, init);
    if (!response.ok) {
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            // response had no JSON body
        }
        const message = (body as { error?: string } | undefined)?.error ?? `Request failed (${response.status})`;
        throw new ApiError(message, response.status, body);
    }
    return response.json() as Promise<T>;
}

export { ApiError };

export function getTask(taskId: string): Promise<TaskDetails> {
    return request<TaskDetails>(`/tasks/${encodeURIComponent(taskId)}`);
}

export function getTaskMedia(taskId: string): Promise<{ media: TaskMediaItem[] }> {
    return request(`/tasks/${encodeURIComponent(taskId)}/media`);
}

export interface UploadMediaArgs {
    taskId: string;
    mediaType: 'photo' | 'video';
    sequenceNumber: number;
    contentType: 'image/jpeg' | 'image/png' | 'video/webm';
    directionDegrees?: number;
    latitude: number;
    longitude: number;
    capturedAt: string;
    file: Blob;
}

/**
 * Uploads a photo/video in two steps: ask the API for a short-lived S3 URL,
 * then PUT the file straight to S3 from the browser (never through our API).
 * This is what keeps the upload endpoints small/fast enough to run as Vercel
 * serverless functions regardless of how large the video file is.
 */
export async function uploadMedia(args: UploadMediaArgs): Promise<UploadMediaResponse> {
    const { uploadUrl, key } = await request<{ uploadUrl: string; key: string }>(
        `/tasks/${encodeURIComponent(args.taskId)}/media/presign`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mediaType: args.mediaType,
                sequenceNumber: args.sequenceNumber,
                contentType: args.contentType,
                latitude: args.latitude,
                longitude: args.longitude,
            }),
        },
    );

    const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': args.contentType },
        body: args.file,
    });
    if (!putResponse.ok) {
        throw new ApiError(`Upload to storage failed (${putResponse.status})`, putResponse.status);
    }

    return request<UploadMediaResponse>(`/tasks/${encodeURIComponent(args.taskId)}/media/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mediaType: args.mediaType,
            sequenceNumber: args.sequenceNumber,
            key,
            directionDegrees: args.directionDegrees,
            latitude: args.latitude,
            longitude: args.longitude,
            capturedAt: args.capturedAt,
            fileSizeBytes: args.file.size,
        }),
    });
}

export function adminLogin(username: string, password: string): Promise<{ token: string; admin: { id: string; username: string; email: string } }> {
    return request('/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
}

export interface AdminTaskListParams {
    search?: string;
    sortBy: 'created_timestamp' | 'updated_timestamp';
    sortDir: 'asc' | 'desc';
    page: number;
    pageSize: number;
}

export function listAdminTasks(
    token: string,
    params: AdminTaskListParams,
): Promise<{ tasks: AdminTaskSummary[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const query = new URLSearchParams({
        sortBy: params.sortBy,
        sortDir: params.sortDir,
        page: String(params.page),
        pageSize: String(params.pageSize),
        ...(params.search ? { search: params.search } : {}),
    });
    return request(`/admin/tasks?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}
