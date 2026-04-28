// pgHarness smoke test — proves the in-process Postgres + Drizzle stack
// boots and that the migrations apply cleanly. Without this passing, none
// of the integration tests on top of the harness would tell us anything
// useful (silent migration failure → empty schema → tests trivially pass).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './pgHarness.js';
import { stock, auditLog, parityLog, systemMeta } from '../../db/schema.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); });
afterEach(async () => { await teardownPgHarness(harness); });

describe('pglite harness', () => {
  it('boots and reports a Postgres version', async () => {
    const result = await harness.pg.query('SELECT version() AS v');
    expect(result.rows[0].v).toMatch(/PostgreSQL/);
  });

  it('applied all four tables from the migration set', async () => {
    const { rows } = await harness.pg.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const tables = rows.map(r => r.tablename);
    expect(tables).toEqual(expect.arrayContaining(['system_meta', 'audit_log', 'stock', 'parity_log']));
  });

  it('lets Drizzle round-trip an insert + select on system_meta', async () => {
    await harness.db.insert(systemMeta).values({ key: 'test_key', value: 'hello' });
    const rows = await harness.db.select().from(systemMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('test_key');
  });

  it('lets Drizzle round-trip an insert + select on stock with all column types', async () => {
    const [row] = await harness.db.insert(stock).values({
      airtableId: 'recTest',
      displayName: 'Pink Rose',
      category: 'Roses',
      currentQuantity: 25,
      currentCostPrice: '4.50',
      currentSellPrice: '15.00',
      active: true,
      substituteFor: ['recOther1', 'recOther2'],
    }).returning();

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);  // UUID
    expect(row.displayName).toBe('Pink Rose');
    expect(row.currentQuantity).toBe(25);
    expect(Number(row.currentCostPrice)).toBe(4.5);
    expect(row.substituteFor).toEqual(['recOther1', 'recOther2']);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('enforces the unique index on stock.airtable_id', async () => {
    await harness.db.insert(stock).values({ airtableId: 'recDup', displayName: 'X' });
    await expect(
      harness.db.insert(stock).values({ airtableId: 'recDup', displayName: 'Y' })
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('lets audit_log accept jsonb diffs of arbitrary depth', async () => {
    await harness.db.insert(auditLog).values({
      entityType: 'stock',
      entityId: 'recABC',
      action: 'update',
      diff: { before: { qty: 5, nested: { a: 1 } }, after: { qty: 7, nested: { a: 2 } } },
      actorRole: 'owner',
    });
    const rows = await harness.db.select().from(auditLog);
    expect(rows[0].diff.before.nested.a).toBe(1);
    expect(rows[0].diff.after.qty).toBe(7);
  });

  it('lets parity_log accept null airtableValue (missing_pg case)', async () => {
    await harness.db.insert(parityLog).values({
      entityType: 'stock',
      entityId: 'recX',
      kind: 'missing_pg',
      airtableValue: { 'Display Name': 'Lily' },
      postgresValue: null,
      context: { source: 'test' },
    });
    const rows = await harness.db.select().from(parityLog);
    expect(rows[0].kind).toBe('missing_pg');
    expect(rows[0].airtableValue['Display Name']).toBe('Lily');
    expect(rows[0].postgresValue).toBeNull();
  });
});
