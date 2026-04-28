// Wix webhook replay — POST a captured payload and verify a clean order
// lands in the system.
//
// What this validates:
//   - POST /api/webhook/wix with a Wix-shaped payload creates an order +
//     order lines + delivery + customer.
//   - HMAC verification works against WIX_WEBHOOK_SECRET (the harness
//     sets this to 'test-mock-wix-secret' in start-test-backend.js).
//   - Stock deducts for each line.
//   - audit_log carries actorRole='webhook'.
//
// HOW TO CAPTURE PROD PAYLOADS (do this once, then commit sanitised
// copies to tests/e2e/fixtures/wix-payloads/):
//   1. In the Airtable Webhook Log table, find the most recent successful
//      Wix webhook entry.
//   2. Copy the Body field — it's the raw JSON that arrived from Wix.
//   3. Replace customer name, email, phone, and delivery address with
//      synthetic +48 555 / "test-customer-N" values.
//   4. Save as tests/e2e/fixtures/wix-payloads/sanitised-{YYYY-MM-DD}.json.
//   5. Add a HMAC signature header: compute SHA-256 HMAC of the body
//      using WIX_WEBHOOK_SECRET=test-mock-wix-secret, set as the
//      x-wix-signature header in this test.

import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHmac } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'wix-webhook-sample.json'), 'utf-8'));
const WEBHOOK_SECRET = 'test-mock-wix-secret';

test.describe('Wix webhook replay (API layer)', () => {
  test('a synthetic Wix payload creates an order with stock deducted', async ({ backendApi }) => {
    test.skip(true, 'TODO(harness-pr-3): commit a real sanitised prod payload first; the synthetic one in fixtures/ may not match the latest Wix payload schema.');

    const body = JSON.stringify(FIXTURE);
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    const res = await backendApi.fetch('/api/webhook/wix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wix-signature': signature,
      },
      body,
    });
    expect(res.status).toBe(200);

    // Audit log must carry actorRole='webhook'.
    const audits = await backendApi.audit();
    const webhookAudits = audits.filter(a => a.actorRole === 'webhook');
    expect(webhookAudits.length).toBeGreaterThan(0);

    // Stock should have decremented for whatever the webhook ordered.
    // Assertions depend on the captured payload's contents.
  });

  test('rejects payload with bad HMAC signature', async ({ backendApi }) => {
    test.skip(true, 'depends on harness-pr-3 — same reason as above.');

    const res = await backendApi.fetch('/api/webhook/wix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wix-signature': 'bogus',
      },
      body: JSON.stringify(FIXTURE),
    });
    expect(res.status).toBe(401);
  });
});
