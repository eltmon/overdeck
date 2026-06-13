import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
    'supervisor/server': 'src/supervisor/server.ts',
    'pty-supervisor': 'src/lib/channels/pty-supervisor.ts',
    'lib/memory/fts-worker': 'src/lib/memory/fts-worker.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  alias: {
    '@panctl/contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts'),
  },
  deps: {
    alwaysBundle: (id) => id.startsWith('@panctl/'),
    neverBundle: ['@homebridge/node-pty-prebuilt-multiarch'],
  },
  outDir: 'dist',
});
