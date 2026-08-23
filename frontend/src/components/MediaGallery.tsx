import { useEffect, useState } from 'react';
import { getAdminTaskMedia } from '../services/api';
import { TaskMediaItem } from '../types';

interface MediaGalleryProps {
    token: string;
    taskId: string;
    onClose: () => void;
    onAuthExpired: () => void;
}

export function MediaGallery({ token, taskId, onClose, onAuthExpired }: MediaGalleryProps) {
    const [media, setMedia] = useState<TaskMediaItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Media for task ${taskId}`}>
            <div className="modal">
                <header className="modal-header">
                    <h2>Task #{taskId} media</h2>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                        Close
                    </button>
                </header>

                {error && <p className="error-text">{error}</p>}
                {!media && !error && <p className="muted">Loading media…</p>}
                {media && media.length === 0 && <p className="muted">No media has been captured for this task yet.</p>}

                {/* Direction is a client requirement, so its absence should be visible
                    to whoever reviews the visit rather than buried in the captions. */}
                {media && media.length > 0 && media.every((m) => !m.directionCardinal) && (
                    <div className="warning-banner">
                        <strong>No direction data.</strong> This visit was captured on a device with no
                        compass reading, so none of the media carries a direction stamp.
                    </div>
                )}

                {photos.length > 0 && (
                    <>
                        <h3>Photos ({photos.length})</h3>
                        <div className="media-grid">
                            {photos.map((m) => (
                                <figure key={`photo-${m.sequenceNumber}`} className="media-item">
                                    <img src={m.url} alt={`Photo ${m.sequenceNumber}`} loading="lazy" />
                                    <figcaption>
                                        #{m.sequenceNumber} · {m.directionCardinal ?? 'no direction'}
                                        <br />
                                        {new Date(m.capturedAt).toLocaleString()}
                                    </figcaption>
                                </figure>
                            ))}
                        </div>
                    </>
                )}

                {videos.length > 0 && (
                    <>
                        <h3>Video</h3>
                        {videos.map((m) => (
                            <figure key={`video-${m.sequenceNumber}`} className="media-item media-item-video">
                                <video src={m.url} controls playsInline />
                                <figcaption>
                                    {m.directionCardinal ?? 'no direction'} ·{' '}
                                    {new Date(m.capturedAt).toLocaleString()}
                                </figcaption>
                            </figure>
                        ))}
                    </>
                )}

                {media && media.length > 0 && (
                    <p className="muted modal-footnote">
                        These links are temporary — if an image stops loading, reopen this dialog to refresh them.
                    </p>
                )}
            </div>
        </div>
    );
}
