import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3011',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3011',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../../dist/dashboard/public',
    emptyOutDir: true,
  },
});
