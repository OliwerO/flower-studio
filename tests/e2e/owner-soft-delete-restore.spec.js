// Owner soft-delete + restore — round-trip via Admin tab.
//
// In this codebase the user-facing "delete" button on Stock is a
// PATCH /api/stock/:id { Active: false } — that hides the row from the
// default list and decouples it from order pickers. The Admin tab's
// "Restore" button hits POST /api/admin/stock/:id/restore which flips
// Active back to true (and would clear deleted_at if a future soft-delete
// route ever sets it). The Admin tab's "Purge" button hits
// DELETE /api/admin/stock/:id/purge which hard-removes the row.
//
// What this spec validates:
//   - PATCH stock with Active=false hides the row from /api/stock,
//     keeps it visible on includeInactive=true.
//   - POST .../restore flips Active back to true and writes a
//     `restore` audit row.
//   - DELETE .../purge removes the row entirely; subsequent GET
//     /api/admin/stock/:id returns 404.
//   - Florist (PIN_FLORIST) cannot reach /api/admin — 403.
//   - Restoring an already-active row is a safe no-op (still 200).
//   - Restoring a non-existent id returns 404.
//   - Purging a non-existent id returns 404.

import { test, expect } from './helpers/test-base.js';

const OWNER_PIN = '1111';
const FLORIST_PIN = '2222';

test.describe('Owner deactivate + restore (Admin tab round-trip)', () => {
  test('PATCH Active=false hides row, restore brings it back, audit captures both', async ({ backendApi }) => {
    // 1. Pick Eucalyptus (active stock row in the seed fixture).
    const stockRows = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const eucalyptus = stockRows.find(s => s['Display Name'] === 'Eucalyptus');
    expect(eucalyptus).toBeDefined();
    expect(eucalyptus.Active).toBe(true);

    // 2. Deactivate.
    const deactRes = await backendApi.fetch(`/api/stock/${eucalyptus.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': OWNER_PIN },
      body: JSON.stringify({ Active: false }),
    });
    expect(deactRes.status).toBe(200);

    // 3. Default list excludes it.
    const defaultList = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    expect(defaultList.find(s => s['Display Name'] === 'Eucalyptus')).toBeUndefined();

    // 4. includeInactive=true reveals it (Active=false).
    const allList = await (await backendApi.fetch('/api/stock?includeInactive=true', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const eucalyptusHidden = allList.find(s => s['Display Name'] === 'Eucalyptus');
    expect(eucalyptusHidden).toBeDefined();
    expect(eucalyptusHidden.Active).toBe(false);

    // 5. Restore via Admin endpoint (URL pattern /:entity/:id/restore).
    const restoreRes = await backendApi.fetch(`/api/admin/stock/${eucalyptus.id}/restore`, {
      method: 'POST',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(restoreRes.status).toBe(200);

    // 6. Default list now includes it again, Active=true.
    const restoredList = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const back = restoredList.find(s => s['Display Name'] === 'Eucalyptus');
    expect(back).toBeDefined();
    expect(back.Active).toBe(true);

    // 7. Audit log: deactivate captured as stock:update, restore as stock:restore.
    const audits = await backendApi.audit();
    const stockAudits = audits.filter(a => a.entityType === 'stock');
    const actions = stockAudits.map(a => a.action);
    expect(actions).toContain('update');   // deactivate
    expect(actions).toContain('restore');  // bring-back
    expect(stockAudits.every(a => a.actorRole === 'owner')).toBe(true);
  });

  test('purge removes the row entirely', async ({ backendApi }) => {
    // Pick Discontinued Carnation (Active=false in fixture, qty=0 — safe to purge).
    const allList = await (await backendApi.fetch('/api/stock?includeInactive=true&includeEmpty=true', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const target = allList.find(s => s['Display Name'] === 'Discontinued Carnation');
    expect(target).toBeDefined();

    const purgeRes = await backendApi.fetch(`/api/admin/stock/${target.id}/purge`, {
      method: 'DELETE',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(purgeRes.status).toBe(200);

    // Subsequent fetch returns 404.
    const lookup = await backendApi.fetch(`/api/admin/stock/${target.id}`, {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(lookup.status).toBe(404);

    // Audit captured the purge.
    const audits = await backendApi.audit();
    const purgeAudit = audits.find(a => a.entityType === 'stock' && a.action === 'purge');
    expect(purgeAudit).toBeDefined();
    expect(purgeAudit.actorRole).toBe('owner');
  });
});

test.describe('Owner deactivate + restore — edge cases', () => {
  test('florist cannot access /api/admin — 403', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/admin/stock/recMockStock1/restore', {
      method: 'POST',
      headers: { 'X-Auth-PIN': FLORIST_PIN },
    });
    expect(res.status).toBe(403);
  });

  test('restoring an already-active row is a safe no-op', async ({ backendApi }) => {
    // recMockStock1 (Red Rose) is Active=true in the fixture — restore should
    // succeed without changing anything functionally.
    const res = await backendApi.fetch('/api/admin/stock/recMockStock1/restore', {
      method: 'POST',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.Active).toBe(true);
  });

  test('restoring a non-existent record returns 404', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/admin/stock/recDoesNotExist/restore', {
      method: 'POST',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(res.status).toBe(404);
  });

  test('purging a non-existent record returns 404', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/admin/stock/recDoesNotExist/purge', {
      method: 'DELETE',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(res.status).toBe(404);
  });

  test('unknown admin entity returns 404', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/admin/totallyMadeUp/recX/restore', {
      method: 'POST',
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    expect(res.status).toBe(404);
  });
});

test.describe.skip('Owner deactivate + restore (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - StockTab.jsx:               data-testid="stock-row-{id}", "stock-row-{id}-deactivate"
  //   - AdminTab.jsx:               data-testid="admin-entity-selector", "admin-row-{id}"
  //   - Per-row admin actions:      data-testid="admin-row-{id}-restore", "admin-row-{id}-purge"
  //   - Confirmation modal:         data-testid="admin-action-confirm"
});
