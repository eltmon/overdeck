/**
 * Web build of the phone app (PAN-4837 WI-1, D-1). The app imports dashboard frontend source by
 * relative path, so React and React Query are deduped to one copy. `@overdeck/contracts` maps to
 * its source because the package exports only `dist/`. The channel needs browser stand-ins for
 * Node built-ins: `events` → `bare-events` and `sodium-native` → `sodium-javascript`, resolved
 * from `packages/anywhere-channel` because bun's isolated layout hides them from other packages
 * (see `packages/anywhere-channel/cp1/vite.config.ts`). The frontend's `public/` is shared so the
 * stylesheet's `/fonts/*.woff2` URLs resolve inside the WebView.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const channelRequire = createRequire(path.resolve(here, '../../packages/anywhere-channel/package.json'));

export default defineConfig({
  root: here,
  publicDir: path.resolve(here, '../../src/dashboard/frontend/public'),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: [
      { find: /^@overdeck\/contracts$/, replacement: path.resolve(here, '../../packages/contracts/src/index.ts') },
      { find: /^events$/, replacement: channelRequire.resolve('bare-events') },
      { find: /^sodium-native$/, replacement: channelRequire.resolve('sodium-javascript') },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', sourcemap: 'hidden' },
});
