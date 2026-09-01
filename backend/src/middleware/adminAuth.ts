import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { findAdminById } from '../services/adminService';
import { AuthenticatedRequestUser } from '../types';

declare module 'express-serve-static-core' {
    interface Request {
        admin?: AuthenticatedRequestUser;
    }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = header.slice('Bearer '.length);
    try {
        const payload = jwt.verify(token, config.jwt.secret) as AuthenticatedRequestUser;
        req.admin = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Blocks everything except changing the password while one is still outstanding.
 *
 * The forced password change was enforced only by the sign-in screen, so the token
 * handed out on a first login with the shared starting password already opened every
 * admin route -- create visits, expand links, delete a visit's media -- for its full
 * lifetime. That made the initial password, which travels by email or chat and is the
 * same for every new account, a working credential rather than a one-time one.
 *
 * The flag is read from the database rather than carried in the token, so changing the
 * password lifts this immediately instead of leaving the account locked out behind its
 * own stale claim.
 */
export async function requirePasswordChanged(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const id = req.admin?.adminId;
    if (!id) {
        res.status(401).json({ error: 'Not signed in' });
        return;
    }

    const admin = await findAdminById(id);
    if (!admin) {
        res.status(401).json({ error: 'That account no longer exists' });
        return;
    }
    if (admin.must_change_password) {
        res.status(403).json({
            error: 'Please set a new password before using the admin panel.',
            mustChangePassword: true,
        });
        return;
    }
    next();
}
