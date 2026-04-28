import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API calls to the backend on port 3001.
// This way the browser thinks everything is on the same origin — no CORS issues.
//
// VITE_API_PROXY_TARGET overrides the default — used by the E2E test harness
// (Playwright sets it to http://localhost:3002 so the apps proxy at the
// in-memory test backend instead of the real local one). Production builds
// (Vercel) don't run this dev server, so prod is unaffected.
const PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
