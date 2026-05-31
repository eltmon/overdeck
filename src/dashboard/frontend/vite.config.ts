import { existsSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// "In container" and "behind Traefik" are two different things and must not be
// conflated (PAN-1153). Traefik routinely fronts the dev server while Vite runs
// on the *host* — the most common dev setup. Detect a real container via the
// signals Docker actually provides; never via TRAEFIK_ENABLED.
const isContainerMode = process.env.CONTAINER_MODE === 'true' || existsSync('/.dockerenv');

// The browser reaches Vite over TLS (wss) whenever Traefik fronts it — true
// both inside the container and on a Traefik-enabled host. This drives the HMR
// client transport only, NOT the proxy target.
const behindTraefik = process.env.TRAEFIK_ENABLED === 'true' || isContainerMode;

// Backend target. Defaults to the conventional port; override with
// VITE_PROXY_TARGET to preview a workspace's own backend before merge
// (e.g. VITE_PROXY_TARGET=http://localhost:3012).
//
// Use 127.0.0.1 (not `localhost`) for the host-mode default: the dashboard
// server binds 0.0.0.0:3011 (IPv4 only), but `localhost` resolves to ::1
// (IPv6) first on this stack, so Vite's proxy got ECONNREFUSED and returned
// 502 for every /api and /ws call. Pinning IPv4 makes the dev proxy reliable.
const apiTarget = process.env.VITE_PROXY_TARGET ?? (isContainerMode ? 'http://server:3011' : 'http://127.0.0.1:3011');
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    host: '0.0.0.0',
    hmr: behindTraefik ? {
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
