import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'ohmypi-extension',
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
