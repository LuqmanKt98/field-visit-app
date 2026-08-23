import { ListObjectsV2Command, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { pool } from '../db/pool';
import { config } from '../config';

/**
 * Clears captured media so a demo/test run can be repeated from scratch:
 * deletes every task_media row, resets each task to Not Started, and removes the
 * matching objects from the bucket.
 *
 * Usage: npm run reset-demo
 */
async function main(): Promise<void> {
    if (config.nodeEnv === 'production') {
        console.error('Refusing to run against production. This deletes captured media.');
        process.exit(1);
    }

    const { rows } = await pool.query<{ task_id: string }>(
        'SELECT DISTINCT task_id FROM task_media',
    );
    const taskIds = rows.map((r) => r.task_id);

    const s3 = new S3Client({
        region: config.aws.region,
        credentials: config.aws.accessKeyId
            ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
            : undefined,
    });

    let deleted = 0;
    for (const taskId of taskIds) {
        const listed = await s3.send(
            new ListObjectsV2Command({ Bucket: config.aws.bucketName, Prefix: `${taskId}/` }),
        );
        const objects = listed.Contents ?? [];
        if (objects.length > 0) {
            await s3.send(
                new DeleteObjectsCommand({
                    Bucket: config.aws.bucketName,
                    Delete: { Objects: objects.map((o) => ({ Key: o.Key! })) },
                }),
            );
            deleted += objects.length;
        }
    }

    const media = await pool.query('DELETE FROM task_media');
    await pool.query('UPDATE tasks_field SET task_status = 0, cloud_url = NULL');

    console.log(`removed ${deleted} S3 object(s) across ${taskIds.length} task folder(s)`);
    console.log(`removed ${media.rowCount} task_media row(s); all tasks reset to Not Started`);
}

main()
    .catch((err: Error) => {
        console.error('FAILED:', err.name, '-', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
