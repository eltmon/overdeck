import { existsSync } from 'node:fs';

import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
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

// PAN-1670: `pan dev` hot-reload restarts only the API child (3011); Vite (3010)
// stays up, so the index.html boot watchdog never fires (no asset 404) and the
// browser is left reconnecting through a Vite /ws proxy wedged on the dead
// upstream. The dev supervisor touches PAN_DEV_RELOAD_SIGNAL once the API child
// is healthy again; this plugin watches that file and pushes a full browser
// reload, which re-runs boot against the healthy stack and re-establishes the
// proxied WS — turning a frozen tab back into a brief "Reconnecting…" blip.
function panDevFullReloadOnSignal(): Plugin {
  const signalPath = process.env.PAN_DEV_RELOAD_SIGNAL;
  return {
    name: 'pan-dev-full-reload-on-signal',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      if (!signalPath) return;
      server.watcher.add(signalPath);
      const trigger = (file: string) => {
        if (file !== signalPath) return;
        server.ws.send({ type: 'full-reload', path: '*' });
        server.config.logger.info('[pan dev] API hot-reloaded → triggering full browser reload (PAN-1670)');
      };
      server.watcher.on('add', trigger);
      server.watcher.on('change', trigger);
    },
  };
}

export default defineConfig({
  plugins: [react(), panDevFullReloadOnSignal()],
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
