/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_GOOGLE_MAPS_API_KEY: string;
    readonly VITE_CAMERA_UNLOCK_DISTANCE_METERS: string;
    readonly VITE_REQUIRED_PHOTO_COUNT: string;
    readonly VITE_REQUIRED_VIDEO_COUNT: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
