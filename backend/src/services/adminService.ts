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

export async function findAdminById(id: string): Promise<AdminUserRow | null> {
    const { rows } = await pool.query<AdminUserRow>('SELECT * FROM admin_users WHERE id = $1', [id]);
    return rows[0] ?? null;
}

/**
 * Creates an admin. `mustChangePassword` defaults to true because the operator running
 * this script necessarily knows the password they just typed -- requiring a change on
 * first login stops that shared secret from becoming the account's real password.
 */
export async function createAdmin(
    username: string,
    email: string,
    password: string,
    mustChangePassword = true,
): Promise<AdminUserRow> {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query<AdminUserRow>(
        `INSERT INTO admin_users (username, email, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [username, email, passwordHash, mustChangePassword],
    );
    return rows[0];
}

export async function verifyAdminPassword(admin: AdminUserRow, password: string): Promise<boolean> {
    return bcrypt.compare(password, admin.password_hash);
}

export interface PasswordRule {
    ok: boolean;
    problem?: string;
}

/**
 * Deliberately favours length over character-class rules: a long passphrase is both
 * easier to remember and harder to guess than a short one padded with symbols.
 */
export function checkPasswordStrength(password: string, username: string): PasswordRule {
    if (password.length < 10) return { ok: false, problem: 'Use at least 10 characters.' };
    if (password.length > 200) return { ok: false, problem: 'That password is too long.' };
    if (/^\d+$/.test(password)) return { ok: false, problem: 'Digits alone are too easy to guess.' };
    if (password.toLowerCase().includes(username.toLowerCase())) {
        return { ok: false, problem: 'Do not include your username in the password.' };
    }
    const common = ['password', 'fieldvisit', '12345678', 'qwerty', 'letmein', 'admin123'];
    if (common.some((c) => password.toLowerCase().includes(c))) {
        return { ok: false, problem: 'That password is too easy to guess. Pick something less common.' };
    }
    return { ok: true };
}

export async function changeAdminPassword(adminId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(
        `UPDATE admin_users
         SET password_hash = $2, must_change_password = false, password_changed_at = now()
         WHERE id = $1`,
        [adminId, passwordHash],
    );
}

export function issueAdminToken(admin: AdminUserRow): string {
    return jwt.sign(
        { adminId: admin.id, username: admin.username },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn } as jwt.SignOptions,
    );
}
