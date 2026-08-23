import { Router } from 'express';
import { z } from 'zod';
import {
    findAdminByUsername,
    findAdminById,
    verifyAdminPassword,
    issueAdminToken,
    changeAdminPassword,
    checkPasswordStrength,
} from '../services/adminService';
import { requireAdminAuth } from '../middleware/adminAuth';

export const authRouter = Router();

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'username and password are required' });
        return;
    }

    const admin = await findAdminByUsername(parsed.data.username);
    if (!admin || !(await verifyAdminPassword(admin, parsed.data.password))) {
        // Same message either way: distinguishing "no such user" from "wrong password"
        // would let someone enumerate valid usernames.
        res.status(401).json({ error: 'Invalid username or password' });
        return;
    }

    res.json({
        token: issueAdminToken(admin),
        admin: {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            mustChangePassword: admin.must_change_password,
        },
    });
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
});

// POST /api/admin/auth/change-password
// Requires a valid session AND the current password -- a stolen token alone should not
// be enough to lock the real owner out of their account.
authRouter.post('/change-password', requireAdminAuth, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'currentPassword and newPassword are required' });
        return;
    }
    const { currentPassword, newPassword } = parsed.data;

    const admin = await findAdminById(req.admin!.adminId);
    if (!admin) {
        res.status(401).json({ error: 'Session no longer valid. Please sign in again.' });
        return;
    }

    if (!(await verifyAdminPassword(admin, currentPassword))) {
        res.status(401).json({ error: 'Your current password is not correct.' });
        return;
    }

    if (currentPassword === newPassword) {
        res.status(400).json({ error: 'Your new password must be different from the current one.' });
        return;
    }

    const strength = checkPasswordStrength(newPassword, admin.username);
    if (!strength.ok) {
        res.status(400).json({ error: strength.problem });
        return;
    }

    await changeAdminPassword(admin.id, newPassword);

    // Re-issue so the session reflects that the change requirement is satisfied.
    const refreshed = await findAdminById(admin.id);
    res.json({
        token: issueAdminToken(refreshed!),
        admin: {
            id: refreshed!.id,
            username: refreshed!.username,
            email: refreshed!.email,
            mustChangePassword: false,
        },
    });
});
