import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapView } from '../components/MapView';
import { CaptureStage } from '../components/CaptureStage';
import { ProgressTracker } from '../components/ProgressTracker';
import { CompletionScreen } from '../components/CompletionScreen';
import { useGeolocation } from '../hooks/useGeolocation';
import { useCompassHeading } from '../hooks/useCompassHeading';
import { ApiError, getTask, getTaskMedia, uploadMedia } from '../services/api';
import { formatDistance, haversineDistanceMeters } from '../utils/geo';
import { TaskDetails, TaskStatus } from '../types';

export function TaskField() {
    const { taskId = '' } = useParams();
    const [task, setTask] = useState<TaskDetails | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [photosCaptured, setPhotosCaptured] = useState(0);
    const [videoCaptured, setVideoCaptured] = useState(0);
    const [taskComplete, setTaskComplete] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const geolocation = useGeolocation();
    const compass = useCompassHeading();

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
        return haversineDistanceMeters(geolocation.latitude, geolocation.longitude, task.location.latitude, task.location.longitude);
    }, [task, geolocation.latitude, geolocation.longitude]);

    const cameraUnlocked = task !== null && distanceMeters !== null && distanceMeters <= task.cameraUnlockDistanceMeters;

    async function handlePhotoCaptured(blob: Blob): Promise<void> {
        if (!task || geolocation.latitude === null || geolocation.longitude === null) return;
        setUploading(true);
        setUploadError(null);
        try {
            const nextSequence = photosCaptured + 1;
            const result = await uploadMedia({
                taskId,
                mediaType: 'photo',
                sequenceNumber: nextSequence,
                contentType: 'image/jpeg',
                directionDegrees: compass.headingDegrees ?? undefined,
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                capturedAt: new Date().toISOString(),
                file: blob,
            });
            setPhotosCaptured(result.uploadedCounts.photos);
            setVideoCaptured(result.uploadedCounts.video);
            if (result.taskComplete) setTaskComplete(true);
        } catch (err) {
            setUploadError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
    }

    async function handleVideoRecorded(blob: Blob): Promise<void> {
        if (!task || geolocation.latitude === null || geolocation.longitude === null) return;
        setUploading(true);
        setUploadError(null);
        try {
            const result = await uploadMedia({
                taskId,
                mediaType: 'video',
                sequenceNumber: 1,
                contentType: 'video/webm',
                directionDegrees: compass.headingDegrees ?? undefined,
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                capturedAt: new Date().toISOString(),
                file: blob,
            });
            setPhotosCaptured(result.uploadedCounts.photos);
            setVideoCaptured(result.uploadedCounts.video);
            if (result.taskComplete) setTaskComplete(true);
        } catch (err) {
            setUploadError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
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

            {task.location && <MapView propertyLocation={task.location} repLocation={geolocation.latitude !== null && geolocation.longitude !== null ? { latitude: geolocation.latitude, longitude: geolocation.longitude } : null} />}

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

            <ProgressTracker photosCaptured={photosCaptured} requiredPhotos={requiredPhotos} videoCaptured={videoCaptured} requiredVideo={requiredVideo} />

            {uploadError && <p className="error-text">{uploadError}</p>}

            <CaptureStage
                mode={mode}
                cardinal={compass.cardinal}
                disabled={!cameraUnlocked}
                busy={uploading}
                onPhotoCaptured={handlePhotoCaptured}
                onVideoRecorded={handleVideoRecorded}
            />
        </div>
    );
}
