import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

process.env.OVERDECK_TEST_HOME_ROOT = mkdtempSync(path.join(tmpdir(), 'pan-test-root-'));

export default defineConfig({
  cacheDir: '.cache/vitest',
  resolve: { alias: { '@overdeck/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts') } },
  test: {
    name: 'root',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/dashboard/frontend/**', '**/*.slow.test.ts'],
    setupFiles: ['tests/setup/overdeck-home.ts', 'tests/setup/no-real-home-writes.ts', 'tests/setup.ts'],
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
