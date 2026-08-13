import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
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
