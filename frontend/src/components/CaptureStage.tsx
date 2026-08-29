import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Camera, Compass, Loader2, RefreshCw, Square, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { drawStamp } from '@/utils/stamp';
import { pickRecordingFormat, toContentType } from '@/utils/recording';
import {
    CAPTURE_LIMITS,
    canRecordStampedVideo,
    drawFrameContained,
    fitWithin,
    frameSignature,
    type Size,
} from '@/utils/capture';

const MAX_VIDEO_SECONDS = 120;

interface CaptureStageProps {
    mode: 'photo' | 'video';
    cardinal: string | null;
    /** Camera stream, or null while locked/loading. Owned by the parent. */
    stream: MediaStream | null;
    cameraError: string | null;
    onRetryCamera: () => void;
    /** Degrees the rear camera sits below horizontal; 90 is straight at the ground. */
    downwardTiltDegrees: number | null;
    disabled: boolean;
    busy: boolean;
    /** Used to label the shot the rep is about to take ("Photo 4 of 10"). */
    photosDone: number;
    totalPhotos: number;
    onPhotoCaptured: (blob: Blob, contentType: 'image/jpeg') => void;
    onVideoRecorded: (blob: Blob, contentType: 'video/webm' | 'video/mp4') => void;
}

export function CaptureStage({
    mode,
    cardinal,
    stream,
    cameraError,
    onRetryCamera,
    downwardTiltDegrees,
    disabled,
    busy,
    photosDone,
    totalPhotos,
    onPhotoCaptured,
    onVideoRecorded,
}: CaptureStageProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const recordCanvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const unmountedRef = useRef(false);

    const [recording, setRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [recordError, setRecordError] = useState<string | null>(null);
    const [clock, setClock] = useState(() => new Date());
    const [stalled, setStalled] = useState(false);
    const lastFrameAtRef = useRef(Date.now());

    /**
     * Watches for the camera feed freezing.
     *
     * A rep once shot an entire visit against a stuck picture and only found out
     * afterwards, because a frozen preview looks exactly like a camera pointed at
     * something that is not moving. requestVideoFrameCallback fires once per frame the
     * browser actually presents, so a gap means the feed has genuinely stopped rather
     * than the scene being still.
     */
    useEffect(() => {
        const video = videoRef.current as (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
            cancelVideoFrameCallback?: (handle: number) => void;
        }) | null;
        if (!video || !stream) return;

        lastFrameAtRef.current = Date.now();
        let handle: number | undefined;
        const onFrame = () => {
            lastFrameAtRef.current = Date.now();
            handle = video.requestVideoFrameCallback?.(onFrame);
        };
        handle = video.requestVideoFrameCallback?.(onFrame);
        // Without per-frame callbacks there is nothing dependable to measure, so the
        // check simply stays quiet rather than guessing.
        const supported = typeof video.requestVideoFrameCallback === 'function';

        const check = setInterval(() => {
            if (!supported) return;
            // Frame callbacks stop while the page is in the background, so a rep who
            // glances at a message would come back to a false "Camera frozen" and a
            // disabled shutter. Only judge the feed while it is actually on screen.
            if (document.visibilityState !== 'visible') {
                lastFrameAtRef.current = Date.now();
                return;
            }
            setStalled(Date.now() - lastFrameAtRef.current > 3000);
        }, 1000);

        // Coming back from another app is also the moment Android most often hands back
        // a genuinely suspended stream, so give the element a nudge and re-measure from
        // now rather than from whenever the rep left.
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            lastFrameAtRef.current = Date.now();
            setStalled(false);
            void video.play().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onVisible);

        return () => {
            clearInterval(check);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('pageshow', onVisible);
            if (handle !== undefined) video.cancelVideoFrameCallback?.(handle);
        };
    }, [stream]);

    /** Nudges a stalled feed back to life without losing progress. */
    const restartPreview = useCallback(() => {
        const video = videoRef.current;
        if (!video || !stream) return;
        try {
            video.srcObject = stream;
            void video.play();
            lastFrameAtRef.current = Date.now();
            setStalled(false);
            setRecordError(null);
        } catch {
            setRecordError('The camera could not be restarted. Please reload the page.');
        }
    }, [stream]);

    // The burned-in stamp always uses the real capture time; this just keeps the
    // on-screen preview overlay from showing a frozen clock.
    useEffect(() => {
        const id = setInterval(() => setClock(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    /**
     * Preview shape, as height ÷ width, taken from the real camera feed so the preview
     * shows exactly what will be saved. Held to 3/4 (landscape) until the stream
     * reports its size.
     *
     * Applied with `aspect-ratio`. An earlier version used a zero-height box with
     * percentage padding, meaning to support older browsers -- but the browser floor is
     * already set by Tailwind (Safari 16.4 / Chrome 111), well above aspect-ratio's,
     * and on a real Android handset the live camera inside that zero-height container
     * stopped repainting: the picture froze while the stream kept running.
     */
    const [previewRatio, setPreviewRatio] = useState(3 / 4);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;
        video.srcObject = stream;
        // The autoplay attribute alone is not dependable for a camera stream on mobile
        // browsers; without an explicit play() the element can sit on its first frame,
        // which looks exactly like a frozen camera.
        void video.play().catch(() => undefined);

        const onMeta = () => {
            if (video.videoWidth && video.videoHeight) {
                setPreviewRatio(video.videoHeight / video.videoWidth);
            }
            void video.play().catch(() => undefined);
        };
        video.addEventListener('loadedmetadata', onMeta);
        // Fires already-loaded when the stream is reattached.
        if (video.videoWidth) onMeta();

        // A rotation swaps the reported dimensions, so the preview must re-shape too.
        window.addEventListener('orientationchange', onMeta);
        window.addEventListener('resize', onMeta);
        return () => {
            video.removeEventListener('loadedmetadata', onMeta);
            window.removeEventListener('orientationchange', onMeta);
            window.removeEventListener('resize', onMeta);
        };
    }, [stream]);

    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state !== 'inactive') {
                // Drop the handler first: without this, stopping on unmount fires
                // onstop and calls back into a component that no longer exists.
                recorder.onstop = null;
                recorder.stop();
            }
        };
    }, []);

    // The recording loop re-schedules itself via requestAnimationFrame and therefore
    // keeps calling whichever captureVideoFrame existed when recording started. Reading
    // the heading from a ref (rather than closing over the prop) is what lets the
    // direction stamp keep updating as the rep turns -- closing over it froze every
    // frame at the bearing from the moment Start was pressed.
    const cardinalRef = useRef(cardinal);
    useEffect(() => {
        cardinalRef.current = cardinal;
    }, [cardinal]);

    /**
     * Draws the current camera frame plus its stamp into `canvas`.
     *
     * When `fixedSize` is given the canvas keeps that size and the frame is letterboxed
     * into it. That is what recording uses: the canvas feeds a live MediaStream, so
     * resizing it mid-recording (which is exactly what a phone rotation would do)
     * risks corrupting the output.
     */
    const captureVideoFrame = useCallback((canvas: HTMLCanvasElement, fixedSize?: Size): boolean => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return false;

        const target = fixedSize ?? fitWithin(video.videoWidth, video.videoHeight, CAPTURE_LIMITS.photoMaxEdge);
        if (canvas.width !== target.width || canvas.height !== target.height) {
            canvas.width = target.width;
            canvas.height = target.height;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        drawFrameContained(ctx, video, video.videoWidth, video.videoHeight, target.width, target.height);
        drawStamp(ctx, target.width, target.height, cardinalRef.current, new Date());
        return true;
    }, []);

    // canvas.toBlob is async, so a fast second tap can land before `busy` re-renders the
    // button as disabled. This latch closes that window synchronously -- without it the
    // second capture was encoded and then silently discarded, giving the rep no error
    // and a counter that simply did not move.
    const capturingRef = useRef(false);

    /** Signature of the last frame actually saved, to catch a frozen feed. */
    const lastSignatureRef = useRef<string | null>(null);

    function handleTakePhoto(): void {
        if (capturingRef.current) return;

        const signature = videoRef.current ? frameSignature(videoRef.current) : null;
        if (signature !== null && signature === lastSignatureRef.current) {
            // Identical to the pixel means the feed has stopped, not that the rep took
            // two similar shots. Saving it would put a duplicate into the evidence set.
            setStalled(true);
            setRecordError(
                'That would have saved the same picture as the last photo — the camera feed has stopped. Restart the camera below, then take the photo again.',
            );
            return;
        }

        const canvas = document.createElement('canvas');
        if (!captureVideoFrame(canvas)) {
            setRecordError('Camera is still starting up. Try again in a moment.');
            return;
        }
        setRecordError(null);
        capturingRef.current = true;
        canvas.toBlob(
            (blob) => {
                capturingRef.current = false;
                if (blob) {
                    lastSignatureRef.current = signature;
                    onPhotoCaptured(blob, 'image/jpeg');
                }
                // toBlob yields null when the device is out of memory, which is a real
                // outcome on a budget phone part-way through a visit.
                else setRecordError('Could not save that photo — the phone may be low on memory. Please take it again.');
            },
            'image/jpeg',
            CAPTURE_LIMITS.photoQuality,
        );
    }

    const stopRecording = useCallback((): void => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        setRecording(false);
    }, []);

    // Drives the elapsed counter and the max-duration cutoff. Keeping the cutoff in an
    // effect (not inside a setState updater) matters: React may invoke an updater more
    // than once, which would stop the recorder twice.
    useEffect(() => {
        if (!recording) return;
        const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
        return () => clearInterval(id);
    }, [recording]);

    useEffect(() => {
        if (recording && recordingSeconds >= MAX_VIDEO_SECONDS) stopRecording();
    }, [recording, recordingSeconds, stopRecording]);

    /**
     * Stop if the phone is locked or the rep switches apps.
     *
     * requestAnimationFrame is suspended while the page is hidden, so the canvas being
     * recorded freezes on its last frame while the recorder keeps running. Left alone
     * that produces a video that looks fine in length but is a still image for most of
     * it -- worse than a short recording, because nothing signals it went wrong.
     */
    useEffect(() => {
        if (!recording) return;
        const onHidden = () => {
            if (document.visibilityState === 'hidden') {
                stopRecording();
                setRecordError(
                    'Recording stopped because the screen turned off or you left the app. Please record again, keeping the app open.',
                );
            }
        };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, [recording, stopRecording]);

    function startRecording(): void {
        const canvas = recordCanvasRef.current;
        const video = videoRef.current;
        if (!stream || !canvas || !video) return;

        if (!canRecordStampedVideo()) {
            setRecordError(
                'This browser cannot record video. Please use the latest Chrome (Android) or Safari (iPhone).',
            );
            return;
        }
        const format = pickRecordingFormat();
        if (!format) {
            setRecordError('This browser cannot record video. Please use Chrome or Safari.');
            return;
        }
        if (!video.videoWidth) {
            setRecordError('Camera is still starting up. Try again in a moment.');
            return;
        }
        setRecordError(null);

        // Size is decided once, here, and held for the whole recording. Encoding at the
        // sensor's full resolution would pin the CPU on a mid-range phone; capping the
        // long edge keeps the encode affordable and the file small enough to upload
        // over mobile data.
        const size = fitWithin(video.videoWidth, video.videoHeight, CAPTURE_LIMITS.videoMaxEdge);
        captureVideoFrame(canvas, size);

        const drawLoop = () => {
            captureVideoFrame(canvas, size);
            animationFrameRef.current = requestAnimationFrame(drawLoop);
        };
        animationFrameRef.current = requestAnimationFrame(drawLoop);

        // Record the stamped canvas, not the raw camera, so the direction/timestamp
        // are part of the video itself rather than a screen overlay.
        const canvasStream = canvas.captureStream(CAPTURE_LIMITS.videoFrameRate);
        const combined = new MediaStream([...canvasStream.getVideoTracks(), ...stream.getAudioTracks()]);

        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(combined, {
                mimeType: format.mimeType,
                videoBitsPerSecond: CAPTURE_LIMITS.videoBitsPerSecond,
                audioBitsPerSecond: CAPTURE_LIMITS.audioBitsPerSecond,
            });
        } catch {
            // Some browsers accept the mimeType but reject the bitrate hints; retry
            // without them rather than failing the capture outright.
            try {
                recorder = new MediaRecorder(combined, { mimeType: format.mimeType });
            } catch {
                setRecordError('Could not start recording on this device.');
                if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
                return;
            }
        }

        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            canvasStream.getTracks().forEach((t) => t.stop());
            if (unmountedRef.current) return;

            const contentType = toContentType(recorder.mimeType || format.mimeType);
            const blob = new Blob(chunksRef.current, { type: contentType });
            chunksRef.current = [];
            if (blob.size > 0) onVideoRecorded(blob, contentType);
            else setRecordError('Recording came out empty. Please try again.');
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setRecordingSeconds(0);
        setRecording(true);
    }

    if (cameraError) {
        return (
            <Alert variant="destructive">
                <strong className="font-semibold">Camera unavailable</strong>
                <p className="mt-0.5">{cameraError}</p>
                {/* Tapping "Block" by accident is easy on a phone, and used to end the
                    visit outright. Asking again costs one tap. */}
                <Button variant="outline" className="mt-3 w-full" onClick={onRetryCamera}>
                    <RefreshCw className="h-4 w-4" />
                    Try again
                </Button>
            </Alert>
        );
    }

    const streamNotReady = !stream;
    const remaining = totalPhotos - photosDone;
    const shotNumber = Math.min(photosDone + 1, totalPhotos);

    /*
        The first real visit came back as ten photos of a pavement. The camera was
        working perfectly -- ten distinct files, the rep walking between shots -- it was
        simply pointed at the ground the whole time, because a phone held at a
        comfortable angle to read the screen aims its rear camera at your feet.

        Nothing in the app can see what a photo shows, but it can tell where the camera
        is aimed, and past 45 degrees below horizontal there is no building in frame.
        This only ever advises: ground-level shots of driveways, low walls and damage
        are legitimate inspection evidence, and refusing them would trade one kind of
        wasted visit for another.
    */
    const aimedAtGround = downwardTiltDegrees !== null && downwardTiltDegrees > 45;

    return (
        <div className="space-y-3">
            {/*
                The preview matches the camera's real aspect ratio, and the frame is
                contained rather than cropped. A phone held upright gives a portrait
                stream (1080x1920), so a fixed 4:3 box with object-cover showed only a
                horizontal slice of it -- the rep would frame the property against a
                preview that hid most of what was actually being saved.
            */}
            <div
                className="relative w-full overflow-hidden rounded-xl border bg-slate-900"
                // aspect-ratio, not a zero-height + percentage-padding box. The padding
                // technique was added for older browsers, but Tailwind v4 already puts
                // the floor at Safari 16.4 / Chrome 111, where aspect-ratio has long
                // been supported -- so it bought nothing, and a live camera inside a
                // zero-height container stopped repainting on a real Android handset:
                // the picture froze on screen while the stream kept running, so the rep
                // could not see what they were aiming at.
                style={{ aspectRatio: `1 / ${previewRatio.toFixed(4)}` }}
            >
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-contain"
                />

                {mode === 'photo' && !streamNotReady && (
                    <div className="absolute left-3 top-3 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm">
                        Photo {shotNumber} of {totalPhotos}
                    </div>
                )}

                {/* Mirrors what is being burned into the file, so the rep can confirm
                    the stamp is right before pressing the button. */}
                <div className="absolute bottom-3 left-3 flex gap-3 rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
                    <span className="flex items-center gap-1">
                        <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                        {cardinal ?? '—'}
                    </span>
                    <span>{clock.toLocaleTimeString()}</span>
                </div>

                {recording && (
                    <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-white">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
                        {recordingSeconds}s / {MAX_VIDEO_SECONDS}s
                    </div>
                )}

                {stalled && !streamNotReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/75 px-6 text-center text-sm font-semibold text-white">
                        <RefreshCw className="h-6 w-6" aria-hidden="true" />
                        Camera frozen — tap Restart camera below
                    </div>
                )}

                {streamNotReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-sm font-medium text-white">
                        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                        Starting camera…
                    </div>
                )}

                {/* Advisory only -- the shutter below stays enabled. */}
                {aimedAtGround && !streamNotReady && !stalled && (
                    <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-lg bg-amber-500/95 px-3 py-2.5 text-center text-sm font-semibold text-amber-950 shadow-lg">
                        <ArrowUp className="mx-auto mb-1 h-5 w-5 animate-bounce" aria-hidden="true" />
                        You’re pointing at the ground — raise the phone towards the building
                    </div>
                )}
            </div>

            <canvas ref={recordCanvasRef} className="hidden" />

            {stalled && (
                <Alert variant="warning" icon={<RefreshCw className="h-4 w-4" />}>
                    <strong className="font-semibold">The camera picture has frozen.</strong>
                    <p className="mt-0.5">
                        Taking photos now would save the same stuck picture each time, so capture is
                        paused. Tap below to restart it.
                    </p>
                    <Button variant="outline" className="mt-3 w-full" onClick={restartPreview}>
                        <RefreshCw className="h-4 w-4" />
                        Restart camera
                    </Button>
                </Alert>
            )}

            {recordError && <Alert variant="destructive">{recordError}</Alert>}

            {mode === 'photo' && (
                <>
                    <p className="text-center text-sm text-muted-foreground">
                        {remaining === totalPhotos
                            ? 'Stand back so the whole property is in frame.'
                            : remaining === 1
                              ? 'Last photo — then a short video.'
                              : `${remaining} photos to go. Move around for a different angle each time.`}
                    </p>
                    <Button
                        size="capture"
                        disabled={disabled || streamNotReady || stalled}
                        loading={busy}
                        loadingText={`Uploading photo ${photosDone + 1}…`}
                        onClick={handleTakePhoto}
                    >
                        <Camera className="h-5 w-5" aria-hidden="true" />
                        Take photo {shotNumber}
                    </Button>
                </>
            )}

            {mode === 'video' && !recording && (
                <>
                    <p className="text-center text-sm text-muted-foreground">
                        All photos done. Now record a short walk-around video — up to {MAX_VIDEO_SECONDS}{' '}
                        seconds.
                    </p>
                    <Button
                        size="capture"
                        disabled={disabled || streamNotReady || stalled}
                        loading={busy}
                        loadingText="Uploading video…"
                        onClick={startRecording}
                    >
                        <Video className="h-5 w-5" aria-hidden="true" />
                        Start recording
                    </Button>
                </>
            )}

            {mode === 'video' && recording && (
                <>
                    <p className="text-center text-sm text-muted-foreground">
                        Recording — walk slowly around the property.
                    </p>
                    <Button size="capture" variant="destructive" onClick={stopRecording}>
                        <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                        Stop recording ({recordingSeconds}s)
                    </Button>
                </>
            )}
        </div>
    );
}
