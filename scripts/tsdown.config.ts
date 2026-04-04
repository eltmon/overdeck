import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['record-cost-event.ts'],
  format: 'esm',
  platform: 'node',
  shims: true,
  outDir: '.',
  clean: false,
  outExtensions: () => ({ js: '.js' }),
});
