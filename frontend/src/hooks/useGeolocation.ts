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

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                setState({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    error: null,
                    loading: false,
                });
            },
            (error) => {
                setState((s) => ({ ...s, loading: false, error: error.message }));
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, []);

    return state;
}
