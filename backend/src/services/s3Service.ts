import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    PutPublicAccessBlockCommand,
    PutBucketCorsCommand,
    PutBucketEncryptionCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

const s3Client = new S3Client({
    region: config.aws.region,
    credentials: config.aws.accessKeyId
        ? {
              accessKeyId: config.aws.accessKeyId,
              secretAccessKey: config.aws.secretAccessKey,
          }
        : undefined, // falls back to the default AWS credential chain (e.g. IAM role) if unset

    // Since v3.729 the SDK adds a CRC32 checksum to PutObject by default. When
    // presigning, that checksum is computed over an empty body and baked into the
    // signature, so the browser's later PUT of the real file always fails with
    // SignatureDoesNotMatch. WHEN_REQUIRED keeps checksums off unless an operation
    // actually mandates them, which is what makes presigned uploads work.
    requestChecksumCalculation: 'WHEN_REQUIRED',
});

/**
 * Creates the media bucket if absent and applies its policies. The client agreed on
 * 2024-07-27 to a single bucket with a folder per Task ID (the AWS-recommended
 * approach) rather than one bucket per task.
 *
 * This is a PROVISIONING step -- run once per environment via `npm run provision-s3`,
 * never from a request. Doing it on every cold start meant the runtime IAM user needed
 * permanent bucket-administration rights, and worse, the CORS rule is derived from each
 * instance's CORS_ORIGIN: a preview deployment would silently overwrite production's
 * bucket CORS and break uploads for real reps (last cold start wins).
 */
export async function provisionBucket(): Promise<void> {
    let bucketExists = true;
    try {
        await s3Client.send(new HeadBucketCommand({ Bucket: config.aws.bucketName }));
    } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status !== 404 && status !== 403) throw err;
        bucketExists = false;
    }

    if (!bucketExists) {
        await s3Client.send(
            new CreateBucketCommand({
                Bucket: config.aws.bucketName,
                ...(config.aws.region !== 'us-east-1'
                    ? { CreateBucketConfiguration: { LocationConstraint: config.aws.region as never } }
                    : {}),
            }),
        );
        console.log(`created bucket ${config.aws.bucketName} in ${config.aws.region}`);
    }

    await s3Client.send(
        new PutPublicAccessBlockCommand({
            Bucket: config.aws.bucketName,
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                IgnorePublicAcls: true,
                BlockPublicPolicy: true,
                RestrictPublicBuckets: true,
            },
        }),
    );

    // Encryption at rest is set as a bucket-level default rather than a per-object
    // header. A presigned URL can only carry headers the browser actually sends, so
    // requiring x-amz-server-side-encryption per object would break the upload. The
    // bucket default applies to every object regardless of how it arrives.
    await s3Client.send(
        new PutBucketEncryptionCommand({
            Bucket: config.aws.bucketName,
            ServerSideEncryptionConfiguration: {
                Rules: [
                    {
                        ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
                        BucketKeyEnabled: true,
                    },
                ],
            },
        }),
    );

    await s3Client.send(
        new PutBucketCorsCommand({
            Bucket: config.aws.bucketName,
            CORSConfiguration: {
                CORSRules: [
                    {
                        AllowedMethods: ['PUT'],
                        AllowedOrigins: config.allowedOrigins,
                        AllowedHeaders: ['Content-Type'],
                        ExposeHeaders: ['ETag'],
                        MaxAgeSeconds: 3600,
                    },
                ],
            },
        }),
    );
}

export interface PresignedUploadParams {
    taskId: string;
    fileName: string;
    contentType: string;
}

export interface PresignedUploadResult {
    uploadUrl: string;
    bucket: string;
    key: string;
    fileUrl: string;
}

/** Generates a short-lived URL the browser can PUT the photo/video to directly. */
export async function createPresignedUploadUrl({
    taskId,
    fileName,
    contentType,
}: PresignedUploadParams): Promise<PresignedUploadResult> {
    // No bucket bootstrap here -- see provisionBucket(). Signing is local computation,
    // so this path makes no AWS calls at all.
    const key = `${taskId}/${fileName}`;
    const command = new PutObjectCommand({
        Bucket: config.aws.bucketName,
        Key: key,
        ContentType: contentType,
    });

    // signableHeaders is what actually binds Content-Type into the signature. Setting
    // ContentType on the command alone does NOT: by default only `host` is signed, so
    // the browser could PUT any type it liked (text/html included) and S3 would store
    // it -- making every content-type check in the API decorative. Naming it here
    // forces the PUT to match or fail the signature check.
    const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: config.aws.presignedUrlExpirySeconds,
        signableHeaders: new Set(['content-type', 'host']),
    });

    return {
        uploadUrl,
        bucket: config.aws.bucketName,
        key,
        fileUrl: `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`,
    };
}

export interface StoredObject {
    sizeBytes: number;
    contentType: string | undefined;
}

/**
 * Reads back an object's size and stored Content-Type (or null if it is absent).
 *
 * The browser uploads straight to S3, so the API never sees the bytes. Without this
 * check a client could call /media/confirm having uploaded nothing and the task would
 * be marked complete with missing files -- the requirement is that the task completes
 * only once the media is *stored successfully*.
 */
export async function headUploadedObject(key: string): Promise<StoredObject | null> {
    try {
        const head = await s3Client.send(
            new HeadObjectCommand({ Bucket: config.aws.bucketName, Key: key }),
        );
        return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return null;
        throw err;
    }
}

/**
 * Short-lived URL for *viewing* a stored photo/video.
 *
 * The bucket is private (public access is fully blocked), so a raw
 * https://bucket.s3.region.amazonaws.com/... link returns 403 AccessDenied. Anything
 * that needs to display media -- the admin dashboard in particular -- has to go
 * through a presigned GET like this one.
 */
export async function createPresignedDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
        s3Client,
        new GetObjectCommand({
            Bucket: config.aws.bucketName,
            Key: key,
            // Override the response type from the key's own extension rather than
            // letting the object's stored Content-Type decide. If a bad object ever
            // lands in the bucket, this stops the presigned URL from serving it as
            // something the browser would execute on the AWS origin.
            ResponseContentType: responseContentTypeForKey(key),
        }),
        { expiresIn: config.aws.downloadUrlExpirySeconds },
    );
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webm: 'video/webm',
    mp4: 'video/mp4',
};

function responseContentTypeForKey(key: string): string {
    const extension = key.split('.').pop()?.toLowerCase() ?? '';
    return EXTENSION_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/** Removes an object -- used to discard an upload that broke the size ceiling. */
export async function deleteObject(key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({ Bucket: config.aws.bucketName, Key: key }));
}

/** Folder-level URL stored on tasks_field.cloud_url once the task has media. */
export function taskFolderUrl(taskId: string): string {
    return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${taskId}/`;
}
