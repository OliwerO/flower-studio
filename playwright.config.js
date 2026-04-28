// Playwright config — drives the local-PG-only E2E harness.
//
// What this file orchestrates:
//   1. backend (port 3002) via backend/scripts/start-test-backend.js
//      — sets TEST_BACKEND=mock-airtable + DATABASE_URL=pglite:memory,
//        boots Express, applies migrations, seeds 10 stock rows.
//   2. florist app (5173)  via `npm run florist`
//   3. delivery app (5174) via `npm run delivery`
//   4. dashboard app (5175) via `npm run dashboard`
//
// All three Vite apps are forced to proxy to port 3002 via the
// VITE_API_PROXY_TARGET env var (see each app's vite.config.js).
//
// Order: Playwright spawns webServers in parallel. The Vite apps don't
// strictly depend on the backend at boot — they only fail when the
// browser later tries to call /api/* — so parallel boot is safe and fast.
// Each server has its own healthcheck URL Playwright polls.
//
// Local iteration: `reuseExistingServer: !process.env.CI` lets you keep
// servers running between spec runs (faster). In CI, kill + restart for
// cleanliness.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,                  // serial — they share one in-memory backend
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                            // single worker — shared mutable backend state
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',    // florist app — most specs land here
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

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
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run delivery',
      url: 'http://localhost:5174/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dashboard',
      url: 'http://localhost:5175/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3002' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
