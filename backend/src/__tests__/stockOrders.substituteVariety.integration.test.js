// Integration tests for substitute Variety capture — C13 (ultracode audit).
//
// A PO substitute is a DIFFERENT free-text flower (Alt Flower Name) whose
// structured Variety is unknown to the system. Under STOCK_Y_MODEL the new
// substitute stock card was created WITHOUT Type/Colour/Size/Cultivar, so it
// was invisible in listGroupedByVariety (same failure class as #327/C3) — the
// substituted stems "disappeared" from the grouped Stock view.
//
// The fix lets the florist classify the substitute during evaluation; the
// captured Variety attrs flow onto the new substitute card. This test pins the
// findOrCreateSubstituteStock seam: given varietyAttrs, the created card carries
// them; without them (legacy), the card stays attr-less (no regression).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

let yModelEnabled = true;
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => yModelEnabled,
  getConfig: () => undefined, // targetMarkup → falls back to 1
  getActiveSeasonalCategory: () => null,
  generateOrderId: async () => 'TEST-001',
}));
vi.mock('../services/notifications.js', () => ({ broadcast: () => {} }));

import { __testing } from '../routes/stockOrders.js';

const { findOrCreateSubstituteStock } = __testing;
const TODAY = '2026-06-22';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  yModelEnabled = true;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedOrig(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName: overrides.displayName ?? 'Red Naomi Rose',
    currentQuantity: 0, active: true,
    typeName: overrides.typeName ?? 'Rose', colour: overrides.colour ?? 'Red',
    sizeCm: overrides.sizeCm ?? 50, cultivar: overrides.cultivar ?? 'Red Naomi',
  }).returning();
  return row;
}

describe('findOrCreateSubstituteStock — Variety capture (C13)', () => {
  it('writes the captured Variety attrs onto the new substitute card', async () => {
    const orig = await seedOrig();
    const attrs = { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: 'Sarah Bernhardt' };

    const subId = await findOrCreateSubstituteStock(
      'Pink Peony Sarah', 'Stefan', 6, orig, orig.id, TODAY, attrs,
    );

    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.typeName).toBe('Peony');   // a substitute can differ from the orig (Rose)
    expect(card.colour).toBe('Pink');
    expect(card.sizeCm).toBe(60);
    expect(card.cultivar).toBe('Sarah Bernhardt');
    expect(card.displayName).toBe('Pink Peony Sarah');
  });

  it('drops a zero / blank Size — never writes a bogus sizeCm', async () => {
    const orig = await seedOrig();
    // Size 0 = florist left the field blank (Number('') === 0). Type still set.
    const subId = await findOrCreateSubstituteStock(
      'Pink Peony', 'Stefan', 6, orig, orig.id, TODAY, { Type: 'Peony', Colour: 'Pink', Size: 0, Cultivar: null },
    );
    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.typeName).toBe('Peony');
    expect(card.sizeCm).toBe(null); // 0 dropped, not stored
  });

  it('defaults type_name to the base name when no attrs captured (Y-model NOT NULL safety net)', async () => {
    // Was previously allowed to be attr-less (type_name NULL). Under Y-model
    // prod enforces NOT NULL on type_name, so stockRepo.create defaults it to
    // the base Display Name rather than 500. Colour/Size/Cultivar stay null.
    const orig = await seedOrig();

    const subId = await findOrCreateSubstituteStock(
      'Mystery Substitute', 'Stefan', 5, orig, orig.id, TODAY, null,
    );

    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.typeName).toBe('Mystery Substitute');
    expect(card.colour).toBe(null);
  });
});
