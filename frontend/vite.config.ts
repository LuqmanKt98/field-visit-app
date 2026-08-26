import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        // Matched to Tailwind v4's own floor (Safari 16.4 / Chrome 111 / Firefox 128).
        //
        // Targeting older engines here would be false comfort: Tailwind v4 compiles
        // every opacity modifier (`bg-muted/40`) to `color-mix()`, which older browsers
        // ignore outright, so the page would parse and then render without its
        // backgrounds. Since the CSS cannot go lower, the JS target says so honestly,
        // and index.html gates anything below this with a plain upgrade message rather
        // than letting it load into a broken layout.
        target: ['es2022', 'chrome111', 'safari16.4', 'firefox128'],
    },
    resolve: {
        // "@/..." is the import alias shadcn/ui components expect.
        alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
        port: 5173,
        // Allows testing camera/geolocation from a phone on the same network via HTTPS
        // (getUserMedia and geolocation require a secure context on real devices).
        host: true,
    },
});
