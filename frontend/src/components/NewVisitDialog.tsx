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
    // Only ever fills blanks, and only once, so it cannot overwrite something typed.
    const autoFilledRef = useRef(false);

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
        if (!mapsLoaded || !location || autoFilledRef.current) return;
        if (city.trim() || pinCode.trim()) return;

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
                if (locality || postal) autoFilledRef.current = true;
                if (locality) setCity(locality);
                if (postal) setPinCode(postal);
            })
            .catch(() => {
                // Reverse lookup needs the Geocoding API switched on, which is a
                // separate setting. Its absence must not block creating the visit.
            });
        return () => {
            cancelled = true;
        };
    }, [mapsLoaded, location, city, pinCode]);

    const fullAddressForSearch = [streetAddress, city, pinCode].filter(Boolean).join(', ');
    const canSave = streetAddress.trim().length >= 3 && location !== null && !saving;

    async function handleSubmit(event: FormEvent): Promise<void> {
        event.preventDefault();
        if (!location) return;
        setSaving(true);
        setError(null);
        try {
            const created = await createAdminTask(token, {
                taskId: taskId.trim() || undefined,
                streetAddress: streetAddress.trim(),
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
                                    <Label htmlFor="streetAddress">Property name or address</Label>
                                    <Input
                                        id="streetAddress"
                                        value={streetAddress}
                                        onChange={(e) => setStreetAddress(e.target.value)}
                                        placeholder="42 Brigade Road — or: Vacant plot, Survey No. 42"
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        No street address? Describe the plot instead — this is what the
                                        representative sees at the top of their screen.
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

                            {!location && (
                                <p className="text-sm text-muted-foreground">
                                    Paste a map link or tap the map to place the pin before saving.
                                </p>
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
