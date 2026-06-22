import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The React plugin sets esbuild's automatic JSX runtime so component/hook
// tests (*.test.jsx) compile without an explicit `import React`. Without it,
// JSX falls back to the classic `React.createElement` transform and every
// component test throws "React is not defined". jsdom is the default env so
// @testing-library/react can mount.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
  },
});
