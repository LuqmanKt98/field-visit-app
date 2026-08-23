export type MediaKind = 'photo' | 'video';

export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;

// Both WebM and MP4 are accepted because MediaRecorder output is platform-dependent:
// Android/desktop Chrome produce WebM, iOS Safari only produces MP4. Rejecting MP4
// would make video capture impossible on iPhone.
export const VIDEO_CONTENT_TYPES = ['video/webm', 'video/mp4'] as const;

export const ALLOWED_CONTENT_TYPES = [...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXTENSIONS: Record<AllowedContentType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
};

/** Rejects a video sent as a photo (or vice versa) before anything reaches S3. */
export function contentTypeMatchesMedia(mediaType: MediaKind, contentType: string): boolean {
    const allowed: readonly string[] = mediaType === 'photo' ? PHOTO_CONTENT_TYPES : VIDEO_CONTENT_TYPES;
    return allowed.includes(contentType);
}

/** S3 object name within the task's folder, e.g. "photo_3.jpg" / "video.mp4". */
export function fileNameFor(mediaType: MediaKind, sequenceNumber: number, contentType: string): string {
    const extension = EXTENSIONS[contentType as AllowedContentType] ?? 'bin';
    return mediaType === 'video' ? `video.${extension}` : `photo_${sequenceNumber}.${extension}`;
}
