import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/feedback';
import { LocationPicker } from '@/components/LocationPicker';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { ApiError, createAdminTask, getSuggestedTaskId } from '@/services/api';

interface NewVisitDialogProps {
    token: string;
    onClose: () => void;
    onCreated: () => void;
    onSessionExpired: () => void;
}

/** Longest name the prop_st_addr column accepts. */
const NAME_MAX = 60;

/**
 * Trims a full address back to the leading parts that fit, on comma boundaries.
 *
 * The country and state at the tail are the least useful parts of the name anyway, so
 * dropping whole ones reads far better than cutting the string at exactly 60.
 */
function shortenPlaceName(formatted: string): string {
    const text = formatted.trim();
    if (text.length <= NAME_MAX) return text;

    const parts = text.split(',').map((p) => p.trim());
    let out = '';
    for (const part of parts) {
        const next = out ? `${out}, ${part}` : part;
        if (next.length > NAME_MAX) break;
        out = next;
    }
    // A single part longer than the column is the only case left to cut by length.
    return out || text.slice(0, NAME_MAX).trimEnd();
}

export function NewVisitDialog({ token, onClose, onCreated, onSessionExpired }: NewVisitDialogProps) {
    const [taskId, setTaskId] = useState('');
    const [streetAddress, setStreetAddress] = useState('');
    const [city, setCity] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [agentFirstName, setAgentFirstName] = useState('');
    const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [createdLink, setCreatedLink] = useState<{ taskId: string; url: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const { loaded: mapsLoaded } = useGoogleMaps();
    // Coordinates already looked up, so moving the pin re-fills but settling on one
    // does not send the same request again.
    const lastLookupRef = useRef<string | null>(null);
    // Exactly what was last written into the town and PIN fields automatically.
    //
    // Holding the values rather than a "have we filled yet" flag is what lets the pair
    // follow the pin. With a one-shot flag, moving the pin to a plot in another town
    // kept the first town and PIN against the new coordinates and saved them that way,
    // silently mislabelling the record -- and those two fields are what makes a visit
    // findable in the list later. Comparing against what we wrote also keeps the
    // original promise intact: the moment either field differs from it, a person has
    // typed there and it is never touched again.
    const autoFilledRef = useRef<{ name: string; city: string; pinCode: string } | null>(null);

    // Pre-fill a free Task ID so the field is never blank, while still allowing the
    // office to type their own reference over it.
    useEffect(() => {
        getSuggestedTaskId(token)
            .then((r) => setTaskId(r.taskId))
            .catch(() => undefined);
    }, [token]);

    /**
     * Fills in the town and PIN code from wherever the pin ended up.
     *
     * Vacant land is placed by map link, not by address, so these would otherwise stay
     * empty -- and they are what makes a visit findable in the list afterwards. Google
     * can name the locality around any point even where there is no street address,
     * which is exactly the case here.
     */
    useEffect(() => {
        if (!mapsLoaded || !location) return;

        // Same pin as last time, so there is nothing new to look up. Without this the
        // effect re-runs on its own writes and asks Google the same question twice.
        const pin = `${location.latitude},${location.longitude}`;
        if (lastLookupRef.current === pin) return;
        lastLookupRef.current = pin;

        // Each field is judged on its own: blank, or still holding exactly what was
        // filled in for the previous pin. Anything else was typed by a person, and
        // their words outrank the lookup for good.
        const filled = autoFilledRef.current;
        const nameIsOurs = !streetAddress.trim() || streetAddress === filled?.name;
        const cityIsOurs = !city.trim() || city === filled?.city;
        const pinIsOurs = !pinCode.trim() || pinCode === filled?.pinCode;
        if (!nameIsOurs && !cityIsOurs && !pinIsOurs) return;

        let cancelled = false;
        new google.maps.Geocoder()
            .geocode({ location: { lat: location.latitude, lng: location.longitude } })
            .then(({ results }) => {
                if (cancelled || results.length === 0) return;
                const parts = results[0].address_components;
                const pick = (type: string) =>
                    parts.find((c) => c.types.includes(type))?.long_name ?? '';
                const locality =
                    pick('locality') || pick('sublocality') || pick('administrative_area_level_2');
                const postal = pick('postal_code');
                // Whatever Google calls this spot, which for bare land is usually the
                // area and a plus code rather than a street. The column holds 60, and a
                // hard slice cut a real address mid-word ("...Nandivaram-Guduvanch"), so
                // it is trimmed back to the last whole part instead.
                const suggested = shortenPlaceName(results[0].formatted_address ?? '');

                autoFilledRef.current = { name: suggested, city: locality, pinCode: postal };
                if (nameIsOurs && suggested) setStreetAddress(suggested);
                if (cityIsOurs) setCity(locality);
                if (pinIsOurs) setPinCode(postal);
            })
            .catch(() => {
                // Reverse lookup needs the Geocoding API switched on, which is a
                // separate setting. Its absence must not block creating the visit.
            });
        return () => {
            cancelled = true;
        };
    }, [mapsLoaded, location, streetAddress, city, pinCode]);

    const fullAddressForSearch = [streetAddress, city, pinCode].filter(Boolean).join(', ');

    /**
     * What the visit is called when nobody typed anything.
     *
     * The whole point of this screen is land with no address, so a name cannot be a
     * condition of saving -- requiring one is what left the button dead after a pin had
     * been placed perfectly well. Falling back to the position means the record is
     * still identifiable, and the office can rename it later.
     */
    const fallbackName = location
        ? `Land at ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
        : '';

    // The pin is the only thing genuinely required: without it there is nothing for
    // the rep to walk to and nothing to unlock the camera against.
    const canSave = location !== null && !saving;

    async function handleSubmit(event: FormEvent): Promise<void> {
        event.preventDefault();
        if (!location) return;
        setSaving(true);
        setError(null);
        try {
            const created = await createAdminTask(token, {
                taskId: taskId.trim() || undefined,
                streetAddress: streetAddress.trim() || fallbackName,
                city: city.trim() || undefined,
                pinCode: pinCode.trim() || undefined,
                agentFirstName: agentFirstName.trim() || undefined,
                latitude: location.latitude,
                longitude: location.longitude,
            });
            setCreatedLink({
                taskId: created.taskId,
                url: `${window.location.origin}/?taskid=${created.taskId}`,
            });
            onCreated();
        } catch (err) {
            if ((err as { status?: number })?.status === 401) {
                onSessionExpired();
                return;
            }
            setError(err instanceof ApiError ? err.message : 'The visit could not be created.');
        } finally {
            setSaving(false);
        }
    }

    async function copyLink(): Promise<void> {
        if (!createdLink) return;
        try {
            await navigator.clipboard.writeText(createdLink.url);
        } catch {
            // Clipboard can be blocked; the link is on screen to copy by hand.
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-xl">
                {createdLink ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Visit created</DialogTitle>
                            <DialogDescription>
                                Send this link to the person doing the visit. Tapping it opens the visit on
                                their phone — there is nothing for them to type.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                            <Label>Task ID</Label>
                            <p className="text-2xl font-bold tabular-nums">{createdLink.taskId}</p>
                        </div>

                        <div className="mt-4 space-y-2">
                            <Label htmlFor="visitLink">Link for the field representative</Label>
                            <div className="flex gap-2">
                                <Input id="visitLink" readOnly value={createdLink.url} className="font-mono text-sm" />
                                <Button type="button" variant="outline" onClick={copyLink}>
                                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <Button onClick={onClose}>Done</Button>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>New field visit</DialogTitle>
                            <DialogDescription>
                                Name the property and put the pin on it. For vacant land with no address,
                                paste a Google Maps link below. The representative can only take photos
                                once they are standing there.
                            </DialogDescription>
                        </DialogHeader>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="streetAddress">Property name or address (optional)</Label>
                                    <Input
                                        id="streetAddress"
                                        value={streetAddress}
                                        onChange={(e) => setStreetAddress(e.target.value)}
                                        placeholder="42 Brigade Road — or: Vacant plot, Survey No. 42"
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        This is what the representative sees at the top of their screen.
                                        Leave it blank for vacant land and it fills itself in from the
                                        pin, or describe the plot in your own words.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="city">Town or city</Label>
                                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="pinCode">PIN code</Label>
                                    <Input id="pinCode" value={pinCode} onChange={(e) => setPinCode(e.target.value)} placeholder="560025" inputMode="numeric" />
                                </div>
                            </div>

                            <LocationPicker
                                token={token}
                                address={fullAddressForSearch}
                                value={location}
                                onChange={setLocation}
                            />

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="taskId">Task ID</Label>
                                    <Input id="taskId" value={taskId} onChange={(e) => setTaskId(e.target.value)} inputMode="numeric" className="tabular-nums" />
                                    <p className="text-xs text-muted-foreground">
                                        Filled in for you. Replace it with your own reference if you use one.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="agent">Assigned to (optional)</Label>
                                    <Input id="agent" value={agentFirstName} onChange={(e) => setAgentFirstName(e.target.value)} placeholder="Ravi" />
                                </div>
                            </div>

                            {error && <Alert variant="destructive">{error}</Alert>}

                            {/* A greyed-out button with no reason beside it is a dead end.
                                Whatever is still missing has to be named here. */}
                            {!canSave && !saving && (
                                <Alert variant="warning">
                                    <strong className="font-semibold">Place the pin first.</strong>
                                    <p className="mt-0.5">
                                        Paste a Google Maps link above and press <em>Place pin</em>, or tap
                                        the map, then <em>Create visit</em> will turn on.
                                    </p>
                                </Alert>
                            )}

                            <div className="flex justify-end gap-2 pt-1">
                                <Button type="button" variant="ghost" onClick={onClose}>
                                    Cancel
                                </Button>
                                <Button type="submit" loading={saving} loadingText="Creating…" disabled={!canSave}>
                                    <Plus className="h-4 w-4" />
                                    Create visit
                                </Button>
                            </div>
                        </form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
