import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';

/**
 * Lists what is actually stored in the bucket for a task, so a completed task can be
 * checked against real objects rather than against what the database claims.
 *
 * Usage: npm run list-task-media -- <taskId>
 */
async function main(): Promise<void> {
    const taskId = process.argv[2];
    if (!taskId) {
        console.error('Usage: npm run list-task-media -- <taskId>');
        process.exitCode = 1;
        return;
    }

    const s3 = new S3Client({
        region: config.aws.region,
        credentials: config.aws.accessKeyId
            ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
            : undefined,
    });

    const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: config.aws.bucketName, Prefix: `${taskId}/` }),
    );
    const objects = (listed.Contents ?? []).sort((a, b) => (a.Key! < b.Key! ? -1 : 1));

    console.log(`bucket : ${config.aws.bucketName} (${config.aws.region})`);
    console.log(`prefix : ${taskId}/`);
    console.log(`objects: ${objects.length}\n`);
    for (const o of objects) {
        console.log(`  ${o.Key}  ${(o.Size ?? 0).toLocaleString()} bytes`);
    }

    const distinct = new Set(objects.map((o) => o.Key));
    const expected = config.fieldVisit.requiredPhotoCount + config.fieldVisit.requiredVideoCount;
    console.log(
        `\n${distinct.size} distinct object(s); a completed task should have ${expected}.`,
    );
}

main().catch((err: Error) => {
    console.error('FAILED:', err.name, '-', err.message);
    process.exit(1);
});
