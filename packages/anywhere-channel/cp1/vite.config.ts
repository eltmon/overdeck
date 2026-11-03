/**
 * CP-1 harness build (PAN-4833 WI-10). The browser has no Node built-ins: `events` (needed by
 * `streamx`) maps to `bare-events`, and `sodium-native` maps to the pure-JS `sodium-javascript`
 * (explicit, although `sodium-universal`'s `browser` field implies it). Both aliases are absolute
 * paths because, in bun's isolated layout, `sodium-universal` cannot see this package's
 * dependencies by bare name.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  build: {
    // Relative to `root`, so this is cp1/dist.
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  resolve: {
    alias: [
      { find: /^events$/, replacement: require.resolve('bare-events') },
      { find: /^sodium-native$/, replacement: require.resolve('sodium-javascript') },
    ],
  },
});
