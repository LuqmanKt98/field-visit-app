import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

interface LocationPickerProps {
    address: string;
    value: { latitude: number; longitude: number } | null;
    onChange: (value: { latitude: number; longitude: number }) => void;
}

// Bengaluru, so the map opens somewhere useful before an address is searched.
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

/**
 * Picks the property's position without ever showing the user a coordinate.
 *
 * Two ways in, because either one alone can fail: searching the typed address, and
 * dragging the pin. Address lookup needs Google's Geocoding API to be enabled on the
 * account, which is a separate switch from the map itself -- so if the search fails the
 * user can still place the pin by eye, which only needs the map that is already loaded.
 */
export function LocationPicker({ address, value, onChange }: LocationPickerProps) {
    const { loaded, error } = useGoogleMaps();
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchNote, setSearchNote] = useState<string | null>(null);

    const place = useCallback(
        (lat: number, lng: number, recentre: boolean) => {
            onChange({ latitude: lat, longitude: lng });
            const map = mapRef.current;
            if (!map) return;
            markerRef.current?.setPosition({ lat, lng });
            if (recentre) {
                map.setCenter({ lat, lng });
                map.setZoom(18);
            }
        },
        [onChange],
    );

    useEffect(() => {
        if (!loaded || !containerRef.current || mapRef.current) return;

        const start = value ? { lat: value.latitude, lng: value.longitude } : DEFAULT_CENTRE;
        const map = new google.maps.Map(containerRef.current, {
            center: start,
            zoom: value ? 18 : 12,
            mapTypeId: 'roadmap',
            streetViewControl: false,
            fullscreenControl: false,
            mapTypeControl: true,
        });
        mapRef.current = map;

        const marker = new google.maps.Marker({
            position: start,
            map,
            draggable: true,
            title: 'Drag to the exact property',
        });
        markerRef.current = marker;

        marker.addListener('dragend', () => {
            const pos = marker.getPosition();
            if (pos) onChange({ latitude: pos.lat(), longitude: pos.lng() });
        });
        // Tapping the map is easier than dragging on a phone.
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
            if (e.latLng) place(e.latLng.lat(), e.latLng.lng(), false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    async function findAddress(): Promise<void> {
        if (!loaded || !address.trim()) return;
        setSearching(true);
        setSearchNote(null);
        try {
            const geocoder = new google.maps.Geocoder();
            const { results } = await geocoder.geocode({ address });
            if (results.length === 0) {
                setSearchNote('That address was not found. Move the pin to the property instead.');
                return;
            }
            const loc = results[0].geometry.location;
            place(loc.lat(), loc.lng(), true);
            setSearchNote(`Found: ${results[0].formatted_address}. Check the pin and drag it if needed.`);
        } catch {
            setSearchNote('Address lookup is unavailable. Move the pin to the property instead.');
        } finally {
            setSearching(false);
        }
    }

    if (error) {
        return <Alert variant="warning">The map could not be loaded, so the location cannot be set here.</Alert>;
    }

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={findAddress}
                    disabled={!loaded || !address.trim() || searching}
                >
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Find this address on the map
                </Button>
            </div>

            <div className="relative overflow-hidden rounded-lg border">
                <div ref={containerRef} className="h-64 w-full bg-muted" />
                {!loaded && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                        Loading map…
                    </div>
                )}
            </div>

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                    {value
                        ? 'Drag the pin, or tap the map, so it sits exactly on the property. The camera unlocks within 100 m of this pin.'
                        : 'Search the address above, or tap the map to place the pin on the property.'}
                </span>
            </p>

            {searchNote && <p className="text-xs text-muted-foreground">{searchNote}</p>}
        </div>
    );
}
