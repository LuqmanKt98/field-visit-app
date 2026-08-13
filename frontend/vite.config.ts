import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Allows testing camera/geolocation from a phone on the same network via HTTPS
        // (getUserMedia and geolocation require a secure context on real devices).
        host: true,
    },
});
