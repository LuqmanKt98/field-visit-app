import { provisionBucket } from '../services/s3Service';
import { config } from '../config';

/**
 * One-off setup for an environment's S3 bucket: creates it if needed, blocks public
 * access, enables default encryption, and sets the CORS rule for browser uploads.
 *
 * Run once per environment, and again whenever CORS_ORIGIN changes:
 *   npm run provision-s3
 *
 * Deliberately NOT part of the request path -- see provisionBucket()'s comment. Note
 * the CORS rule is derived from CORS_ORIGIN, so run this with production's value when
 * provisioning production, or a preview environment's origins will replace it.
 */
async function main(): Promise<void> {
    console.log(`bucket : ${config.aws.bucketName}`);
    console.log(`region : ${config.aws.region}`);
    console.log(`CORS   : ${config.allowedOrigins.join(', ')}`);
    if (config.allowedOrigins.includes('*')) {
        console.warn('WARNING: CORS_ORIGIN is "*" - set it to your real frontend URL before production.');
    }

    await provisionBucket();
    console.log('\nBucket provisioned.');
}

main().catch((err: Error) => {
    console.error('FAILED:', err.name, '-', err.message);
    process.exit(1);
});
