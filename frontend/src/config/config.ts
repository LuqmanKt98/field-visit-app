// Client-side mirror of backend/src/config/index.ts's fieldVisit block.
// These values only gate the UI (show/hide the capture button); the server
// re-validates distance and counts independently on every upload.
export const config = {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',

    fieldVisit: {
        cameraUnlockDistanceMeters: Number(import.meta.env.VITE_CAMERA_UNLOCK_DISTANCE_METERS ?? 100),
        requiredPhotoCount: Number(import.meta.env.VITE_REQUIRED_PHOTO_COUNT ?? 10),
        requiredVideoCount: Number(import.meta.env.VITE_REQUIRED_VIDEO_COUNT ?? 1),
    },
};
