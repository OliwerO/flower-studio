import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_PROXY_TARGET overrides the default — see apps/florist/vite.config.js.
const PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
