import { pool } from '../db/pool';

/**
 * Points a task at a given latitude/longitude.
 *
 * Needed for testing on a real phone: the camera only unlocks within
 * CAMERA_UNLOCK_DISTANCE_METERS of the task's coordinates, so a tester who is not
 * standing at the property has to move the task to where they actually are.
 *
 * Usage: npm run set-task-location -- <taskId> <lat> <lng>
 */
async function main(): Promise<void> {
    const [taskId, lat, lng] = process.argv.slice(2);
    if (!taskId || !lat || !lng) {
        console.error('Usage: npm run set-task-location -- <taskId> <lat> <lng>');
        process.exitCode = 1;
        return;
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
        console.error(`Invalid latitude: ${lat}`);
        process.exitCode = 1;
        return;
    }
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        console.error(`Invalid longitude: ${lng}`);
        process.exitCode = 1;
        return;
    }

    const result = await pool.query(
        `UPDATE tasks_field
         SET g_latitude = $2, g_longitude = $3, updated_by = 'set-task-location', updated_timestamp = now()
         WHERE task_id = $1`,
        [taskId, String(latitude), String(longitude)],
    );

    if (result.rowCount === 0) {
        console.error(`No task found with ID ${taskId}`);
        process.exitCode = 1;
        return;
    }
    console.log(`Task ${taskId} is now at ${latitude}, ${longitude}`);
}

main()
    .catch((err: Error) => {
        console.error('FAILED:', err.name, '-', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
