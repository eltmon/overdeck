import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const includeBenchmarks = process.env['VITEST_INCLUDE_BENCH'] === '1';

export default defineConfig({
  cacheDir: '.cache/vitest',
  resolve: {
    alias: {
      '@panctl/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
    },
  },
  test: {
    name: 'root',
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      // GitHub Actions runners have limited memory (~7GB). Use 1 fork in CI to prevent OOM.
      // Local development can use up to 4 concurrent workers. PAN-805 root cause: multiple
      // reconciler tests with real async I/O (sleep/retry) exhaust heap when parallelized.
      forks: { minForks: 1, maxForks: process.env.CI ? 1 : 4, singleFork: false },
    },
    experimental: {
      // Persist transformed module cache across runs in node_modules/.experimental-vitest-cache.
      // Vitest v4 introduced this; meaningful on a ~200-file suite where re-running a
      // subset (e.g. `npm test -- foo.test.ts`) skips re-transpilation of unchanged files.
      fsModuleCache: true,
    },
    include: includeBenchmarks
      ? ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.bench.ts', 'src/**/__tests__/**/*.test.ts', 'packages/**/src/__tests__/**/*.test.ts', 'src/**/*.bench.ts']
      : ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'src/**/__tests__/**/*.test.ts', 'packages/**/src/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/dashboard/frontend/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/dashboard/**',
        'src/index.ts',
        '**/*.d.ts',
      ],
    },
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // 5s is enough for unit/integration tests; tests that legitimately need
    // more time should opt in via `test('...', { timeout: 20_000 }, ...)`.
    // Pre-PAN-1062: 10s blanket timeout masked slow tests.
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
