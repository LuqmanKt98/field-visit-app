interface ProgressTrackerProps {
    photosCaptured: number;
    requiredPhotos: number;
    videoCaptured: number;
    requiredVideo: number;
}

export function ProgressTracker({ photosCaptured, requiredPhotos, videoCaptured, requiredVideo }: ProgressTrackerProps) {
    return (
        <div className="progress-tracker">
            <div className="progress-row">
                <span>Photos</span>
                <span>
                    {photosCaptured} / {requiredPhotos}
                </span>
            </div>
            <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${(photosCaptured / requiredPhotos) * 100}%` }} />
            </div>

            <div className="progress-row">
                <span>Video</span>
                <span>
                    {videoCaptured} / {requiredVideo}
                </span>
            </div>
            <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${(videoCaptured / requiredVideo) * 100}%` }} />
            </div>
        </div>
    );
}
