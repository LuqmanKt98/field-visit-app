import { useCallback, useEffect, useState } from 'react';

export interface GeolocationState {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    error: string | null;
    loading: boolean;
    /** Re-asks for position, e.g. after the rep allows location they first denied. */
    retry: () => void;
}

function describeError(error: GeolocationPositionError): string {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return 'Location access was turned down. Allow location for this page, then tap Try again.';
        case error.POSITION_UNAVAILABLE:
            return 'Your position could not be found. Move into the open, then tap Try again.';
        case error.TIMEOUT:
            return 'Finding your position took too long. Tap Try again.';
        default:
            return error.message;
    }
}

/** Continuously tracks the rep's current position so distance-to-property stays live. */
export function useGeolocation(): GeolocationState {
    const [state, setState] = useState<Omit<GeolocationState, 'retry'>>({
        latitude: null,
        longitude: null,
        accuracy: null,
        error: null,
        loading: true,
    });
    const [attempt, setAttempt] = useState(0);

    // A denied prompt is recoverable on every mobile browser once the rep changes the
    // setting, but only if something asks again -- otherwise they are stuck on an error
    // with no way forward.
    const retry = useCallback(() => {
        setState((s) => ({ ...s, error: null, loading: true }));
        setAttempt((a) => a + 1);
    }, []);

    useEffect(() => {
        if (!('geolocation' in navigator)) {
            setState((s) => ({ ...s, loading: false, error: 'Location is not supported on this device' }));
            return;
        }

        // watchPosition's `timeout` only governs the first fix, and on a weak indoor
        // signal it can simply never call back at all -- leaving the UI on "Getting
        // your location..." indefinitely with no error. This watchdog surfaces that
        // silence as something the rep can act on.
        const watchdog = setTimeout(() => {
            setState((s) =>
                s.latitude === null && s.error === null
                    ? {
                          ...s,
                          loading: false,
                          error: 'Still looking for your position. Check that Location is on, move into the open, then tap Try again.',
                      }
                    : s,
            );
        }, 20000);

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                clearTimeout(watchdog);
                setState({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    error: null,
                    loading: false,
                });
            },
            (error) => {
                clearTimeout(watchdog);
                setState((s) => {
                    // watchPosition reports TIMEOUT whenever no fresh fix arrives inside
                    // the window, and a phone lying still against a wall hits that
                    // routinely -- it does not mean the position is lost. Blanking a
                    // good reading there wiped the distance card and re-locked the
                    // camera part-way through a visit, for nothing. Only a permission
                    // that has actually been withdrawn is worth acting on, and that one
                    // drops the coordinates too so the geofence fails closed.
                    if (s.latitude !== null && error.code !== error.PERMISSION_DENIED) return s;
                    return {
                        latitude: null,
                        longitude: null,
                        accuracy: null,
                        loading: false,
                        error: describeError(error),
                    };
                });
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
        );

        return () => {
            clearTimeout(watchdog);
            navigator.geolocation.clearWatch(watchId);
        };
    }, [attempt]);

    return { ...state, retry };
}
