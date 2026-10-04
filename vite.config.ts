import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite configuration for NexStream.
 * - react()      : JSX/TSX transform + Fast Refresh
 * - tailwindcss(): Tailwind CSS v4 (no tailwind.config.js needed in v4)
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    // The live preview is served through a proxied host name, so we must not
    // reject requests whose Host header is not localhost.
    allowedHosts: true,
    cors: true,
  },
  preview: { port: 3000, host: '0.0.0.0', allowedHosts: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
