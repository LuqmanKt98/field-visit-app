import { config } from '../config/config';
import {
    AdminTaskSummary,
    TaskDetails,
    TaskMediaItem,
    TaskMediaProgressItem,
    UploadMediaResponse,
} from '../types';

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

export function getTaskMedia(taskId: string): Promise<{ media: TaskMediaProgressItem[] }> {
    return request(`/tasks/${encodeURIComponent(taskId)}/media`);
}

export type UploadContentType = 'image/jpeg' | 'image/png' | 'video/webm' | 'video/mp4';

export interface UploadMediaArgs {
    taskId: string;
    mediaType: 'photo' | 'video';
    sequenceNumber: number;
    contentType: UploadContentType;
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
    const { uploadUrl } = await request<{ uploadUrl: string; key: string }>(
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
        // No key is sent: the server derives it from mediaType + sequenceNumber +
        // contentType, so a client cannot point two slots at the same object.
        body: JSON.stringify({
            mediaType: args.mediaType,
            sequenceNumber: args.sequenceNumber,
            contentType: args.contentType,
            directionDegrees: args.directionDegrees,
            latitude: args.latitude,
            longitude: args.longitude,
            capturedAt: args.capturedAt,
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

export interface AdminPagination {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

export function listAdminTasks(
    token: string,
    params: AdminTaskListParams,
): Promise<{ tasks: AdminTaskSummary[]; pagination: AdminPagination }> {
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

/**
 * Media for one task, as short-lived presigned URLs that can actually be displayed.
 * The bucket is private, so the stored S3 links return 403 on their own.
 */
export function getAdminTaskMedia(
    token: string,
    taskId: string,
): Promise<{ media: TaskMediaItem[]; expiresInSeconds: number }> {
    return request(`/admin/tasks/${encodeURIComponent(taskId)}/media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}
