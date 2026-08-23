import { useEffect, useState } from 'react';
import { Camera, Compass } from 'lucide-react';
import { getAdminTaskMedia } from '@/services/api';
import { TaskMediaItem } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, EmptyState } from '@/components/ui/feedback';

interface MediaGalleryProps {
    token: string;
    taskId: string;
    onClose: () => void;
    onAuthExpired: () => void;
}

export function MediaGallery({ token, taskId, onClose, onAuthExpired }: MediaGalleryProps) {
    const [media, setMedia] = useState<TaskMediaItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [zoomed, setZoomed] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getAdminTaskMedia(token, taskId)
            .then((res) => !cancelled && setMedia(res.media))
            .catch((err: unknown) => {
                if (cancelled) return;
                if ((err as { status?: number })?.status === 401) {
                    onAuthExpired();
                    return;
                }
                setError((err as Error).message);
            });
        return () => {
            cancelled = true;
        };
    }, [token, taskId, onAuthExpired]);

    const photos = media?.filter((m) => m.mediaType === 'photo') ?? [];
    const videos = media?.filter((m) => m.mediaType === 'video') ?? [];
    const noDirection = (media?.length ?? 0) > 0 && media!.every((m) => !m.directionCardinal);

    return (
        <>
            <Dialog open onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Task #{taskId}</DialogTitle>
                        <DialogDescription>
                            Photos and video captured on site, with the direction and time stamped onto
                            each one.
                        </DialogDescription>
                    </DialogHeader>

                    {error && <Alert variant="destructive">{error}</Alert>}

                    {!media && !error && (
                        <div className="flex flex-col items-center gap-3 py-12">
                            <div
                                className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary"
                                aria-hidden="true"
                            />
                            <p className="text-sm text-muted-foreground">Loading media…</p>
                        </div>
                    )}

                    {media && media.length === 0 && (
                        <EmptyState icon={<Camera className="h-6 w-6" />} title="Nothing captured yet">
                            This visit has not started, or the rep has not reached the property.
                        </EmptyState>
                    )}

                    {/* Direction is a client requirement, so its absence should be visible
                        to whoever reviews the visit rather than buried in the captions. */}
                    {noDirection && (
                        <Alert variant="warning" icon={<Compass className="h-4 w-4" />}>
                            <strong className="font-semibold">No direction data.</strong> This visit was
                            captured on a device with no compass reading, so none of the media carries a
                            direction stamp.
                        </Alert>
                    )}

                    {photos.length > 0 && (
                        <section className="mt-4">
                            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Photos ({photos.length})
                            </h3>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                {photos.map((m) => (
                                    <figure
                                        key={`photo-${m.sequenceNumber}`}
                                        className="overflow-hidden rounded-lg border bg-muted"
                                    >
                                        <img
                                            src={m.url}
                                            alt={`Photo ${m.sequenceNumber}, facing ${m.directionCardinal ?? 'an unknown direction'}`}
                                            loading="lazy"
                                            onClick={() => setZoomed(m.url)}
                                            className="aspect-[4/3] w-full cursor-zoom-in object-cover"
                                        />
                                        <figcaption className="flex items-center justify-between gap-2 bg-background px-2.5 py-2 text-xs">
                                            <span className="text-muted-foreground">#{m.sequenceNumber}</span>
                                            <span className="font-semibold">{m.directionCardinal ?? 'N/A'}</span>
                                        </figcaption>
                                        <p className="bg-background px-2.5 pb-2 text-[11px] leading-tight text-muted-foreground">
                                            {new Date(m.capturedAt).toLocaleString()}
                                        </p>
                                    </figure>
                                ))}
                            </div>
                        </section>
                    )}

                    {videos.length > 0 && (
                        <section className="mt-5">
                            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Video
                            </h3>
                            {videos.map((m) => (
                                <figure
                                    key={`video-${m.sequenceNumber}`}
                                    className="overflow-hidden rounded-lg border bg-muted"
                                >
                                    <video src={m.url} controls playsInline preload="metadata" className="w-full bg-black" />
                                    <figcaption className="flex items-center justify-between gap-2 bg-background px-3 py-2 text-xs">
                                        <span className="text-muted-foreground">
                                            {new Date(m.capturedAt).toLocaleString()}
                                        </span>
                                        <span className="font-semibold">{m.directionCardinal ?? 'N/A'}</span>
                                    </figcaption>
                                </figure>
                            ))}
                        </section>
                    )}

                    {media && media.length > 0 && (
                        <p className="mt-5 text-xs text-muted-foreground">
                            These links are temporary. If an image stops loading, close and reopen this
                            window.
                        </p>
                    )}
                </DialogContent>
            </Dialog>

            {zoomed && (
                <div
                    className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-slate-950/95 p-5"
                    onClick={() => setZoomed(null)}
                    role="presentation"
                >
                    <img src={zoomed} alt="Enlarged photo" className="max-h-full max-w-full object-contain" />
                </div>
            )}
        </>
    );
}
