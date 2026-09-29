import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  resolve: {
    alias: {
      '@overdeck/contracts': path.resolve(repoRoot, 'packages/contracts/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globalSetup: [],
    setupFiles: [],
  },
});
