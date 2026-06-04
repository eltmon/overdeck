import { existsSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// "In container" and "behind Traefik" are two different things and must NOT be
// conflated (PAN-1153). Traefik routinely fronts the dev server while Vite runs
// on the *host* — the most common dev setup. Detect a real container only via
// the signals Docker actually provides; never via TRAEFIK_ENABLED.
//
// Use 127.0.0.1 (not `localhost`) for the host default: the dashboard server
// binds 0.0.0.0:3011 (IPv4 only), but `localhost` resolves to ::1 (IPv6) first
// on this stack, so the proxy got ECONNREFUSED and 502'd. Pinning IPv4 keeps the
// dev proxy reliable. Override with VITE_PROXY_TARGET to point at another backend
// (e.g. a workspace's own port before merge).
export function resolveProxy(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
) {
  const isContainerMode = env.CONTAINER_MODE === 'true' || fileExists('/.dockerenv');
  // The browser reaches Vite over TLS (wss) whenever Traefik fronts it — true
  // both inside the container and on a Traefik-enabled host. This drives the HMR
  // client transport only, NOT the proxy target.
  const behindTraefik = env.TRAEFIK_ENABLED === 'true' || isContainerMode;
  const apiTarget =
    env.VITE_PROXY_TARGET ?? (isContainerMode ? 'http://server:3011' : 'http://127.0.0.1:3011');
  return { isContainerMode, behindTraefik, apiTarget, wsTarget: apiTarget.replace(/^http/, 'ws') };
}

const { behindTraefik, apiTarget, wsTarget } = resolveProxy();

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
