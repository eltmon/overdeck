import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { server: 'main.ts', 'dashboard-db-worker': 'services/dashboard-db-worker.ts' },
  outDir: '../../../dist/dashboard',
  format: 'esm',
  platform: 'node',
  shims: true,
  clean: false,
  sourcemap: true,
  outExtensions: () => ({ js: '.js' }),
  deps: {
    alwaysBundle: [/^@panctl\//],
    neverBundle: [
      '@homebridge/node-pty-prebuilt-multiarch',
      'better-sqlite3',
      'ssh2',
      /^bun:/,
      /^@effect\/platform-bun/,
    ],
  },
});
