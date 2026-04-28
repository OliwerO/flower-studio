import { defineConfig, devices } from '@playwright/test';

// Playwright config for the local-PG harness (Phase 3b).
// Boots the test backend (port 3002) + all three React Vite servers and
// drives them via headless Chromium. Designed to run with zero external
// dependencies — pglite handles Postgres in-process, the mock Airtable
// service handles legacy reads.
//
// First-time setup:
//   npm install
//   npx playwright install chromium
//
// Run:
//   npx playwright test                          # all specs
//   npx playwright test florist-order-creation   # one spec
//   npx playwright test --ui                     # interactive runner

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',

  // Single worker locally — multiple workers share one harness backend.
  // pglite is in-process per backend; concurrent specs would race.
  workers: 1,
  fullyParallel: false,

  // Re-run flaky specs once on CI; fail fast locally.
  retries: process.env.CI ? 1 : 0,

  // Reasonable timeouts; pglite cold-start is the slowest thing here.
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: [
    ['list'],
    process.env.CI ? ['github'] : ['html', { open: 'never' }],
  ].filter(Boolean),

  use: {
    baseURL: 'http://localhost:5173',                 // florist by default; specs override per app
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Boot every server Playwright needs. Order matters in spirit (backend first
  // so the proxies have a target), but Playwright doesn't enforce ordering;
  // each Vite server's healthcheck waits on / which serves index.html
  // immediately, so they don't actually wait on /api/health.
  webServer: [
    {
      command: 'node backend/scripts/start-test-backend.js',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run florist',
      url: 'http://localhost:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
    },
    {
      command: 'npm run delivery',
      url: 'http://localhost:5174/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
    },
    {
      command: 'npm run dashboard',
      url: 'http://localhost:5175/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
    },
  ],
});
