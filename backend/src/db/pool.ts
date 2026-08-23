import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
    connectionString: config.database.connectionString,
    // Serverless fans out to many short-lived instances, each with its own pool. A
    // default-sized pool per instance exhausts Postgres' connection limit quickly, so
    // keep it to one connection each and let a pooler (Neon/Supabase pooled connection
    // string, or PgBouncer) do the real pooling.
    max: config.nodeEnv === 'production' ? 1 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});
