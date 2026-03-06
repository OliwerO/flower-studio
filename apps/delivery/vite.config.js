import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on port 5174 (florist is on 5173).
// Proxies API calls to the same backend on port 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
