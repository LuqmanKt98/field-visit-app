import 'dotenv/config';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function optionalNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
    port: optionalNumber('PORT', 4000),
    nodeEnv: process.env.NODE_ENV ?? 'development',

    database: {
        connectionString: process.env.DATABASE_URL ?? '',
    },

    jwt: {
        secret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
        expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    },

    aws: {
        region: process.env.AWS_REGION ?? 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
        bucketName: process.env.S3_BUCKET_NAME ?? 'field-visit-media',
    },

    // Field visit business rules -- kept here (and mirrored in the frontend's
    // src/config/config.ts) so they can be tuned without touching app logic,
    // per the client's request to make the camera-unlock distance configurable.
    fieldVisit: {
        // Rep must be within this many meters of the property before the camera unlocks.
        cameraUnlockDistanceMeters: optionalNumber('CAMERA_UNLOCK_DISTANCE_METERS', 100),
        requiredPhotoCount: optionalNumber('REQUIRED_PHOTO_COUNT', 10),
        requiredVideoCount: optionalNumber('REQUIRED_VIDEO_COUNT', 1),
        // If true, the server independently re-checks the rep's reported GPS position
        // against the property location on every upload, instead of trusting the client.
        enforceServerSideDistanceCheck: (process.env.ENFORCE_SERVER_SIDE_DISTANCE_CHECK ?? 'true') === 'true',
    },

    corsOrigin: process.env.CORS_ORIGIN ?? '*',
};

export function assertProductionConfig(): void {
    if (config.nodeEnv !== 'production') return;
    requireEnv('DATABASE_URL');
    requireEnv('JWT_SECRET');
    requireEnv('AWS_ACCESS_KEY_ID');
    requireEnv('AWS_SECRET_ACCESS_KEY');
    requireEnv('S3_BUCKET_NAME');
}
