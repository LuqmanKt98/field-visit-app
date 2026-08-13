import { useEffect, useState } from 'react';
import { config } from '../config/config';

declare global {
    interface Window {
        google?: typeof google;
        __googleMapsCallback?: () => void;
    }
}

let loadPromise: Promise<void> | null = null;

/** Loads the Google Maps JS API (with the 'geometry' library) exactly once. */
function loadGoogleMapsScript(): Promise<void> {
    if (window.google?.maps) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        if (!config.googleMapsApiKey) {
            reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));
            return;
        }
        window.__googleMapsCallback = () => resolve();
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&libraries=geometry&callback=__googleMapsCallback`;
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load Google Maps script'));
        document.head.appendChild(script);
    });

    return loadPromise;
}

export function useGoogleMaps(): { loaded: boolean; error: string | null } {
    const [loaded, setLoaded] = useState(Boolean(window.google?.maps));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (loaded) return;
        loadGoogleMapsScript()
            .then(() => setLoaded(true))
            .catch((err: Error) => setError(err.message));
    }, [loaded]);

    return { loaded, error };
}
