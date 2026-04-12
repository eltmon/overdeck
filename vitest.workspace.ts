import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './vitest.config.ts',
  './src/dashboard/frontend/vitest.config.ts',
  './apps/desktop/vitest.config.ts',
]);
