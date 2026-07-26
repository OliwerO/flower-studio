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
    env: {
      // Force a positive-UTC-offset zone (the studio's own timezone) so
      // local-vs-UTC-day-boundary bugs (e.g. a revert to `.toISOString()`
      // in writeOffPeriods.js) actually manifest under test. Under UTC
      // (CI's default), local reads and `.toISOString()` reads never
      // diverge, so this suite would silently pass a regression without
      // this override — see the TZ regression lock tests in
      // writeOffPeriods.test.js for the specific case this guards.
      TZ: 'Europe/Warsaw',
    },
  },
});
