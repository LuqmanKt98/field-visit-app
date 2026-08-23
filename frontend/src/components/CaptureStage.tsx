import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Compass, Loader2, Square, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { drawStamp } from '@/utils/stamp';
import { pickRecordingFormat, toContentType } from '@/utils/recording';

const MAX_VIDEO_SECONDS = 120;

interface CaptureStageProps {
    mode: 'photo' | 'video';
    cardinal: string | null;
    /** Camera stream, or null while locked/loading. Owned by the parent. */
    stream: MediaStream | null;
    cameraError: string | null;
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

    // The burned-in stamp always uses the real capture time; this just keeps the
    // on-screen preview overlay from showing a frozen clock.
    useEffect(() => {
        const id = setInterval(() => setClock(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
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

    const captureVideoFrame = useCallback((canvas: HTMLCanvasElement): boolean => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return false;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawStamp(ctx, canvas.width, canvas.height, cardinalRef.current, new Date());
        return true;
    }, []);

    // canvas.toBlob is async, so a fast second tap can land before `busy` re-renders the
    // button as disabled. This latch closes that window synchronously -- without it the
    // second capture was encoded and then silently discarded, giving the rep no error
    // and a counter that simply did not move.
    const capturingRef = useRef(false);

    function handleTakePhoto(): void {
        if (capturingRef.current) return;
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
                if (blob) onPhotoCaptured(blob, 'image/jpeg');
                else setRecordError('Could not save that photo. Please take it again.');
            },
            'image/jpeg',
            0.92,
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

    function startRecording(): void {
        const canvas = recordCanvasRef.current;
        if (!stream || !canvas) return;

        const format = pickRecordingFormat();
        if (!format) {
            setRecordError('This browser cannot record video. Please use Chrome or Safari.');
            return;
        }
        if (!captureVideoFrame(canvas)) {
            setRecordError('Camera is still starting up. Try again in a moment.');
            return;
        }
        setRecordError(null);

        const drawLoop = () => {
            captureVideoFrame(canvas);
            animationFrameRef.current = requestAnimationFrame(drawLoop);
        };
        animationFrameRef.current = requestAnimationFrame(drawLoop);

        // Record the stamped canvas, not the raw camera, so the direction/timestamp
        // are part of the video itself rather than a screen overlay.
        const canvasStream = canvas.captureStream(30);
        const combined = new MediaStream([...canvasStream.getVideoTracks(), ...stream.getAudioTracks()]);

        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(combined, { mimeType: format.mimeType });
        } catch {
            setRecordError('Could not start recording on this device.');
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            return;
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
            </Alert>
        );
    }

    const streamNotReady = !stream;
    const remaining = totalPhotos - photosDone;
    const shotNumber = Math.min(photosDone + 1, totalPhotos);

    return (
        <div className="space-y-3">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-slate-900">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />

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

                {streamNotReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-sm font-medium text-white">
                        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                        Starting camera…
                    </div>
                )}
            </div>

            <canvas ref={recordCanvasRef} className="hidden" />

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
                        disabled={disabled || streamNotReady}
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
                        disabled={disabled || streamNotReady}
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
