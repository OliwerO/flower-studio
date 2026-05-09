// playwright.lab.config.js
//
// Lab-only Playwright config. Boots lab backend (3003) + dashboard (5177).
// Lab Vite dev servers run on different ports than the existing harness
// (5173–5175) to avoid collisions when both are running.
//
// The dashboard auto-authenticates via VITE_OWNER_PIN — no login screen.
// Specs navigate directly to the tab under test.
//
// First-time setup:
//   npx playwright install chromium
//
// Run:
//   npm run lab:test:ui              # all UI specs
//   npm run lab:test:ui -- --ui      # interactive runner

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './lab/tests/ui',
  testMatch: '**/*.spec.js',

  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: [
    ['list'],
    process.env.CI ? ['github'] : ['html', { open: 'never' }],
  ].filter(Boolean),

  use: {
    baseURL: 'http://localhost:5177',  // dashboard
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      command: 'node lab/scripts/start-lab-backend.js',
      url: 'http://localhost:3003/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'cd apps/dashboard && node_modules/.bin/vite --port 5177',
      url: 'http://localhost:5177/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_API_PROXY_TARGET: 'http://localhost:3003',
        VITE_OWNER_PIN: '1111',
      },
    },
  ],
});
