import { Compass, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';

interface CompassGateProps {
    cardinal: string | null;
    headingDegrees: number | null;
    needsPermissionRequest: boolean;
    permissionDenied: boolean;
    unavailable: boolean;
    onRequestPermission: () => void;
    onContinueWithout: () => void;
}

/**
 * Stands between arriving at the property and taking photos, until the direction
 * sensor is confirmed working.
 *
 * The client's requirement is that every photo carries a compass direction. Previously
 * this was a small button that was easy to walk past, so a rep could shoot a complete
 * visit and only discover afterwards that all ten photos read "Direction: N/A" -- with
 * no way to redo it without going back to the property. Making it a step means the
 * direction is either working, or its absence was a decision somebody actually took.
 */
export function CompassGate({
    cardinal,
    headingDegrees,
    needsPermissionRequest,
    permissionDenied,
    unavailable,
    onRequestPermission,
    onContinueWithout,
}: CompassGateProps) {
    return (
        <Card>
            <CardContent className="p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Compass className="h-6 w-6" />
                </div>

                {needsPermissionRequest ? (
                    <>
                        <h2 className="text-lg font-bold tracking-tight">Turn on the direction sensor</h2>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                            Every photo has to show which way you were facing. Tap below and choose
                            <strong className="text-foreground"> Allow</strong> when your phone asks.
                        </p>
                        <Button size="lg" className="mt-5 w-full" onClick={onRequestPermission}>
                            <Compass className="h-4 w-4" />
                            Turn on direction sensor
                        </Button>
                    </>
                ) : permissionDenied ? (
                    <>
                        <h2 className="text-lg font-bold tracking-tight">Direction access was blocked</h2>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                            Your phone refused access to the compass, so photos cannot show a direction.
                            Close this page and open the link again to be asked once more.
                        </p>
                    </>
                ) : unavailable ? (
                    <>
                        <h2 className="text-lg font-bold tracking-tight">No compass on this phone</h2>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                            We could not get a compass reading. Hold the phone flat and move it in a
                            figure-8 to wake the sensor up &mdash; that fixes it on most phones.
                        </p>
                        <Alert variant="warning" className="mt-4 text-left">
                            If it still does not work, you can carry on, but every photo will be marked
                            <strong> &ldquo;Direction: N/A&rdquo;</strong> and cannot be corrected later.
                        </Alert>
                        <Button variant="outline" className="mt-4 w-full" onClick={onContinueWithout}>
                            Continue without direction
                        </Button>
                    </>
                ) : (
                    <>
                        <h2 className="text-lg font-bold tracking-tight">Checking the compass…</h2>
                        <p className="mt-1.5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Hold the phone still for a moment
                        </p>
                    </>
                )}

                {cardinal && (
                    <div className="mt-5 rounded-lg bg-success/10 p-4">
                        <p className="text-3xl font-bold tabular-nums text-emerald-700">{cardinal}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {headingDegrees !== null ? `${Math.round(headingDegrees)}° — ` : ''}
                            turn around and check this letter changes
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
