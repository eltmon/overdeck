/** Unit tests of the phone app (PAN-4837 D-4): the build's resolve block, in happy-dom. */
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
      globals: false,
    },
  }),
);
