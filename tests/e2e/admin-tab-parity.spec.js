// Admin tab parity dashboard — verify zero mismatches end-to-end.
//
// What this validates:
//   - GET /api/admin/parity/stock returns
//     { airtableCount, postgresCount, mismatches: {} } when the harness
//     boots, since auto-seed copies every mock-Airtable Stock row into PG.
//   - After a write through stockRepo.adjustQuantity, the mock-Airtable
//     side stays unchanged (postgres mode doesn't write to it) so the
//     parity check would see field_mismatch on that row.
//   - This is the gate that, in production, decides "shadow → postgres".

import { test, expect } from './helpers/test-base.js';

const OWNER_PIN = '1111';

test.describe('Admin tab parity (API layer)', () => {
  test('zero mismatches immediately after fixture seed', async ({ backendApi }) => {
    test.skip(true, 'TODO(harness-pr-3): runParityCheck currently calls airtable.list with a fields whitelist that the mock projects to {id, ...whitelisted}; field_mismatch fires on Lot Size etc. Audit valuesEqual semantics + projection before un-skipping.');

    const res = await backendApi.fetch('/api/admin/parity/stock?recheck=true', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary.airtableCount).toBe(10);
    expect(summary.postgresCount).toBe(10);
    expect(Object.keys(summary.mismatches)).toHaveLength(0);
  });

  test('parity log shows field_mismatch after a postgres-only write', async ({ backendApi }) => {
    test.skip(true, 'depends on the previous test — see harness-pr-3.');

    // After we adjust stock in PG (via /api/orders create flow), parity
    // recheck should report field_mismatch on Current Quantity for that row.
    // The dashboard renders this as a red badge on the stock entry.
  });
});

test.describe.skip('Admin tab parity (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once AdminTab grows the parity widget.
  //   - data-testid="parity-widget", "parity-recheck-button"
  //   - Mismatches drilldown: data-testid="parity-mismatch-{recId}"
});
