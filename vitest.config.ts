import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const includeBenchmarks = process.env['VITEST_INCLUDE_BENCH'] === '1';
const isCI = process.env['CI'] === 'true';
const isVerification = process.env['OVERDECK_VERIFICATION'] === '1';
const isFlakeLane = process.env['OVERDECK_FLAKE_LANE'] === '1';
const retryEnabled = isCI || isVerification || isFlakeLane;

function readQuarantine(): string[] {
  const quarantinePath = path.resolve(__dirname, 'scripts/flaky-quarantine.txt');
  if (!fs.existsSync(quarantinePath)) {
    return [];
  }
  return fs
    .readFileSync(quarantinePath, 'utf8')
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter((line) => line.length > 0);
}

const quarantined = readQuarantine();
const defaultInclude = includeBenchmarks
  ? ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.bench.ts', 'src/**/__tests__/**/*.test.ts', 'packages/**/src/__tests__/**/*.test.ts', 'src/**/*.bench.ts']
  : ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'src/**/__tests__/**/*.test.ts', 'packages/**/src/__tests__/**/*.test.ts'];

export default defineConfig({
  cacheDir: '.cache/vitest',
  resolve: {
    alias: {
      '@overdeck/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
    },
  },
  test: {
    name: 'root',
    globals: true,
    environment: 'node',
    pool: 'forks',
    // GitHub Actions runners and the Overdeck verification gate have limited
    // memory (~7GB). Keep CI/verification parallel but bounded; tests that OOM
    // under two forks need fixture/timer cleanup, not suite-wide serialization.
    // Local development can use up to 4 workers.
    // Vitest 4 moved these settings out of poolOptions; keeping the old shape is ignored.
    forks: { minForks: 1, maxForks: (isCI || isVerification) ? 2 : 4, singleFork: false },
    // Retry once in CI, verification-gate, and flake-lane runs. Local dev stays
    // retry:0 so flakes remain visible during development. A retried-then-passed
    // test is still surfaced by vitest's default reporter.
    retry: retryEnabled ? 1 : 0,
    experimental: {
      // Persist transformed module cache across runs in node_modules/.experimental-vitest-cache.
      // Vitest v4 introduced this; meaningful on a ~200-file suite where re-running a
      // subset (e.g. `npm test -- foo.test.ts`) skips re-transpilation of unchanged files.
      fsModuleCache: true,
    },
    include: isFlakeLane ? quarantined : defaultInclude,
    exclude: isFlakeLane
      ? ['**/node_modules/**', '**/dist/**', 'src/dashboard/frontend/**']
      : ['**/node_modules/**', '**/dist/**', 'src/dashboard/frontend/**', ...quarantined],
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
    setupFiles: ['tests/setup/overdeck-home.ts', 'tests/setup/no-real-home-writes.ts', 'tests/setup.ts'],
    // 5s is enough for unit/integration tests; tests that legitimately need
    // more time should opt in via `test('...', { timeout: 20_000 }, ...)`.
    // Pre-PAN-1062: 10s blanket timeout masked slow tests.
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
