import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
    'supervisor/server': 'src/supervisor/server.ts',
    'pty-supervisor': 'src/lib/channels/pty-supervisor.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    alwaysBundle: (id) => id.startsWith('@panctl/'),
    neverBundle: ['@homebridge/node-pty-prebuilt-multiarch'],
  },
  outDir: 'dist',
});
