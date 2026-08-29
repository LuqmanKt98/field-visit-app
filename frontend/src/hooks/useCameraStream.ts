import { useCallback, useEffect, useRef, useState } from 'react';

export interface CameraStreamState {
    stream: MediaStream | null;
    error: string | null;
    /** True while a permission prompt or device open is in flight. */
    starting: boolean;
    /** Re-opens the camera, e.g. after the rep fixes a denied permission. */
    retry: () => void;
}

function describeCameraError(err: unknown): string {
    const name = (err as { name?: string })?.name;
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera access was turned down. Allow the camera for this page, then tap Try again.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'No camera was found on this phone.';
        case 'NotReadableError':
        case 'TrackStartError':
            return 'The camera is being used by another app. Close that app, then tap Try again.';
        case 'OverconstrainedError':
            return 'This camera could not be opened at the requested quality. Tap Try again.';
        default: {
            // Whatever the cause, the message has to end somewhere the rep can act.
            // A bare browser string ("Not supported") leaves them staring at a wall.
            const detail = name ?? (err as Error)?.message;
            return detail
                ? `The camera could not be opened (${detail}). Close any other app using the camera, then tap Try again.`
                : 'The camera could not be opened. Close any other app using the camera, then tap Try again.';
        }
    }
}

/**
 * Opens the rear-facing camera, but only while `enabled` is true.
 *
 * Gating on `enabled` is deliberate: the camera must not be opened until the rep is
 * within range of the property, and releasing it when they move away stops the phone
 * holding the camera open (and its indicator light on) for the whole visit.
 *
 * `retry` matters as much as the opening itself. A rep who taps "Block" by mistake --
 * easy to do on a phone -- previously had no way forward at all short of knowing to
 * reload the page, which is not something to expect of someone standing in a street.
 */
export function useCameraStream(enabled: boolean): CameraStreamState {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const streamRef = useRef<MediaStream | null>(null);

    const retry = useCallback(() => {
        setError(null);
        setAttempt((a) => a + 1);
    }, []);

    useEffect(() => {
        if (!enabled) {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            setStream(null);
            setError(null);
            setStarting(false);
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setError(
                'This browser cannot open the camera. Note that the camera needs a secure (https) connection.',
            );
            return;
        }

        let cancelled = false;
        setStarting(true);

        // Every constraint is `ideal`, never `exact`: a budget phone that cannot meet
        // them should open a lower-resolution camera rather than fail with
        // OverconstrainedError and block the visit.
        const preferredVideo: MediaTrackConstraints = {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // Capping frame rate matters on both ends of the fleet: it stops a flagship
            // opening a 60fps stream whose extra frames are discarded, and keeps a weak
            // device from over-committing.
            frameRate: { ideal: 30, max: 30 },
        };

        /**
         * Tried in order, each one asking for less than the last.
         *
         * The audio track is only there so the video clip has sound. On Android a
         * single getUserMedia call for camera *and* microphone fails outright if the
         * rep denies the microphone -- or if the handset has no usable one -- so asking
         * for both together made a nice-to-have able to block the whole visit. Dropping
         * to video-only costs the clip its audio and nothing else; MediaRecorder is
         * given whatever audio tracks exist, which may be none.
         */
        const attempts: MediaStreamConstraints[] = [
            { video: preferredVideo, audio: true },
            { video: preferredVideo, audio: false },
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            { video: true, audio: false },
        ];

        void (async () => {
            let lastError: unknown = null;
            for (const constraints of attempts) {
                if (cancelled) return;
                try {
                    const opened = await navigator.mediaDevices.getUserMedia(constraints);
                    if (cancelled) {
                        opened.getTracks().forEach((t) => t.stop());
                        return;
                    }
                    // Android hands the camera to whichever app asks last, which ends
                    // the track underneath us -- the preview simply freezes and the rep
                    // has no idea why. Surfacing it turns a dead end into one tap.
                    opened.getVideoTracks().forEach((track) => {
                        track.addEventListener('ended', () => {
                            if (streamRef.current !== opened) return;
                            streamRef.current = null;
                            setStream(null);
                            setError(
                                'Another app took over the camera. Close it, then tap Try again.',
                            );
                        });
                    });

                    streamRef.current = opened;
                    setStream(opened);
                    setError(null);
                    setStarting(false);
                    return;
                } catch (err) {
                    lastError = err;
                }
            }
            if (cancelled) return;
            setError(describeCameraError(lastError));
            setStarting(false);
        })();

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [enabled, attempt]);

    return { stream, error, starting, retry };
}
