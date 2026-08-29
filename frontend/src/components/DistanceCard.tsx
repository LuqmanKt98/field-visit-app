import { LocateFixed, Lock, MapPin, RotateCw, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { formatDistance } from '@/utils/geo';
import { cn } from '@/lib/utils';

interface DistanceCardProps {
    distanceMeters: number | null;
    unlockDistanceMeters: number;
    unlocked: boolean;
    accuracyMeters: number | null;
    error: string | null;
    onRetry: () => void;
}

/**
 * Turns "how far am I" into something actionable.
 *
 * A bare number ("2,754 m") does not tell a rep whether they are nearly there, so the
 * bar fills as they approach and the copy switches to a plain instruction. Readable at
 * a glance while walking, which is how it is actually used.
 */
export function DistanceCard({
    distanceMeters,
    unlockDistanceMeters,
    unlocked,
    accuracyMeters,
    error,
    onRetry,
}: DistanceCardProps) {
    if (error) {
        return (
            <Alert variant="destructive">
                <strong className="font-semibold">We can’t find your location.</strong>
                <p className="mt-0.5">{error}</p>
                {/* A denied prompt is recoverable, but only if something asks again. */}
                <Button variant="outline" className="mt-3 w-full" onClick={onRetry}>
                    <RotateCw className="h-4 w-4" />
                    Try again
                </Button>
            </Alert>
        );
    }

    if (distanceMeters === null) {
        return (
            <Card className="flex items-center gap-3 p-4">
                <LocateFixed className="h-5 w-5 shrink-0 animate-pulse text-muted-foreground" aria-hidden="true" />
                <div>
                    <p className="font-semibold">Finding your location…</p>
                    <p className="text-sm text-muted-foreground">
                        Make sure Location is turned on for this site.
                    </p>
                </div>
            </Card>
        );
    }

    // Show the last stretch of the approach rather than the whole journey -- the bar is
    // only meaningful once "nearly there" is.
    const scale = Math.max(unlockDistanceMeters * 10, 1);
    const progress = unlocked ? 100 : Math.max(4, Math.min(100, (1 - distanceMeters / scale) * 100));

    return (
        <Card className={cn('p-4', unlocked && 'border-success/40 bg-success/8')}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-3xl font-bold tracking-tight tabular-nums">
                        {formatDistance(distanceMeters)}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        {unlocked ? 'You’ve arrived' : 'from the property'}
                    </p>
                </div>

                <div
                    className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold',
                        unlocked ? 'bg-success/15 text-emerald-700' : 'bg-muted text-muted-foreground',
                    )}
                >
                    {unlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    {unlocked ? 'Camera unlocked' : `Unlocks within ${formatDistance(unlockDistanceMeters)}`}
                </div>
            </div>

            <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Distance to property"
            >
                <div
                    className={cn('h-full rounded-full transition-all duration-500', unlocked ? 'bg-success' : 'bg-primary')}
                    style={{ width: `${progress}%` }}
                />
            </div>

            <p className="mt-2.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                    {unlocked
                        ? 'Take your photos from different angles around the property.'
                        : 'Walk towards the property — the camera unlocks by itself.'}
                    {accuracyMeters !== null && accuracyMeters > 50 && (
                        <> Your GPS is only accurate to ±{Math.round(accuracyMeters)} m; move into the open.</>
                    )}
                </span>
            </p>
        </Card>
    );
}
