import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapView } from '../components/MapView';
import { CaptureStage } from '../components/CaptureStage';
import { ProgressTracker } from '../components/ProgressTracker';
import { CompletionScreen } from '../components/CompletionScreen';
import { useGeolocation } from '../hooks/useGeolocation';
import { useCompassHeading } from '../hooks/useCompassHeading';
import { useCameraStream } from '../hooks/useCameraStream';
import { ApiError, getTask, getTaskMedia, uploadMedia, UploadContentType } from '../services/api';
import { formatDistance, haversineDistanceMeters } from '../utils/geo';
import { TaskDetails, TaskStatus } from '../types';

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
            <div className="page page-centered">
                <div className="card">
                    <h1>Task not found</h1>
                    <p className="muted">{loadError}</p>
                </div>
            </div>
        );
    }

    if (!task) {
        return (
            <div className="page page-centered">
                <div className="card">Loading task…</div>
            </div>
        );
    }

    if (taskComplete) {
        return (
            <div className="page page-centered">
                <CompletionScreen />
            </div>
        );
    }

    const requiredPhotos = task.requiredPhotoCount;
    const requiredVideo = task.requiredVideoCount;
    const mode: 'photo' | 'video' = photosCaptured < requiredPhotos ? 'photo' : 'video';

    return (
        <div className="page">
            <header className="task-header">
                <h1>Task #{task.taskId}</h1>
                <p className="muted">{task.address.fullAddress}</p>
            </header>

            {task.location && (
                <MapView
                    propertyLocation={task.location}
                    repLocation={
                        geolocation.latitude !== null && geolocation.longitude !== null
                            ? { latitude: geolocation.latitude, longitude: geolocation.longitude }
                            : null
                    }
                />
            )}

            <div className="distance-banner" data-unlocked={cameraUnlocked}>
                {geolocation.error && <p className="error-text">Location error: {geolocation.error}</p>}
                {distanceMeters !== null ? (
                    <p>
                        {cameraUnlocked
                            ? 'You are close enough to the property. Camera unlocked.'
                            : `Move closer to the property. You are ${formatDistance(distanceMeters)} away (need to be within ${formatDistance(task.cameraUnlockDistanceMeters)}).`}
                    </p>
                ) : (
                    <p>Getting your location…</p>
                )}
            </div>

            {compass.needsPermissionRequest && (
                <button type="button" className="btn btn-secondary" onClick={compass.requestPermission}>
                    Enable compass for direction stamping
                </button>
            )}
            {/*
                Warn whenever no heading is available -- not only when permission was
                denied. Many devices simply have no magnetometer, in which case nothing
                is "denied" and the rep would otherwise get no indication at all that
                every photo is being stamped "Direction: N/A".
            */}
            {cameraUnlocked && !compass.needsPermissionRequest && compass.cardinal === null && (
                <div className="warning-banner">
                    <strong>No compass reading.</strong> Photos will be stamped “Direction: N/A”. Try moving
                    the phone in a figure-8 to calibrate, or check that Motion &amp; Orientation access is
                    enabled in your browser settings.
                </div>
            )}

            <ProgressTracker
                photosCaptured={photosCaptured}
                requiredPhotos={requiredPhotos}
                videoCaptured={videoCaptured}
                requiredVideo={requiredVideo}
            />

            {uploadError && (
                <div className="upload-error">
                    <p className="error-text">{uploadError}</p>
                    {pending && (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={uploading}
                            onClick={() => void send(pending)}
                        >
                            {uploading ? 'Retrying…' : `Retry ${pending.mediaType} upload`}
                        </button>
                    )}
                </div>
            )}

            {cameraUnlocked ? (
                <CaptureStage
                    mode={mode}
                    cardinal={compass.cardinal}
                    stream={camera.stream}
                    cameraError={camera.error}
                    disabled={!cameraUnlocked || pending !== null}
                    busy={uploading}
                    onPhotoCaptured={handlePhotoCaptured}
                    onVideoRecorded={handleVideoRecorded}
                />
            ) : (
                <div className="capture-locked">
                    The camera unlocks automatically when you are within{' '}
                    {formatDistance(task.cameraUnlockDistanceMeters)} of the property.
                </div>
            )}
        </div>
    );
}
