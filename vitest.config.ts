import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.cache/vitest',
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
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
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
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
