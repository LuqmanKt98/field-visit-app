import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { config } from '../config';
import { AdminUserRow } from '../types';

const SALT_ROUNDS = 12;

export async function findAdminByUsername(username: string): Promise<AdminUserRow | null> {
    const { rows } = await pool.query<AdminUserRow>(
        'SELECT * FROM admin_users WHERE username = $1',
        [username],
    );
    return rows[0] ?? null;
}

export async function createAdmin(username: string, email: string, password: string): Promise<AdminUserRow> {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query<AdminUserRow>(
        `INSERT INTO admin_users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
        [username, email, passwordHash],
    );
    return rows[0];
}

export async function verifyAdminPassword(admin: AdminUserRow, password: string): Promise<boolean> {
    return bcrypt.compare(password, admin.password_hash);
}

export function issueAdminToken(admin: AdminUserRow): string {
    return jwt.sign(
        { adminId: admin.id, username: admin.username },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn } as jwt.SignOptions,
    );
}
