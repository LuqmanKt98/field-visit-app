import { useCallback, useEffect, useRef, useState } from 'react';
import { drawStamp } from '../utils/stamp';
import { pickRecordingFormat, toContentType } from '../utils/recording';

const MAX_VIDEO_SECONDS = 120;

interface CaptureStageProps {
    mode: 'photo' | 'video';
    cardinal: string | null;
    /** Camera stream, or null while locked/loading. Owned by the parent. */
    stream: MediaStream | null;
    cameraError: string | null;
    disabled: boolean;
    busy: boolean;
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

    const captureVideoFrame = useCallback(
        (canvas: HTMLCanvasElement): boolean => {
            const video = videoRef.current;
            if (!video || !video.videoWidth) return false;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return false;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            drawStamp(ctx, canvas.width, canvas.height, cardinal, new Date());
            return true;
        },
        [cardinal],
    );

    function handleTakePhoto(): void {
        const canvas = document.createElement('canvas');
        if (!captureVideoFrame(canvas)) {
            setRecordError('Camera is still starting up. Try again in a moment.');
            return;
        }
        setRecordError(null);
        canvas.toBlob(
            (blob) => {
                if (blob) onPhotoCaptured(blob, 'image/jpeg');
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
        return <div className="capture-error">Camera unavailable: {cameraError}</div>;
    }

    const streamNotReady = !stream;

    return (
        <div className="capture-stage">
            <div className="capture-preview">
                <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                <div className="capture-overlay">
                    <span>{cardinal ?? '—'}</span>
                    <span>{clock.toLocaleTimeString()}</span>
                </div>
                {recording && (
                    <div className="capture-recording-badge">
                        REC {recordingSeconds}s / {MAX_VIDEO_SECONDS}s
                    </div>
                )}
                {streamNotReady && <div className="capture-waiting">Starting camera…</div>}
            </div>
            <canvas ref={recordCanvasRef} style={{ display: 'none' }} />

            {recordError && <p className="error-text">{recordError}</p>}

            {mode === 'photo' && (
                <button
                    type="button"
                    className="btn btn-primary btn-capture"
                    disabled={disabled || busy || streamNotReady}
                    onClick={handleTakePhoto}
                >
                    {busy ? 'Uploading…' : 'Take Photo'}
                </button>
            )}

            {mode === 'video' && !recording && (
                <button
                    type="button"
                    className="btn btn-primary btn-capture"
                    disabled={disabled || busy || streamNotReady}
                    onClick={startRecording}
                >
                    {busy ? 'Uploading…' : 'Start Recording'}
                </button>
            )}
            {mode === 'video' && recording && (
                <button type="button" className="btn btn-danger btn-capture" onClick={stopRecording}>
                    Stop Recording ({recordingSeconds}s)
                </button>
            )}
        </div>
    );
}
