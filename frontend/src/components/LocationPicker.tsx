import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, MapPin, Search } from 'lucide-react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/feedback';
import { resolveMapLink } from '@/services/api';
import { isShortMapLink, looksLikeLocationAttempt, parseLocationInput } from '@/utils/mapLink';

interface LocationPickerProps {
    token: string;
    address: string;
    value: { latitude: number; longitude: number } | null;
    onChange: (value: { latitude: number; longitude: number }) => void;
}

// Bengaluru, so the map opens somewhere useful before an address is searched.
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

/**
 * Picks the property's position, by whichever of three routes the office actually has.
 *
 * Pasting a Google Maps link comes first, because most of the properties this is used
 * for are vacant land: no building, no street number, nothing for an address search to
 * find. What the person does have is a pin they dropped in the Maps app, and the link
 * that Share produces. Typed coordinates go in the same box.
 *
 * Address search stays for the properties that do have an address, and dragging the pin
 * stays as the last resort that always works -- it needs only the map, not the separate
 * Geocoding API, which is a different switch on the Google account and can be off.
 */
export function LocationPicker({ token, address, value, onChange }: LocationPickerProps) {
    const { loaded, error } = useGoogleMaps();
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchNote, setSearchNote] = useState<string | null>(null);
    const [linkInput, setLinkInput] = useState('');
    const [resolving, setResolving] = useState(false);
    const [linkNote, setLinkNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);

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
            // Satellite by default: on vacant land a road map shows an empty rectangle,
            // and the only way anyone can confirm the pin is on the right plot is by
            // recognising the ground itself.
            mapTypeId: 'hybrid',
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

    async function useLink(): Promise<void> {
        const input = linkInput.trim();
        if (!input) return;
        setLinkNote(null);

        let parsed = parseLocationInput(input);

        // A Share link from the Maps app hides its coordinates behind a redirect the
        // browser may not read, so the server expands it first.
        if (!parsed && isShortMapLink(input)) {
            setResolving(true);
            try {
                const { url } = await resolveMapLink(token, input);
                parsed = parseLocationInput(url);
            } catch (err) {
                setLinkNote({
                    tone: 'bad',
                    text:
                        (err as Error)?.message ??
                        'That short link could not be opened. Open it in Maps and copy the full link from the address bar.',
                });
                setResolving(false);
                return;
            }
            setResolving(false);
        }

        if (!parsed) {
            setLinkNote({
                tone: 'bad',
                text: looksLikeLocationAttempt(input)
                    ? 'No location found in that. Paste a Google Maps link, or type coordinates like 12.835472, 80.066889.'
                    : 'Paste a Google Maps link, or type coordinates like 12.835472, 80.066889.',
            });
            return;
        }

        place(parsed.latitude, parsed.longitude, true);
        const at = `${parsed.latitude.toFixed(6)}, ${parsed.longitude.toFixed(6)}`;
        setLinkNote(
            parsed.from === 'map-centre'
                ? {
                      // Worth saying out loud: this link carried no dropped pin, only
                      // wherever the map was scrolled to, which can sit tens of metres
                      // off the plot.
                      tone: 'warn',
                      text: 'That link had no dropped pin, so the map’s centre was used. Check the pin below and drag it onto the plot.',
                  }
                : parsed.from === 'route-end'
                  ? {
                        // A directions link holds a pin per waypoint. The destination is
                        // the reasonable guess, but it is only a guess, and saying so
                        // costs one sentence against a rep sent to the wrong end of a
                        // journey.
                        tone: 'warn',
                        text: `That is a directions link, so the destination was used (${at}). Check the pin is on the plot, not the starting point.`,
                    }
                  : {
                        tone: 'ok',
                        text: `Pin placed at ${at}. Check it is on the right plot.`,
                    },
        );
    }

    async function findAddress(): Promise<void> {
        if (!loaded || !address.trim()) return;
        setSearching(true);
        setSearchNote(null);
        try {
            const geocoder = new google.maps.Geocoder();
            const { results } = await geocoder.geocode({ address });
            if (results.length === 0) {
                setSearchNote('That address was not found. Paste a map link instead, or move the pin.');
                return;
            }
            const loc = results[0].geometry.location;
            place(loc.lat(), loc.lng(), true);
            setSearchNote(`Found: ${results[0].formatted_address}. Check the pin and drag it if needed.`);
        } catch {
            setSearchNote('Address lookup is unavailable. Paste a map link instead, or move the pin.');
        } finally {
            setSearching(false);
        }
    }

    if (error) {
        return <Alert variant="warning">The map could not be loaded, so the location cannot be set here.</Alert>;
    }

    return (
        <div className="space-y-3">
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                <Label htmlFor="mapLink" className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Google Maps link or coordinates
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        id="mapLink"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                // Inside a form, Enter here would submit a half-filled visit.
                                e.preventDefault();
                                void useLink();
                            }
                        }}
                        placeholder="Paste a maps link, or 12.835472, 80.066889"
                        maxLength={2048}
                        className="flex-1"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void useLink()}
                        disabled={!linkInput.trim() || resolving}
                    >
                        {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                        {resolving ? 'Opening…' : 'Place pin'}
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Best for vacant land and anything with no street address. In Google Maps, long-press
                    the plot, tap <strong>Share</strong>, then paste the link here.
                </p>
                {linkNote && (
                    <p
                        className={
                            linkNote.tone === 'bad'
                                ? 'text-xs font-medium text-destructive'
                                : linkNote.tone === 'warn'
                                  ? 'text-xs font-medium text-amber-700'
                                  : 'text-xs font-medium text-emerald-700'
                        }
                    >
                        {linkNote.text}
                    </p>
                )}
            </div>

            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void findAddress()}
                disabled={!loaded || !address.trim() || searching}
            >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Or find the address above on the map
            </Button>

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
                        ? 'Drag the pin, or tap the map, so it sits exactly on the plot. The camera unlocks within 100 m of this pin.'
                        : 'Paste a map link above, or tap the map to place the pin on the plot.'}
                </span>
            </p>

            {searchNote && <p className="text-xs text-muted-foreground">{searchNote}</p>}
        </div>
    );
}
