import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API calls to the backend on port 3001 by default.
// Playwright (E2E) sets VITE_API_PROXY_TARGET=http://localhost:3002 so the
// proxy routes through the local-PG harness backend instead of a real one.
const API_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
