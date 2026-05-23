import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Detect if running in container/Traefik mode
const isContainerMode = process.env.TRAEFIK_ENABLED === 'true' || process.env.CONTAINER_MODE === 'true';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@panctl/contracts': path.resolve(__dirname, '../../../packages/contracts/src/index.ts'),
    },
  },
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
        target: isContainerMode ? 'http://server:3011' : 'http://localhost:3011',
        changeOrigin: true,
      },
      '/ws': {
        target: isContainerMode ? 'ws://server:3011' : 'ws://localhost:3011',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../../dist/dashboard/public',
    emptyOutDir: true,
  },
});
