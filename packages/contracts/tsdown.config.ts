import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
    outDir: 'dist',
  },
  {
    entry: ['src/index.ts'],
    format: 'cjs',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.cjs' }),
    outDir: 'dist',
  },
]);
