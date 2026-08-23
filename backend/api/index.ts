import { app } from '../src/app';
import { assertProductionConfig } from '../src/config';

// Vercel never runs src/server.ts -- it imports this module and calls the exported
// handler. The production config guard therefore has to run here as well, or a
// deployment missing JWT_SECRET / DATABASE_URL / AWS credentials would boot anyway
// and fail open instead of refusing to start.
assertProductionConfig();

// Vercel's Node runtime accepts any (req, res) => void handler, and an Express
// app instance satisfies that signature directly -- see vercel.json for the
// rewrite that routes every request here.
export default app;
