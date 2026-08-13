import { useEffect, useRef, useState } from 'react';

export interface CameraStreamState {
    stream: MediaStream | null;
    error: string | null;
}

/** Opens the rear-facing camera (with audio, needed for video capture) once and tears it down on unmount. */
export function useCameraStream(): CameraStreamState {
    const [state, setState] = useState<CameraStreamState>({ stream: null, error: null });
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        let cancelled = false;

        navigator.mediaDevices
            .getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: true,
            })
            .then((stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                setState({ stream, error: null });
            })
            .catch((err: Error) => {
                if (!cancelled) setState({ stream: null, error: err.message });
            });

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, []);

    return state;
}
