import { app } from '../src/app';

// Vercel's Node runtime accepts any (req, res) => void handler, and an Express
// app instance satisfies that signature directly -- see vercel.json for the
// rewrite that routes every request here.
export default app;
