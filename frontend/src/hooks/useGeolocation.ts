import { useEffect, useState } from 'react';

export interface GeolocationState {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    error: string | null;
    loading: boolean;
}

/** Continuously tracks the rep's current position so distance-to-property stays live. */
export function useGeolocation(): GeolocationState {
    const [state, setState] = useState<GeolocationState>({
        latitude: null,
        longitude: null,
        accuracy: null,
        error: null,
        loading: true,
    });

    useEffect(() => {
        if (!('geolocation' in navigator)) {
            setState((s) => ({ ...s, loading: false, error: 'Geolocation is not supported on this device' }));
            return;
        }

        // watchPosition's `timeout` only governs the first fix, and on a weak indoor
        // signal it can simply never call back at all -- leaving the UI on "Getting
        // your location..." indefinitely with no error. This watchdog surfaces that
        // silence as something the rep can act on.
        const watchdog = setTimeout(() => {
            setState((s) =>
                s.latitude === null && s.error === null
                    ? { ...s, loading: false, error: 'Still trying to find your location. Check that Location is turned on, then move somewhere with a clearer view of the sky.' }
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
                setState((s) => ({ ...s, loading: false, error: error.message }));
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
        );

        return () => {
            clearTimeout(watchdog);
            navigator.geolocation.clearWatch(watchId);
        };
    }, []);

    return state;
}
