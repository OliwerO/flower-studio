// Integration tests for substitute identity resolution — #606 (slice 4).
//
// A substitute is a DIFFERENT flower from the one ordered, typed free-hand by
// whoever was standing at the market. `findOrCreateSubstituteStock` used to
// look for an existing card by **exact display name only**, and the captured
// classification was used solely to stamp the NEW card — never to find one.
// So a driver typing `Ranunkulus` and a florist typing `ranunculus` produced
// two cards, and a substitute that is plainly a flower she already stocks
// (`Peony / Pink / 60`) produced a third one under whatever name was typed.
//
// The create-a-flower door already resolves identity before creating (#603).
// This path is the one that bypassed it. These pin:
//   1. the 4-tuple wins over the typed name — the classification IS the identity;
//   2. the name fallback is case- and whitespace-insensitive;
//   3. a dated Batch is never resolved onto (it is one delivery, not the card);
//   4. a genuinely new substitute still gets created, carrying its attrs;
//   5. resolving onto an existing card still stacks the `Substitute For` link,
//      which is what lets the Stock screen tag the original as covered (#376).

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
vi.mock('../services/configService.js', () => ({
  getConfig: () => undefined,
  getActiveSeasonalCategory: () => null,
  generateOrderId: async () => 'TEST-001',
}));
vi.mock('../services/notifications.js', () => ({ broadcast: () => {} }));

import { __testing } from '../services/stockOrderService.js';
const { findOrCreateSubstituteStock } = __testing;

const TODAY = '2026-08-02';
let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedCard(values) {
  const [row] = await harness.db.insert(stock).values({
    currentQuantity: 0, active: true, ...values,
  }).returning();
  return row;
}

const countCards = async () =>
  (await harness.db.select().from(stock)).length;

describe('findOrCreateSubstituteStock — identity first (#606)', () => {
  it('resolves onto an existing Variety by its 4-tuple, whatever was typed as the name', async () => {
    const orig = await seedCard({
      displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red', sizeCm: 50,
    });
    const peony = await seedCard({
      displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const before = await countCards();

    // Somebody at the market typed "pink peonies from Stefan" — the words are
    // theirs, but the classification says it is the Peony she already stocks.
    const subId = await findOrCreateSubstituteStock(
      'pink peonies from Stefan', 'Stefan', 6, orig, orig.id, TODAY,
      { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null },
    );

    expect(subId).toBe(peony.id);
    expect(await countCards()).toBe(before);   // nothing minted
  });

  it('stacks the Substitute For link when it resolves onto an existing card', async () => {
    // That link is what makes the original read as "covered by a substitute"
    // rather than as an open shortfall (#376).
    const orig = await seedCard({ displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red' });
    const peony = await seedCard({ displayName: 'Peony Pink', typeName: 'Peony', colour: 'Pink' });

    await findOrCreateSubstituteStock(
      'peonies', 'Stefan', 6, orig, orig.id, TODAY, { Type: 'Peony', Colour: 'Pink' },
    );

    const card = await harness.db.select().from(stock).where(eq(stock.id, peony.id)).then(r => r[0]);
    expect(card.substituteFor).toContain(orig.id);
  });

  it('is null-aware — a classified Colour does not resolve onto a colourless card', async () => {
    // ADR-0006: a blank Colour is its own identity, never a wildcard.
    const orig = await seedCard({ displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red' });
    await seedCard({ displayName: 'Peony', typeName: 'Peony', colour: null });
    const before = await countCards();

    const subId = await findOrCreateSubstituteStock(
      'Peony Coral', 'Stefan', 6, orig, orig.id, TODAY, { Type: 'Peony', Colour: 'Coral' },
    );

    expect(await countCards()).toBe(before + 1);
    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.colour).toBe('Coral');
  });

  it('falls back to the name, case- and whitespace-insensitively', async () => {
    // The unclassified path — no Type captured. `Ranunkulus` vs `ranunculus`
    // is the shape that made three cards for one flower.
    const orig = await seedCard({ displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red' });
    const existing = await seedCard({ displayName: 'Ranunculus', typeName: 'Ranunculus' });
    const before = await countCards();

    const subId = await findOrCreateSubstituteStock(
      '  ranunculus ', 'Stefan', 6, orig, orig.id, TODAY, null,
    );

    expect(subId).toBe(existing.id);
    expect(await countCards()).toBe(before);
  });

  it('never resolves onto a dated Batch — that is one delivery, not the card', async () => {
    // Receiving a substitute into last week's delivery row is the #323 shape.
    const orig = await seedCard({ displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red' });
    const batch = await seedCard({
      displayName: 'Peony Pink (24.Jul.)', typeName: 'Peony', colour: 'Pink', date: '2026-07-24',
    });
    const before = await countCards();

    const subId = await findOrCreateSubstituteStock(
      'Peony Pink', 'Stefan', 6, orig, orig.id, TODAY, { Type: 'Peony', Colour: 'Pink' },
    );

    expect(subId).not.toBe(batch.id);
    expect(await countCards()).toBe(before + 1);
    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.displayName).toBe('Peony Pink');   // its own card, no date tag in the name
  });

  it('still creates a genuinely new substitute, carrying its classification', async () => {
    const orig = await seedCard({ displayName: 'Red Naomi Rose', typeName: 'Rose', colour: 'Red' });

    const subId = await findOrCreateSubstituteStock(
      'Ranunculus Peach', 'Stefan', 6, orig, orig.id, TODAY,
      { Type: 'Ranunculus', Colour: 'Peach', Size: 40, Cultivar: null },
    );

    const card = await harness.db.select().from(stock).where(eq(stock.id, subId)).then(r => r[0]);
    expect(card.typeName).toBe('Ranunculus');
    expect(card.colour).toBe('Peach');
    expect(card.sizeCm).toBe(40);
    expect(card.substituteFor).toContain(orig.id);
  });
});
