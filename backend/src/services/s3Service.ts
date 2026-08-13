import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    PutObjectCommand,
    PutPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
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
 * Ensures the shared media bucket exists, creating it once on first use.
 * The client agreed on 2024-07-27 to a single bucket with a folder per Task ID
 * (the AWS-recommended approach) rather than one bucket per task.
 */
async function ensureBucketExists(): Promise<void> {
    if (!bucketReadyPromise) {
        bucketReadyPromise = (async () => {
            try {
                await s3Client.send(new HeadBucketCommand({ Bucket: config.aws.bucketName }));
                return;
            } catch (err) {
                const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
                if (status !== 404 && status !== 403) throw err;
            }

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
        })();
    }
    return bucketReadyPromise;
}

export interface UploadMediaParams {
    taskId: string;
    fileName: string;
    body: Buffer;
    contentType: string;
}

export interface UploadMediaResult {
    bucket: string;
    key: string;
    url: string;
}

export async function uploadTaskMedia({
    taskId,
    fileName,
    body,
    contentType,
}: UploadMediaParams): Promise<UploadMediaResult> {
    await ensureBucketExists();

    const key = `${taskId}/${fileName}`;
    await s3Client.send(
        new PutObjectCommand({
            Bucket: config.aws.bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
            ServerSideEncryption: 'AES256',
        }),
    );

    const url = `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`;
    return { bucket: config.aws.bucketName, key, url };
}

/** Folder-level URL stored on tasks_field.cloud_url once the task has media. */
export function taskFolderUrl(taskId: string): string {
    return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${taskId}/`;
}
