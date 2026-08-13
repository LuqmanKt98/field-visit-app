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
    directionDegrees?: number;
    latitude: number;
    longitude: number;
    capturedAt: string;
    file: Blob;
    fileName: string;
}

export async function uploadMedia(args: UploadMediaArgs): Promise<UploadMediaResponse> {
    const formData = new FormData();
    formData.append('mediaType', args.mediaType);
    formData.append('sequenceNumber', String(args.sequenceNumber));
    if (args.directionDegrees !== undefined) {
        formData.append('directionDegrees', String(args.directionDegrees));
    }
    formData.append('latitude', String(args.latitude));
    formData.append('longitude', String(args.longitude));
    formData.append('capturedAt', args.capturedAt);
    formData.append('file', args.file, args.fileName);

    return request<UploadMediaResponse>(`/tasks/${encodeURIComponent(args.taskId)}/media`, {
        method: 'POST',
        body: formData,
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
