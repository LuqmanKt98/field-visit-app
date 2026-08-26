/**
 * Capture limits.
 *
 * These exist for the low end of the fleet, not the high end. Field reps are on
 * whatever phone they have, often on mobile data, and the video path is the expensive
 * one: every frame is drawn to a canvas and encoded in software, so recording at the
 * sensor's full resolution pins the CPU on a budget device, drops frames, drains
 * battery and produces a file too large to upload over a weak connection.
 *
 * Sizes below stay well above what a property inspection needs while keeping a whole
 * visit within a sensible data budget.
 */
export const CAPTURE_LIMITS = {
    /** Longest edge of a saved photo. ~3MP — ample for documenting a property. */
    photoMaxEdge: 2560,
    photoQuality: 0.85,

    /** Longest edge of the recorded video. 720p-class, which every phone can encode. */
    videoMaxEdge: 1280,
    /** ~2 Mbit/s: about 30 MB for a full two-minute recording. */
    videoBitsPerSecond: 2_000_000,
    audioBitsPerSecond: 64_000,
    /** 24fps halves the per-frame work versus 30 and is smooth enough for a walk-around. */
    videoFrameRate: 24,
} as const;

export interface Size {
    width: number;
    height: number;
}

/** Scales a size down so its longest edge fits `maxEdge`. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
    const longest = Math.max(width, height);
    if (longest <= maxEdge || longest === 0) return { width, height };
    const scale = maxEdge / longest;
    // Even dimensions: some hardware encoders reject odd width/height.
    return {
        width: Math.max(2, Math.round((width * scale) / 2) * 2),
        height: Math.max(2, Math.round((height * scale) / 2) * 2),
    };
}

/**
 * Draws a video frame into a fixed-size canvas, preserving aspect ratio and
 * letterboxing any leftover space.
 *
 * The fixed target matters during recording: the canvas feeds a live MediaStream, so
 * resizing it mid-recording (which is what happens when the rep rotates the phone)
 * can corrupt the output. Letterboxing absorbs the orientation change instead.
 */
export function drawFrameContained(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    if (!sourceWidth || !sourceHeight) return;

    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    ctx.drawImage(
        source,
        (targetWidth - drawWidth) / 2,
        (targetHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
    );
}

/**
 * True when this browser can record a stamped video at all.
 *
 * Both pieces are required and are missing on some older Android browsers:
 * MediaRecorder does the encoding, and canvas.captureStream is what lets us record the
 * stamped canvas rather than the raw camera.
 */
export function canRecordStampedVideo(): boolean {
    if (typeof MediaRecorder === 'undefined') return false;
    return typeof document.createElement('canvas').captureStream === 'function';
}
