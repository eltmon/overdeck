import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    server: 'main.ts',
    'dashboard-db-worker': 'services/dashboard-db-worker.ts',
    'checkpoint-worker': '../../lib/memory/checkpoint-worker.ts',
    'memory-fts-worker': '../../lib/memory/fts-worker.ts',
  },
  outDir: '../../../dist/dashboard',
  format: 'esm',
  platform: 'node',
  shims: true,
  clean: false,
  sourcemap: true,
  outExtensions: () => ({ js: '.js' }),
  alias: {
    '@panctl/contracts': resolve(import.meta.dirname, '../../../packages/contracts/src/index.ts'),
  },
  deps: {
    alwaysBundle: [/^@panctl\//],
    neverBundle: [
      '@homebridge/node-pty-prebuilt-multiarch',
      'ssh2',
      // PAN-1645: playwright is loaded only via a runtime `await import('playwright')`
      // (artifact thumbnails). Bundling it pulls in playwright-core's prebundled
      // coreBundle.js, which has an internal `require("chromium-bidi/...")` for a
      // package playwright does not ship — emitting UNRESOLVED_IMPORT warnings that
      // the workspace docker `init` guard turns into exit 1 (forcing --host).
      // Externalizing it keeps it resolved from node_modules at runtime and drops
      // a 5.6 MB browser chunk from the server bundle.
      'playwright',
      'playwright-core',
      /^chromium-bidi/,
      /^bun:/,
      /^@effect\/platform-bun/,
    ],
  },
});
