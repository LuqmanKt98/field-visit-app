export interface RecordingFormat {
    mimeType: string;
    /** Content type sent to the API -- codec parameters stripped. */
    contentType: 'video/webm' | 'video/mp4';
}

// MediaRecorder output is platform-dependent: Chrome (Android/desktop) produces WebM,
// while iOS Safari only produces MP4 and returns false for every WebM type. Probing in
// preference order -- rather than assuming WebM -- is what makes video capture work on
// iPhone, which matters because reps are on phones.
const CANDIDATES: { mimeType: string; contentType: 'video/webm' | 'video/mp4' }[] = [
    { mimeType: 'video/webm;codecs=vp9,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm', contentType: 'video/webm' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a', contentType: 'video/mp4' },
    { mimeType: 'video/mp4', contentType: 'video/mp4' },
];

/**
 * Picks a recording format this browser actually supports.
 * Returns null when none is supported, so the caller can show a real message instead
 * of constructing a MediaRecorder that throws NotSupportedError.
 */
export function pickRecordingFormat(): RecordingFormat | null {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const candidate of CANDIDATES) {
        if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
    }
    return null;
}

/** Normalises a MediaRecorder mimeType ("video/mp4;codecs=avc1") to a bare content type. */
export function toContentType(mimeType: string): 'video/webm' | 'video/mp4' {
    return mimeType.split(';')[0].trim() === 'video/mp4' ? 'video/mp4' : 'video/webm';
}
