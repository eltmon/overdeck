import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  noExternal: ['@panopticon/shared'],
  tsconfig: './tsconfig.json',
});
