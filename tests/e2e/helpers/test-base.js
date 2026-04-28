// Shared test fixtures and helpers for the E2E specs.
//
// The `test` export wraps Playwright's base test with:
//   - Per-test backend reset (POST /api/test/reset) before each spec runs.
//     This re-seeds the mock Airtable fixture AND truncates+re-seeds the
//     PG tables. Each spec starts from the same known state without
//     having to remember to reset.
//   - A `backendApi` fixture — convenience methods for hitting test-only
//     endpoints (state inspection, audit log dump, parity check).
//   - A `pinLogin` helper bound to the page — does numpad-tap login
//     against the shared LoginPage component.
//
// Usage:
//   import { test, expect } from '../helpers/test-base.js';
//   test('something', async ({ page, pinLogin, backendApi }) => { ... });

import { test as base, expect } from '@playwright/test';

const BACKEND_URL = 'http://localhost:3002';

// Reset the backend to fixture state. Called automatically before each test.
async function resetBackend() {
  const res = await fetch(`${BACKEND_URL}/api/test/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`Reset failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Test-only endpoint helpers that bypass the PIN-auth middleware.
function makeBackendApi() {
  return {
    async state() {
      const res = await fetch(`${BACKEND_URL}/api/test/state`);
      return res.json();
    },
    async audit() {
      const res = await fetch(`${BACKEND_URL}/api/test/audit`);
      return res.json();
    },
    async parity() {
      const res = await fetch(`${BACKEND_URL}/api/test/parity`);
      return res.json();
    },
    async fetch(path, opts = {}) {
      return fetch(`${BACKEND_URL}${path}`, opts);
    },
  };
}

export const test = base.extend({
  // Auto-reset before every test. Critical for spec isolation under
  // workers=1 — we share one backend process, so previous-spec state
  // would leak otherwise.
  // eslint-disable-next-line no-empty-pattern
  resetBeforeEach: [async ({}, use) => {
    await resetBackend();
    await use();
  }, { auto: true }],

  backendApi: async ({}, use) => {
    await use(makeBackendApi());
  },

  // PIN-login helper. Floors the numpad-tap UX in 4 strokes, waits for
  // the redirect to /orders. Owner PIN by default; pass 'florist' or
  // a driver name to switch.
  pinLogin: async ({ page }, use) => {
    const loginAs = async (role = 'owner') => {
      const pins = { owner: '1111', florist: '2222', timur: '3333', nikita: '4444' };
      const pin = pins[role] || role;
      await page.goto('/login');
      for (const digit of pin) {
        await page.locator(`button:has-text("${digit}")`).first().click();
      }
      // Auto-submit happens at 4 digits; click submit if visible.
      const submitBtn = page.locator('button:has-text("Войти"), button:has-text("Login"), button[type="submit"]');
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
      }
      // Wait for the post-login route to settle.
      await page.waitForURL(/\/(orders|deliveries)/, { timeout: 10_000 });
    };
    await use(loginAs);
  },
});

export { expect };
