import { useEffect, useRef, useState } from 'react';

export interface CameraStreamState {
    stream: MediaStream | null;
    error: string | null;
}

function describeCameraError(err: unknown): string {
    const name = (err as { name?: string })?.name;
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera permission was denied. Allow camera access in your browser settings, then reload.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'No camera was found on this device.';
        case 'NotReadableError':
            return 'The camera is already in use by another app. Close it and reload.';
        default:
            return (err as Error)?.message ?? 'Could not open the camera.';
    }
}

/**
 * Opens the rear-facing camera, but only while `enabled` is true.
 *
 * Gating on `enabled` is deliberate: the camera must not be opened until the rep is
 * within range of the property, and releasing it when they move away stops the phone
 * holding the camera open (and its indicator light on) for the whole visit.
 */
export function useCameraStream(enabled: boolean): CameraStreamState {
    const [state, setState] = useState<CameraStreamState>({ stream: null, error: null });
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!enabled) {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            setState({ stream: null, error: null });
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setState({
                stream: null,
                error: 'This browser cannot access the camera. Note that camera access requires a secure (https) connection.',
            });
            return;
        }

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
            .catch((err: unknown) => {
                if (!cancelled) setState({ stream: null, error: describeCameraError(err) });
            });

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [enabled]);

    return state;
}
