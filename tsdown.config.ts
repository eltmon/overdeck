import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
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
  },
  outDir: 'dist',
});
