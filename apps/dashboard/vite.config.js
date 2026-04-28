import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on port 5175. Proxies API calls to the backend on 3001 by
// default; Playwright sets VITE_API_PROXY_TARGET=http://localhost:3002 to
// route through the local-PG harness.
const API_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
