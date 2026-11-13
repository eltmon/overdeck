import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import pdfjsPkg from 'pdfjs-dist/package.json' with { type: 'json' };

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

// PAN-5188: the PDF viewer globs pdf.js fonts, cmaps and wasm through this
// alias. bun links packages from a store under the repo root, so a path
// relative to node_modules would match nothing; the alias is the real folder.
const pdfjsAssetsAlias = {
  find: 'pdfjs-dist-assets',
  replacement: path.dirname(realpathSync(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))),
};

// PAN-4560: `vite build --mode profile` aliases react-dom to its profiling
// build, so React records per-fiber render timings in production mode. The
// output goes to the gitignored .tmp/dashboard-profile; it must never
// overwrite the normal dist/dashboard/public.
const profileOverrides = {
  resolve: {
    alias: [{ find: /^react-dom$/, replacement: 'react-dom/profiling' }, pdfjsAssetsAlias],
  },
  build: {
    outDir: '../../../.tmp/dashboard-profile',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
  },
} as const;

export default defineConfig(({ mode }) => ({
  plugins: [react(), panDevFullReloadOnSignal()],
  resolve: {
    alias: [pdfjsAssetsAlias],
  },
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
    sourcemap: 'hidden',
    rolldownOptions: {
      output: {
        // PDF.js resolves its decoder modules relative to wasmUrl, so its wasm
        // assets keep stable names in one folder (t3code vite.config.ts, PAN-5188).
        assetFileNames: (asset) =>
          asset.originalFileNames.some((p) => /[/\\]pdfjs-dist[/\\]wasm[/\\]/.test(p))
            ? `assets/pdfjs-${pdfjsPkg.version}/[name][extname]`
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Workers build as ES modules so they can code-split dynamic imports (sql.js, tiff; PAN-5188 D-8).
  worker: { format: 'es' },
  ...(mode === 'profile' ? profileOverrides : {}),
}));
