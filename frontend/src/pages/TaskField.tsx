import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Compass, Lock, RotateCw, SearchX } from 'lucide-react';
import { MapView } from '@/components/MapView';
import { CaptureStage } from '@/components/CaptureStage';
import { ProgressTracker } from '@/components/ProgressTracker';
import { CompletionScreen } from '@/components/CompletionScreen';
import { DistanceCard } from '@/components/DistanceCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useCompassHeading } from '@/hooks/useCompassHeading';
import { useCameraStream } from '@/hooks/useCameraStream';
import { ApiError, getTask, getTaskMedia, uploadMedia, UploadContentType } from '@/services/api';
import { formatDistance, haversineDistanceMeters } from '@/utils/geo';
import { TaskDetails, TaskStatus } from '@/types';

/** A capture that failed to upload, held so the rep can retry without reshooting. */
interface PendingCapture {
    blob: Blob;
    contentType: UploadContentType;
    mediaType: 'photo' | 'video';
    sequenceNumber: number;
    directionDegrees?: number;
    capturedAt: string;
}

export function TaskField() {
    const { taskId = '' } = useParams();
    const [task, setTask] = useState<TaskDetails | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [photosCaptured, setPhotosCaptured] = useState(0);
    const [videoCaptured, setVideoCaptured] = useState(0);
    const [taskComplete, setTaskComplete] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingCapture | null>(null);

    const geolocation = useGeolocation();
    const compass = useCompassHeading();
    // Guards against a double-tap firing two uploads for the same sequence number.
    const inFlightRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        getTask(taskId)
            .then(async (data) => {
                if (cancelled) return;
                setTask(data);
                if (data.status === TaskStatus.Completed) {
                    setTaskComplete(true);
                    return;
                }
                const { media } = await getTaskMedia(taskId);
                if (cancelled) return;
                setPhotosCaptured(media.filter((m) => m.mediaType === 'photo').length);
                setVideoCaptured(media.filter((m) => m.mediaType === 'video').length);
            })
            .catch((err: Error) => !cancelled && setLoadError(err.message));
        return () => {
            cancelled = true;
        };
    }, [taskId]);

    const distanceMeters = useMemo(() => {
        if (!task?.location || geolocation.latitude === null || geolocation.longitude === null) return null;
        return haversineDistanceMeters(
            geolocation.latitude,
            geolocation.longitude,
            task.location.latitude,
            task.location.longitude,
        );
    }, [task, geolocation.latitude, geolocation.longitude]);

    const cameraUnlocked =
        task !== null && distanceMeters !== null && distanceMeters <= task.cameraUnlockDistanceMeters;

    // The camera is only opened once the rep is actually within range, and is released
    // again if they walk away -- it is not held open for the whole visit.
    const camera = useCameraStream(cameraUnlocked && !taskComplete);

    const send = useCallback(
        async (capture: PendingCapture): Promise<void> => {
            // Hold a capture that arrives mid-upload rather than discarding it, so the
            // rep can retry instead of losing the shot with no feedback at all.
            if (inFlightRef.current) {
                setPending(capture);
                setUploadError('One upload is still finishing. Tap Retry to send this capture.');
                return;
            }
            if (geolocation.latitude === null || geolocation.longitude === null) {
                setPending(capture);
                setUploadError('Waiting for your location. Tap Retry once your position is found.');
                return;
            }

            // Refuse oversized media before spending the rep's mobile data on an upload
            // the server will reject and delete anyway.
            const maxBytes = capture.mediaType === 'photo' ? task?.maxPhotoBytes : task?.maxVideoBytes;
            if (maxBytes && capture.blob.size > maxBytes) {
                setPending(null);
                setUploadError(
                    `That ${capture.mediaType} is ${Math.round(capture.blob.size / 1024 / 1024)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB limit. Please capture a shorter ${capture.mediaType === 'video' ? 'video' : 'shot'}.`,
                );
                return;
            }

            inFlightRef.current = true;
            setUploading(true);
            setUploadError(null);
            try {
                const result = await uploadMedia({
                    taskId,
                    mediaType: capture.mediaType,
                    sequenceNumber: capture.sequenceNumber,
                    contentType: capture.contentType,
                    directionDegrees: capture.directionDegrees,
                    latitude: geolocation.latitude,
                    longitude: geolocation.longitude,
                    capturedAt: capture.capturedAt,
                    file: capture.blob,
                });
                setPhotosCaptured(result.uploadedCounts.photos);
                setVideoCaptured(result.uploadedCounts.video);
                setPending(null);
                if (result.taskComplete) setTaskComplete(true);
            } catch (err) {
                // Hold on to the capture so "Retry" can resend the exact same file --
                // otherwise a dropped connection would cost the rep a reshoot.
                setPending(capture);
                setUploadError(
                    err instanceof ApiError ? err.message : 'Upload failed. Check your signal and retry.',
                );
            } finally {
                inFlightRef.current = false;
                setUploading(false);
            }
        },
        [taskId, geolocation.latitude, geolocation.longitude, task?.maxPhotoBytes, task?.maxVideoBytes],
    );

    function handlePhotoCaptured(blob: Blob, contentType: 'image/jpeg'): void {
        void send({
            blob,
            contentType,
            mediaType: 'photo',
            sequenceNumber: photosCaptured + 1,
            directionDegrees: compass.headingDegrees ?? undefined,
            capturedAt: new Date().toISOString(),
        });
    }

    function handleVideoRecorded(blob: Blob, contentType: 'video/webm' | 'video/mp4'): void {
        void send({
            blob,
            contentType,
            mediaType: 'video',
            sequenceNumber: 1,
            directionDegrees: compass.headingDegrees ?? undefined,
            capturedAt: new Date().toISOString(),
        });
    }

    if (loadError) {
        return (
            <div className="flex min-h-screen-safe items-center justify-center bg-muted/40 px-4">
                <Card className="w-full max-w-md">
                    <CardContent className="p-8 text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <SearchX className="h-6 w-6" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">Task not found</h1>
                        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Check the Task ID on your job sheet, or ask your supervisor to resend the link.
                        </p>
                        <Button variant="outline" className="mt-6 w-full" asChild>
                            <a href="/">Try another Task ID</a>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!task) {
        return (
            <div className="flex min-h-screen-safe flex-col items-center justify-center gap-3 bg-muted/40 px-4">
                <div
                    className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary"
                    aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">Loading your task…</p>
            </div>
        );
    }

    if (taskComplete) return <CompletionScreen taskId={task.taskId} />;

    const requiredPhotos = task.requiredPhotoCount;
    const requiredVideo = task.requiredVideoCount;
    const mode: 'photo' | 'video' = photosCaptured < requiredPhotos ? 'photo' : 'video';
    const started = photosCaptured > 0 || videoCaptured > 0;

    return (
        <div className="min-h-screen-safe bg-muted/40">
            <div className="pb-safe pt-safe mx-auto max-w-2xl space-y-4 px-4">
                <header className="flex items-start justify-between gap-3 pt-2">
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold tracking-tight">Task #{task.taskId}</h1>
                        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                            {[task.address.fullAddress, task.address.city, task.address.pinCode]
                                .filter(Boolean)
                                .join(', ')}
                        </p>
                    </div>
                    <Badge variant={started ? 'default' : 'neutral'}>
                        {started ? 'In progress' : 'Not started'}
                    </Badge>
                </header>

                {task.location && (
                    <div className="overflow-hidden rounded-xl border">
                        <MapView
                            propertyLocation={task.location}
                            repLocation={
                                geolocation.latitude !== null && geolocation.longitude !== null
                                    ? { latitude: geolocation.latitude, longitude: geolocation.longitude }
                                    : null
                            }
                        />
                    </div>
                )}

                <DistanceCard
                    distanceMeters={distanceMeters}
                    unlockDistanceMeters={task.cameraUnlockDistanceMeters}
                    unlocked={cameraUnlocked}
                    accuracyMeters={geolocation.accuracy}
                    error={geolocation.error}
                />

                {compass.needsPermissionRequest && (
                    <Button variant="outline" className="w-full" onClick={compass.requestPermission}>
                        <Compass className="h-4 w-4" />
                        Turn on compass for direction stamping
                    </Button>
                )}

                {/*
                    Warn whenever no heading is available -- not only when permission was
                    denied. Many devices simply have no magnetometer, in which case nothing
                    is "denied" and the rep would otherwise get no indication at all that
                    every photo is being stamped "Direction: N/A".
                */}
                {cameraUnlocked && !compass.needsPermissionRequest && compass.cardinal === null && (
                    <Alert variant="warning" icon={<Compass className="h-4 w-4" />}>
                        <strong className="font-semibold">No compass reading.</strong> Photos will be
                        stamped “Direction: N/A”. Move your phone in a figure-8 to calibrate it, or allow
                        Motion &amp; Orientation access.
                    </Alert>
                )}

                <ProgressTracker
                    photosCaptured={photosCaptured}
                    requiredPhotos={requiredPhotos}
                    videoCaptured={videoCaptured}
                    requiredVideo={requiredVideo}
                />

                {uploadError && (
                    <Alert variant="destructive">
                        <p>{uploadError}</p>
                        {pending && (
                            <>
                                <Button
                                    variant="outline"
                                    className="mt-3 w-full"
                                    loading={uploading}
                                    loadingText="Retrying…"
                                    onClick={() => void send(pending)}
                                >
                                    <RotateCw className="h-4 w-4" />
                                    Retry {pending.mediaType} upload
                                </Button>
                                <p className="mt-2 text-xs">
                                    Your {pending.mediaType} is saved on this phone — you will not need to
                                    take it again.
                                </p>
                            </>
                        )}
                    </Alert>
                )}

                {cameraUnlocked ? (
                    <CaptureStage
                        mode={mode}
                        cardinal={compass.cardinal}
                        stream={camera.stream}
                        cameraError={camera.error}
                        disabled={!cameraUnlocked || pending !== null}
                        busy={uploading}
                        photosDone={photosCaptured}
                        totalPhotos={requiredPhotos}
                        onPhotoCaptured={handlePhotoCaptured}
                        onVideoRecorded={handleVideoRecorded}
                    />
                ) : (
                    <Card className="border-dashed">
                        <CardContent className="p-7 text-center">
                            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <Lock className="h-5 w-5" />
                            </div>
                            <p className="font-semibold">Camera locked</p>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                It unlocks by itself once you are within{' '}
                                {formatDistance(task.cameraUnlockDistanceMeters)} of the property. Keep
                                this page open while you walk.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
