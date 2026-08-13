import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    PutObjectCommand,
    PutPublicAccessBlockCommand,
    PutBucketCorsCommand,
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
});

let bucketReadyPromise: Promise<void> | null = null;

/**
 * Ensures the shared media bucket exists (creating it on first use) and has a
 * CORS policy that lets the rep's browser PUT photos/videos to it directly.
 * The client agreed on 2024-07-27 to a single bucket with a folder per Task ID
 * (the AWS-recommended approach) rather than one bucket per task.
 *
 * Uploads go straight from the browser to S3 via a presigned URL rather than
 * through our API, so the backend can run as short-lived serverless functions
 * (Vercel) without ever streaming large video files through them.
 */
async function ensureBucketExists(): Promise<void> {
    if (!bucketReadyPromise) {
        bucketReadyPromise = (async () => {
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
            }

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
        })();
    }
    return bucketReadyPromise;
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
    await ensureBucketExists();

    const key = `${taskId}/${fileName}`;
    const command = new PutObjectCommand({
        Bucket: config.aws.bucketName,
        Key: key,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: config.aws.presignedUrlExpirySeconds,
    });

    return {
        uploadUrl,
        bucket: config.aws.bucketName,
        key,
        fileUrl: `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`,
    };
}

/** Folder-level URL stored on tasks_field.cloud_url once the task has media. */
export function taskFolderUrl(taskId: string): string {
    return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${taskId}/`;
}
