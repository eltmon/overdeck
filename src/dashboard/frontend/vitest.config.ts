import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  cacheDir: '../../../.cache/vitest-frontend',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
    include: [
      path.resolve(__dirname, 'src/**/__tests__/**/*.test.{ts,tsx}'),
      path.resolve(__dirname, 'src/**/*.{test,spec}.{ts,tsx}'),
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@panctl/contracts': path.resolve(__dirname, '../../../packages/contracts/src/index.ts'),
    },
  },
});
