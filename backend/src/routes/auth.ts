import { Router } from 'express';
import { z } from 'zod';
import { findAdminByUsername, verifyAdminPassword, issueAdminToken } from '../services/adminService';

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
        res.status(401).json({ error: 'Invalid username or password' });
        return;
    }

    res.json({
        token: issueAdminToken(admin),
        admin: { id: admin.id, username: admin.username, email: admin.email },
    });
});
