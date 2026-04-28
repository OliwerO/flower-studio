// Backfill integration test — exercises the same upsert loop the
// scripts/backfill-stock.js runs. We can't import the CLI script
// directly (it calls process.exit), so we replicate its core logic
// here against pglite + a mocked Airtable response.
//
// What we're proving:
//   • Airtable rows land in PG with airtable_id preserved.
//   • Re-running the backfill is idempotent (no duplicates, no
//     deleted_at touched, soft-deleted rows stay deleted).
//   • Field changes in Airtable propagate to PG on the second run.
//   • Rows with missing Display Name are skipped, not crashed-on.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { responseToPg } from '../repos/stockRepo.js';
import { eq, isNull } from 'drizzle-orm';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); });
afterEach(async () => { await teardownPgHarness(harness); });

// Replicates the per-row loop from scripts/backfill-stock.js.
// Returns { inserted, updated, skipped, issues }.
async function backfill(airtableRows, db) {
  let inserted = 0, updated = 0, skipped = 0;
  const issues = [];
  for (const r of airtableRows) {
    if (!r['Display Name']) { skipped++; continue; }
    const pgFields = responseToPg(r);
    if (!('active' in pgFields)) pgFields.active = r.Active !== false;
    try {
      const [existing] = await db.select().from(stock).where(eq(stock.airtableId, r.id)).limit(1);
      if (existing) {
        await db.update(stock).set({ ...pgFields, updatedAt: new Date() }).where(eq(stock.id, existing.id));
        updated++;
      } else {
        await db.insert(stock).values({ airtableId: r.id, ...pgFields });
        inserted++;
      }
    } catch (err) {
      issues.push({ id: r.id, reason: err.message });
    }
  }
  return { inserted, updated, skipped, issues };
}

describe('backfill stock (pglite)', () => {
  const sampleRows = () => ([
    { id: 'rec1', 'Display Name': 'Red Rose', Category: 'Roses', 'Current Quantity': 50, 'Current Cost Price': 4.5, 'Current Sell Price': 15, Active: true },
    { id: 'rec2', 'Display Name': 'Pink Tulip', Category: 'Tulips', 'Current Quantity': 30, 'Current Cost Price': 3.0, 'Current Sell Price': 10, Active: true },
    { id: 'rec3', 'Display Name': 'Old Hibiscus', Category: 'Other', 'Current Quantity': -2, Active: false }, // negative qty (demand backlog), inactive
  ]);

  it('first run inserts all valid rows + preserves airtable_id', async () => {
    const result = await backfill(sampleRows(), harness.db);
    expect(result.inserted).toBe(3);
    expect(result.updated).toBe(0);

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.airtableId).sort()).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('second run is idempotent — same row count, no duplicates', async () => {
    await backfill(sampleRows(), harness.db);
    const result2 = await backfill(sampleRows(), harness.db);
    expect(result2.inserted).toBe(0);
    expect(result2.updated).toBe(3);

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(3);
  });

  it('Airtable-side change propagates on the second run', async () => {
    await backfill(sampleRows(), harness.db);
    const changed = sampleRows();
    changed[0]['Current Quantity'] = 100;  // was 50
    changed[0]['Current Sell Price'] = 18;
    await backfill(changed, harness.db);

    const [r1] = await harness.db.select().from(stock).where(eq(stock.airtableId, 'rec1'));
    expect(r1.currentQuantity).toBe(100);
    expect(Number(r1.currentSellPrice)).toBe(18);
  });

  it('rows missing Display Name are skipped, not crashed-on', async () => {
    const broken = [
      { id: 'recBroken', 'Display Name': '', 'Current Quantity': 5 },
      { id: 'recOk',     'Display Name': 'Valid', 'Current Quantity': 5 },
    ];
    const result = await backfill(broken, harness.db);
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(1);
  });

  it('soft-deleted PG rows are NOT re-activated by backfill', async () => {
    await backfill(sampleRows(), harness.db);

    // Owner intentionally soft-deletes rec2.
    await harness.db.update(stock)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(stock.airtableId, 'rec2'));

    // Backfill again with rec2 still in Airtable.
    await backfill(sampleRows(), harness.db);

    const [r2] = await harness.db.select().from(stock).where(eq(stock.airtableId, 'rec2'));
    expect(r2.deletedAt).toBeInstanceOf(Date);  // still deleted — backfill did NOT touch deleted_at
  });

  it('PG row count after backfill matches Airtable input count for the active subset', async () => {
    await backfill(sampleRows(), harness.db);
    const activePgRows = await harness.db.select().from(stock).where(isNull(stock.deletedAt));
    expect(activePgRows).toHaveLength(3); // includes rec3 even though Active=false (soft-delete is separate)
  });
});
