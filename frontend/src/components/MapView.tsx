import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { TaskLocation } from '@/types';

interface MapViewProps {
    propertyLocation: TaskLocation;
    repLocation: TaskLocation | null;
}

function toLatLngLiteral(location: TaskLocation): google.maps.LatLngLiteral {
    return { lat: location.latitude, lng: location.longitude };
}

export function MapView({ propertyLocation, repLocation }: MapViewProps) {
    const { loaded, error } = useGoogleMaps();
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const propertyMarkerRef = useRef<google.maps.Marker | null>(null);
    const repMarkerRef = useRef<google.maps.Marker | null>(null);
    const lineRef = useRef<google.maps.Polyline | null>(null);

    useEffect(() => {
        if (!loaded || !containerRef.current || mapRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
            center: toLatLngLiteral(propertyLocation),
            zoom: 17,
            mapTypeId: 'satellite',
            streetViewControl: false,
            fullscreenControl: false,
        });
        mapRef.current = map;

        propertyMarkerRef.current = new google.maps.Marker({
            position: toLatLngLiteral(propertyLocation),
            map,
            label: 'P',
            title: 'Property location',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;

        if (!repLocation) return;

        const propertyLatLng = toLatLngLiteral(propertyLocation);
        const repLatLng = toLatLngLiteral(repLocation);

        if (!repMarkerRef.current) {
            repMarkerRef.current = new google.maps.Marker({
                position: repLatLng,
                map,
                label: 'You',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: '#2563eb',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                },
            });
        } else {
            repMarkerRef.current.setPosition(repLatLng);
        }

        if (!lineRef.current) {
            lineRef.current = new google.maps.Polyline({
                path: [propertyLatLng, repLatLng],
                strokeColor: '#2563eb',
                strokeWeight: 3,
                map,
            });
        } else {
            lineRef.current.setPath([propertyLatLng, repLatLng]);
        }

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(propertyLatLng);
        bounds.extend(repLatLng);
        map.fitBounds(bounds, 80);
    }, [loaded, repLocation, propertyLocation]);

    if (error) {
        return (
            <div className="bg-muted p-4 text-center text-sm text-muted-foreground">
                Map unavailable: {error}
            </div>
        );
    }

    // An explicit height is required: Google Maps renders into this element, and with
    // no height it collapses to nothing.
    return (
        <div
            ref={containerRef}
            className="h-52 w-full bg-muted"
            role="img"
            aria-label="Map showing the property and your location"
        />
    );
}
