import { S3Client, HeadObjectCommand, DeleteObjectCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { createPresignedUploadUrl } from '../services/s3Service';
import { config } from '../config';

/**
 * End-to-end check of the S3 upload path using the current environment:
 * presign -> direct PUT (exactly as the browser does it) -> verify -> clean up.
 *
 * Run after any change to AWS credentials, region, bucket name, or CORS_ORIGIN --
 * particularly after deploying, since the bucket's CORS policy is derived from
 * CORS_ORIGIN and a mismatch there breaks uploads only in a real browser.
 *
 * Usage: npm run verify-s3
 */
async function main(): Promise<void> {
    console.log(`region=${config.aws.region} bucket=${config.aws.bucketName}`);
    console.log(`allowed origins=${config.allowedOrigins.join(', ')}`);

    const testKey = '__healthcheck';
    const { uploadUrl, key } = await createPresignedUploadUrl({
        taskId: testKey,
        fileName: 'probe.jpg',
        contentType: 'image/jpeg',
    });
    console.log('1. presign                 OK ->', key);

    const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: Buffer.from('s3-connectivity-probe'),
    });
    if (!put.ok) {
        console.error('2. direct PUT              FAILED ->', put.status, await put.text());
        process.exit(1);
    }
    console.log('2. direct browser-style PUT OK ->', put.status);

    const client = new S3Client({
        region: config.aws.region,
        credentials: config.aws.accessKeyId
            ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
            : undefined,
    });

    const head = await client.send(new HeadObjectCommand({ Bucket: config.aws.bucketName, Key: key }));
    console.log(`3. object stored           OK -> ${head.ContentLength} bytes, encryption: ${head.ServerSideEncryption}`);

    const cors = await client.send(new GetBucketCorsCommand({ Bucket: config.aws.bucketName }));
    console.log('4. bucket CORS             OK ->', JSON.stringify(cors.CORSRules?.[0]?.AllowedOrigins));

    await client.send(new DeleteObjectCommand({ Bucket: config.aws.bucketName, Key: key }));
    console.log('5. probe object removed    OK');
    console.log('\nS3 upload path is working.');
}

main().catch((err: Error) => {
    console.error('FAILED:', err.name, '-', err.message);
    process.exit(1);
});
