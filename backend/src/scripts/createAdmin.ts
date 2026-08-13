import { createAdmin } from '../services/adminService';
import { pool } from '../db/pool';

// Usage: npm run create-admin -- <username> <email> <password>
async function main(): Promise<void> {
    const [username, email, password] = process.argv.slice(2);
    if (!username || !email || !password) {
        console.error('Usage: npm run create-admin -- <username> <email> <password>');
        process.exitCode = 1;
        return;
    }

    const admin = await createAdmin(username, email, password);
    console.log(`Created admin user: ${admin.username} (${admin.email})`);
}

main()
    .catch((err) => {
        console.error('Failed to create admin:', err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
