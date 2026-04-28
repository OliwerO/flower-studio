// Shared test base: resets the harness state between specs so each test
// starts from the canonical fixture. Calls POST /api/test/reset which
// truncates audit_log + parity_log + stock + orders + order_lines +
// deliveries in pglite, then re-seeds Stock from the fixture.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  // Auto-fixture: runs before every test. Synchronous reset against the
  // running harness (port 3002).
  resetHarness: [async ({}, use) => {
    const res = await fetch('http://localhost:3002/api/test/reset', { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Failed to reset harness state: ${res.status} ${await res.text()}`);
    }
    await use(undefined);
  }, { auto: true }],
});

export { expect };
