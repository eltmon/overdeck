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
    // Live evals call a real model at effort 'high' (adaptive thinking / reasoning.effort);
    // Evalite's default 30s testTimeout is too short for that and times out mid-run.
    // E3 asks for a full xBRIEF at effort high; 10 minutes covers a 48K-token response.
    testTimeout: 600_000,
  },
});
