// Verifies the Stock Y-model schema foundation (issue #284).
//
// What we're proving:
//   • Migration 0012 adds five columns to `stock`: date, type_name,
//     colour, size_cm, cultivar.
//   • All five are nullable so existing inserts (which omit them)
//     keep working unchanged.
//   • A Variety-shaped insert round-trips: write all four attributes
//     + a date, read them back exactly as written.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); });
afterEach(async () => { await teardownPgHarness(harness); });

describe('stock Y-model foundation columns (migration 0012)', () => {
  it('all five new columns exist on the `stock` table', async () => {
    const r = await harness.pg.exec(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'stock'
        AND column_name IN ('date', 'type_name', 'colour', 'size_cm', 'cultivar')
      ORDER BY column_name
    `);
    const rows = r[0].rows;
    expect(rows.map(x => x.column_name).sort()).toEqual(
      ['colour', 'cultivar', 'date', 'size_cm', 'type_name']
    );
    // Every new column is nullable in this foundation slice. The NOT NULL
    // constraints land later in #290 (date) and #291 (type_name).
    for (const r of rows) expect(r.is_nullable).toBe('YES');
  });

  it('a legacy-shaped insert (no Y-model fields) still works', async () => {
    const [row] = await harness.db.insert(stock).values({
      displayName: 'Pink Peonies (10.May.)',
      currentQuantity: 25,
    }).returning();
    expect(row.id).toBeTruthy();
    expect(row.typeName).toBeNull();
    expect(row.colour).toBeNull();
    expect(row.sizeCm).toBeNull();
    expect(row.cultivar).toBeNull();
    expect(row.date).toBeNull();
  });

  it('a Variety-shaped insert round-trips through Drizzle', async () => {
    const [row] = await harness.db.insert(stock).values({
      displayName: 'Pink Peony 60cm Sarah Bernhardt',
      currentQuantity: -10,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: 'Sarah Bernhardt',
      date: '2026-05-12',
    }).returning();
    const [readback] = await harness.db.select().from(stock).where(eq(stock.id, row.id));
    expect(readback.typeName).toBe('Peony');
    expect(readback.colour).toBe('Pink');
    expect(readback.sizeCm).toBe(60);
    expect(readback.cultivar).toBe('Sarah Bernhardt');
    expect(readback.date).toBe('2026-05-12');
    expect(readback.currentQuantity).toBe(-10);
  });
});
