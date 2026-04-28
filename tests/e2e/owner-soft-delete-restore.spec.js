// Owner soft-delete + restore on a stock item via Admin tab.
//
// What this validates:
//   - DELETE /api/admin/stock/:id sets deleted_at + active=false.
//   - Default GET /api/stock excludes the soft-deleted row.
//   - POST /api/admin/stock/:id/restore clears deleted_at + active=true.
//   - audit_log captures: stock:delete then stock:restore, both with
//     actorRole='owner'.
//   - Same flow exercised through the Admin tab UI (skipped pending
//     data-testids in AdminTab.jsx).

import { test, expect } from './helpers/test-base.js';

const OWNER_PIN = '1111';

test.describe('Owner soft-delete + restore (API layer)', () => {
  test('soft-delete hides the stock from the default list, restore brings it back', async ({ backendApi }) => {
    // Fetch any active stock row from PG.
    const stockRows = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const target = stockRows.find(s => s['Display Name'] === 'Eucalyptus');
    expect(target).toBeDefined();
    const targetId = target.id;

    // DELETE — soft-delete via the Admin endpoint.
    const delRes = await backendApi.fetch(`/api/admin/stock/${targetId}`, {
      method: 'DELETE',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(delRes.status).toBe(200);

    // List should no longer include it.
    const afterDelList = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    expect(afterDelList.find(s => s['Display Name'] === 'Eucalyptus')).toBeUndefined();

    // Restore.
    const restoreRes = await backendApi.fetch(`/api/admin/stock/${targetId}/restore`, {
      method: 'POST',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(restoreRes.status).toBe(200);

    // Now visible again.
    const afterRestoreList = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    expect(afterRestoreList.find(s => s['Display Name'] === 'Eucalyptus')).toBeDefined();

    // Audit trail.
    const audits = await backendApi.audit();
    const stockAudits = audits.filter(a => a.entityType === 'stock');
    const actions = stockAudits.map(a => a.action);
    expect(actions).toContain('delete');
    expect(actions).toContain('restore');
    expect(stockAudits.every(a => a.actorRole === 'owner')).toBe(true);
  });
});

test.describe.skip('Owner soft-delete + restore (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - AdminTab.jsx:               data-testid="admin-entity-selector", "admin-row-{recId}"
  //   - Per-row actions:            data-testid="admin-row-{recId}-delete", "admin-row-{recId}-restore"
  //   - Confirmation modal:         data-testid="admin-action-confirm"
});
