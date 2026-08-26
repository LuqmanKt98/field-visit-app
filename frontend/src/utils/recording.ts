export interface RecordingFormat {
    mimeType: string;
    /** Content type sent to the API -- codec parameters stripped. */
    contentType: 'video/webm' | 'video/mp4';
}

const WEBM_CANDIDATES: RecordingFormat[] = [
    { mimeType: 'video/webm;codecs=vp9,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm', contentType: 'video/webm' },
];

const MP4_CANDIDATES: RecordingFormat[] = [
    { mimeType: 'video/mp4;codecs=avc1,mp4a', contentType: 'video/mp4' },
    { mimeType: 'video/mp4', contentType: 'video/mp4' },
];

/**
 * Apple devices, where H.264/MP4 is the hardware-encoded path.
 *
 * Detection is by platform rather than by feature, because the feature check is exactly
 * what misleads here: Safari 26 reports `video/webm;codecs=vp9` as supported, so probing
 * WebM first would pick a software encoder on a phone that has a hardware H.264 one.
 * iPadOS reports itself as a Mac, hence the touch-points test.
 */
function prefersMp4(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const appleSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    return iOS || appleSafari;
}

/**
 * Picks a recording format this browser actually supports, preferring the container the
 * platform encodes natively. Returns null when none is supported, so the caller can show
 * a real message instead of constructing a MediaRecorder that throws.
 */
export function pickRecordingFormat(): RecordingFormat | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const ordered = prefersMp4()
        ? [...MP4_CANDIDATES, ...WEBM_CANDIDATES]
        : [...WEBM_CANDIDATES, ...MP4_CANDIDATES];
    return ordered.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null;
}

/** Normalises a MediaRecorder mimeType ("video/mp4;codecs=avc1") to a bare content type. */
export function toContentType(mimeType: string): 'video/webm' | 'video/mp4' {
    return mimeType.split(';')[0].trim() === 'video/mp4' ? 'video/mp4' : 'video/webm';
}
