import { useEffect, useRef, useState } from 'react';
import { useCameraStream } from '../hooks/useCameraStream';
import { drawStamp } from '../utils/stamp';

interface CaptureStageProps {
    mode: 'photo' | 'video';
    cardinal: string | null;
    disabled: boolean;
    busy: boolean;
    onPhotoCaptured: (blob: Blob) => void;
    onVideoRecorded: (blob: Blob) => void;
}

function pickVideoMimeType(): string {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
}

export function CaptureStage({ mode, cardinal, disabled, busy, onPhotoCaptured, onVideoRecorded }: CaptureStageProps) {
    const { stream, error } = useCameraStream();
    const videoRef = useRef<HTMLVideoElement>(null);
    const recordCanvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const [recording, setRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            mediaRecorderRef.current?.stop();
        };
    }, []);

    function captureVideoFrame(canvas: HTMLCanvasElement): void {
        const video = videoRef.current;
        if (!video) return;
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawStamp(ctx, canvas.width, canvas.height, cardinal, new Date());
    }

    function handleTakePhoto(): void {
        const canvas = document.createElement('canvas');
        captureVideoFrame(canvas);
        canvas.toBlob((blob) => blob && onPhotoCaptured(blob), 'image/jpeg', 0.92);
    }

    function startRecording(): void {
        if (!stream || !recordCanvasRef.current) return;
        const canvas = recordCanvasRef.current;
        captureVideoFrame(canvas);

        const drawLoop = () => {
            captureVideoFrame(canvas);
            animationFrameRef.current = requestAnimationFrame(drawLoop);
        };
        animationFrameRef.current = requestAnimationFrame(drawLoop);

        const canvasStream = canvas.captureStream(30);
        const audioTracks = stream.getAudioTracks();
        const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

        chunksRef.current = [];
        const recorder = new MediaRecorder(combined, { mimeType: pickVideoMimeType() });
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
            onVideoRecorded(blob);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setRecording(true);
        setRecordingSeconds(0);

        const tick = setInterval(() => {
            setRecordingSeconds((s) => {
                if (s + 1 >= 120) {
                    clearInterval(tick);
                    recorder.stop();
                    setRecording(false);
                }
                return s + 1;
            });
        }, 1000);
        recorder.addEventListener('stop', () => clearInterval(tick), { once: true });
    }

    function stopRecording(): void {
        mediaRecorderRef.current?.stop();
        setRecording(false);
    }

    if (error) {
        return <div className="capture-error">Camera unavailable: {error}. Please allow camera access and reload.</div>;
    }

    return (
        <div className="capture-stage">
            <div className="capture-preview">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                <div className="capture-overlay">
                    <span>{cardinal ?? '—'}</span>
                    <span>{new Date().toLocaleTimeString()}</span>
                </div>
                {recording && <div className="capture-recording-badge">REC {recordingSeconds}s</div>}
            </div>
            <canvas ref={recordCanvasRef} style={{ display: 'none' }} />

            {mode === 'photo' && (
                <button type="button" className="btn btn-primary btn-capture" disabled={disabled || busy || !stream} onClick={handleTakePhoto}>
                    {busy ? 'Uploading…' : 'Take Photo'}
                </button>
            )}

            {mode === 'video' && !recording && (
                <button type="button" className="btn btn-primary btn-capture" disabled={disabled || busy || !stream} onClick={startRecording}>
                    {busy ? 'Uploading…' : 'Start Recording'}
                </button>
            )}
            {mode === 'video' && recording && (
                <button type="button" className="btn btn-danger btn-capture" onClick={stopRecording}>
                    Stop Recording
                </button>
            )}
        </div>
    );
}
