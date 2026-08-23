import 'dotenv/config';
import { randomBytes } from 'node:crypto';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

/**
 * Signing secret for admin sessions.
 *
 * There is deliberately no hard-coded fallback. A published constant here would let
 * anyone who can read this repository forge an admin token against any deployment
 * that forgot to set JWT_SECRET -- failing open, silently, into full admin access.
 * In development we mint a random per-process secret instead: sessions do not survive
 * a restart, which is a small price for never shipping a shared secret.
 */
function resolveJwtSecret(): string {
    const fromEnv = process.env.JWT_SECRET;
    if (fromEnv) return fromEnv;
    if ((process.env.NODE_ENV ?? 'development') === 'production') {
        // assertProductionConfig() reports this properly; this is the backstop for any
        // entrypoint that forgets to call it.
        throw new Error('JWT_SECRET must be set in production');
    }
    console.warn('[config] JWT_SECRET not set - using a random secret for this process only.');
    return randomBytes(32).toString('hex');
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
        secret: resolveJwtSecret(),
        expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    },

    aws: {
        region: process.env.AWS_REGION ?? 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
        bucketName: process.env.S3_BUCKET_NAME ?? 'field-visit-media',
        // How long a presigned upload URL stays valid. The browser uploads the
        // photo/video directly to S3 with this URL -- the file never passes
        // through our API, which is what keeps upload endpoints fast enough to
        // run as Vercel serverless functions regardless of file size.
        presignedUrlExpirySeconds: optionalNumber('S3_PRESIGNED_URL_EXPIRY_SECONDS', 300),
        // Viewing links live longer than upload links: an admin can reasonably leave a
        // media gallery open for longer than a single upload takes.
        downloadUrlExpirySeconds: optionalNumber('S3_DOWNLOAD_URL_EXPIRY_SECONDS', 3600),
    },

    // Field visit business rules -- kept here (and mirrored in the frontend's
    // src/config/config.ts) so they can be tuned without touching app logic,
    // per the client's request to make the camera-unlock distance configurable.
    fieldVisit: {
        // Rep must be within this many meters of the property before the camera unlocks.
        cameraUnlockDistanceMeters: optionalNumber('CAMERA_UNLOCK_DISTANCE_METERS', 100),
        requiredPhotoCount: optionalNumber('REQUIRED_PHOTO_COUNT', 10),
        requiredVideoCount: optionalNumber('REQUIRED_VIDEO_COUNT', 1),

        // Upload ceilings. A presigned PUT cannot carry a content-length-range
        // condition (only a presigned POST can), so these are enforced in two places:
        // the browser refuses to start an oversized upload, and confirm deletes
        // anything oversized that reached the bucket anyway rather than counting it.
        maxPhotoBytes: optionalNumber('MAX_PHOTO_BYTES', 15 * 1024 * 1024), // 15 MB
        maxVideoBytes: optionalNumber('MAX_VIDEO_BYTES', 200 * 1024 * 1024), // 200 MB
        // Re-checks the distance on the server on every upload so the rule cannot be
        // bypassed by editing the UI.
        //
        // Be clear about what this is NOT: the coordinates are supplied by the client,
        // so this verifies the *claim*, not the rep's actual position. A determined rep
        // can send the property's own coordinates. That ceiling is inherent to browser
        // geolocation; the claim is stored per upload so mismatches can be audited.
        enforceServerSideDistanceCheck: (process.env.ENFORCE_SERVER_SIDE_DISTANCE_CHECK ?? 'true') === 'true',
    },

    // Comma-separated list of allowed frontend origins, e.g.
    // "https://myfieldvisitapp.vercel.app,http://localhost:5173". Used both for the
    // API's CORS policy and the S3 bucket's CORS policy (browser uploads directly to
    // S3 using a presigned URL, so the bucket needs its own CORS rule too).
    allowedOrigins: (process.env.CORS_ORIGIN ?? '*').split(',').map((o) => o.trim()),
};

export function assertProductionConfig(): void {
    if (config.nodeEnv !== 'production') return;
    requireEnv('DATABASE_URL');
    requireEnv('JWT_SECRET');
    requireEnv('AWS_ACCESS_KEY_ID');
    requireEnv('AWS_SECRET_ACCESS_KEY');
    requireEnv('S3_BUCKET_NAME');
}
