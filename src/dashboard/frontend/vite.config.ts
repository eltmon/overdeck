import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Detect if running in container/Traefik mode
const isContainerMode = process.env.TRAEFIK_ENABLED === 'true' || process.env.CONTAINER_MODE === 'true';

// Backend target. Defaults to the conventional port; override with
// VITE_PROXY_TARGET to preview a workspace's own backend before merge
// (e.g. VITE_PROXY_TARGET=http://localhost:3012).
const apiTarget = process.env.VITE_PROXY_TARGET ?? (isContainerMode ? 'http://server:3011' : 'http://localhost:3011');
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    host: '0.0.0.0',
    hmr: isContainerMode ? {
      // For proxied setups (Traefik), use client's host for WebSocket
      clientPort: 443,
      protocol: 'wss',
    } : undefined,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../../dist/dashboard/public',
    emptyOutDir: true,
  },
});
