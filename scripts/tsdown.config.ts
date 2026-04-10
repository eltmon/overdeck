import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['record-cost-event.ts'],
  format: 'esm',
  platform: 'node',
  shims: true,
  outDir: '.',
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  // Bundle all dependencies inline — this script runs standalone at ~/.panopticon/bin/
  // with no node_modules, so imports like 'yaml' must be embedded.
  noExternal: [/.*/],
});
