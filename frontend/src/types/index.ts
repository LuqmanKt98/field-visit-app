export enum TaskStatus {
    NotStarted = 0,
    InProgress = 1,
    Completed = 2,
}

export interface TaskLocation {
    latitude: number;
    longitude: number;
}

export interface TaskDetails {
    taskId: string;
    status: TaskStatus;
    address: {
        fullAddress: string | null;
        street: string | null;
        city: string | null;
        pinCode: string | null;
        district: string | null;
    };
    location: TaskLocation | null;
    propertyManager: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
    };
    agent: {
        id: string | null;
        firstName: string | null;
        lastName: string | null;
    };
    cloudUrl: string | null;
    cameraUnlockDistanceMeters: number;
    requiredPhotoCount: number;
    requiredVideoCount: number;
    maxPhotoBytes: number;
    maxVideoBytes: number;
}

export type MediaType = 'photo' | 'video';

/** Admin view: includes a presigned, viewable URL. */
export interface TaskMediaItem {
    mediaType: MediaType;
    sequenceNumber: number;
    url: string;
    directionCardinal: string | null;
    capturedAt: string;
    fileSizeBytes?: number | null;
    /** Where the rep stood. Already returned by the API; used to review coverage. */
    capturedLatitude?: number | null;
    capturedLongitude?: number | null;
}

/**
 * Rep view: no URL. The rep-facing endpoint is unauthenticated (the Task ID is the
 * only credential), so it returns just enough to resume progress after a reload.
 */
export interface TaskMediaProgressItem {
    mediaType: MediaType;
    sequenceNumber: number;
    directionCardinal: string | null;
    capturedAt: string;
}

export interface UploadMediaResponse {
    media: { mediaType: MediaType; sequenceNumber: number; url: string };
    uploadedCounts: { photos: number; video: number };
    requiredCounts: { photos: number; video: number };
    taskComplete: boolean;
}

export interface AdminTaskSummary {
    taskId: string;
    status: TaskStatus;
    vendorTaskId: string | null;
    address: string | null;
    city: string | null;
    agent: string;
    cloudUrl: string | null;
    createdTimestamp: string | null;
    updatedTimestamp: string | null;
}
