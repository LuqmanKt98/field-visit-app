import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';

// Minimal, dependency-free migration runner: applies every .sql file in
// db/migrations in filename order, tracking what's already been applied in
// a schema_migrations table so it's safe to re-run.
async function runMigrations(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`skip  ${file} (already applied)`);
            continue;
        }
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        console.log(`apply ${file}`);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    console.log('Migrations complete.');
}

runMigrations()
    .then(() => pool.end())
    .catch((err) => {
        console.error('Migration failed:', err);
        pool.end().finally(() => process.exit(1));
    });
