// lab/tests/api/variety-backfill.test.js
//
// Integration gate for the Variety backfill endpoints against the lab
// Postgres (seeded from stockBackfill scenario). Verifies:
//   - GET /stock/needs-backfill counts match scenario shape
//   - PATCH /stock/:id/variety-attrs sets and audits Type
//   - PATCH /stock/variety-attrs/bulk sets multiple rows in one tx
//   - Florist gets 403 on all four endpoints

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, startLabBackend, stopLabBackend } from '../../helpers/api.js';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

describe('variety-backfill endpoints', () => {
  beforeAll(async () => {
    await resetLabDb();
    await startLabBackend();
  }, 60_000);

  afterAll(stopLabBackend);

  beforeEach(async () => {
    await stopLabBackend();
    await resetLabDb();
    await startLabBackend();
  }, 60_000);

  it('GET /stock/needs-backfill returns only pending rows by default', async () => {
    const owner = api('owner');
    const res = await owner.get('/api/stock/needs-backfill');
    expect(res.status).toBe(200);
    // Scenario seeds 40 pending + 20 backfilled (baseline adds more).
    // remaining <= total and remaining > 0 (scenario guarantees pending items).
    expect(res.body.remaining).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.remaining);
    expect(res.body.rows.every(r => r['Type'] == null)).toBe(true);
  });

  it('GET /stock/needs-backfill?includeBackfilled=true returns all rows', async () => {
    const owner = api('owner');
    const res = await owner.get('/api/stock/needs-backfill?includeBackfilled=true');
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(res.body.total);
  });

  it('Florist gets 403 on GET /stock/needs-backfill', async () => {
    const florist = api('florist');
    const res = await florist.get('/api/stock/needs-backfill');
    expect(res.status).toBe(403);
  });

  it('PATCH /stock/:id/variety-attrs saves Type and writes audit log', async () => {
    const owner = api('owner');
    const pool  = labPool();

    // Pick a pending row
    const listRes = await owner.get('/api/stock/needs-backfill');
    expect(listRes.status).toBe(200);
    expect(listRes.body.rows.length).toBeGreaterThan(0);
    const row = listRes.body.rows[0];
    const id  = row.id || row._pgId;

    const patchRes = await owner.patch(`/api/stock/${id}/variety-attrs`, {
      typeName: 'Peony',
      colour:   'Pink',
      sizeCm:   60,
      cultivar: 'Sarah Bernhardt',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body['Type']).toBe('Peony');
    expect(patchRes.body['Colour']).toBe('Pink');
    expect(patchRes.body['Size']).toBe(60);

    // Verify audit log
    const { rows: auditRows } = await pool.query(
      `SELECT action, diff FROM audit_log WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    expect(auditRows[0].action).toBe('variety_backfill');
    expect(auditRows[0].diff.after['Type']).toBe('Peony');

    await pool.end();
  });

  it('PATCH /stock/variety-attrs/bulk applies to multiple rows and decrements remaining count', async () => {
    const owner = api('owner');

    const listRes = await owner.get('/api/stock/needs-backfill');
    expect(listRes.status).toBe(200);
    const pending = listRes.body.rows.slice(0, 3);
    expect(pending.length).toBe(3);
    const ids = pending.map(r => r.id || r._pgId);

    const bulkRes = await owner.patch('/api/stock/variety-attrs/bulk', {
      ids,
      attrs: { typeName: 'Tulip', colour: 'Yellow' },
    });
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.updated).toHaveLength(3);
    expect(bulkRes.body.updated.every(r => r['Type'] === 'Tulip')).toBe(true);

    // Banner count decremented
    const afterRes = await owner.get('/api/stock/needs-backfill');
    expect(afterRes.body.remaining).toBe(listRes.body.remaining - 3);
  });

  it('PATCH /stock/variety-attrs/bulk returns 400 for empty ids array', async () => {
    const owner = api('owner');
    const res = await owner.patch('/api/stock/variety-attrs/bulk', {
      ids: [],
      attrs: { typeName: 'Rose' },
    });
    expect(res.status).toBe(400);
  });

  it('Florist gets 403 on PATCH /stock/variety-attrs/bulk', async () => {
    const florist = api('florist');
    const res = await florist.patch('/api/stock/variety-attrs/bulk', {
      ids: ['any-id'],
      attrs: { typeName: 'Rose' },
    });
    expect(res.status).toBe(403);
  });
});
