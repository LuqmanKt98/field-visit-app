import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
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
