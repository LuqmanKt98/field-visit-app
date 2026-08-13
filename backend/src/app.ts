import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { config } from './config';
import { tasksRouter } from './routes/tasks';
import { mediaRouter } from './routes/media';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';

export const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/tasks', mediaRouter);
app.use('/api/admin/auth', authRouter);
app.use('/api/admin', adminRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (err instanceof Error && err.message.includes('File too large')) {
        res.status(413).json({ error: 'File too large' });
        return;
    }
    res.status(500).json({ error: 'Internal server error' });
});
