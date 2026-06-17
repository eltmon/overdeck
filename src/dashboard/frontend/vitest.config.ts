import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  cacheDir: '../../../.cache/vitest-frontend',
  server: { watch: null },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
    include: [
      path.resolve(__dirname, 'src/**/__tests__/**/*.test.{ts,tsx}'),
      path.resolve(__dirname, 'src/**/*.{test,spec}.{ts,tsx}'),
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
    // PAN-1918: per-test cap so one leaky test (open handle, never-settling
    // async, etc.) fails fast instead of hanging the entire frontend suite.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@panctl/contracts': path.resolve(__dirname, '../../../packages/contracts/src/index.ts'),
    },
  },
});
