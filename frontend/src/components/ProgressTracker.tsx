import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ProgressTrackerProps {
    photosCaptured: number;
    requiredPhotos: number;
    videoCaptured: number;
    requiredVideo: number;
}

/**
 * Shows progress as discrete dots rather than a percentage bar: the rep needs "how many
 * left" at a glance, and counting dots reads faster than interpreting a filled bar.
 */
export function ProgressTracker({
    photosCaptured,
    requiredPhotos,
    videoCaptured,
    requiredVideo,
}: ProgressTrackerProps) {
    return (
        <Card className="space-y-4 p-4">
            <div>
                <div className="flex items-center justify-between text-sm font-medium">
                    <span>Photos</span>
                    <span className="tabular-nums text-muted-foreground">
                        {photosCaptured} of {requiredPhotos}
                    </span>
                </div>
                <div className="mt-2 flex gap-1.5" aria-hidden="true">
                    {Array.from({ length: requiredPhotos }, (_, i) => (
                        <span
                            key={i}
                            className={cn(
                                'h-2 flex-1 rounded-full transition-colors',
                                i < photosCaptured
                                    ? 'bg-success'
                                    : i === photosCaptured
                                      ? 'animate-pulse bg-primary'
                                      : 'bg-muted',
                            )}
                        />
                    ))}
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between text-sm font-medium">
                    <span>Video</span>
                    <span className="tabular-nums text-muted-foreground">
                        {videoCaptured} of {requiredVideo}
                    </span>
                </div>
                <div className="mt-2 flex gap-1.5" aria-hidden="true">
                    {Array.from({ length: requiredVideo }, (_, i) => (
                        <span
                            key={i}
                            className={cn(
                                'h-2 flex-1 rounded-full transition-colors',
                                i < videoCaptured
                                    ? 'bg-success'
                                    : photosCaptured >= requiredPhotos
                                      ? 'animate-pulse bg-primary'
                                      : 'bg-muted',
                            )}
                        />
                    ))}
                </div>
            </div>

            <p className="sr-only" aria-live="polite">
                {photosCaptured} of {requiredPhotos} photos and {videoCaptured} of {requiredVideo} videos captured.
            </p>
        </Card>
    );
}
