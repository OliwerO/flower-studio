// Integration tests for Stock Y-model dated Demand Entry (issue #286).
//
// What we're proving:
//   • getOrCreateDemandEntry creates a DE with negative qty when none exists.
//   • Same (Variety, date) reuses the existing DE, summing qty.
//   • Different dates → two distinct DE rows.
//   • Different cultivar (null vs filled) → two distinct DE rows (strict identity).
//   • Partial unique index rejects a raw INSERT that duplicates (Variety, date).
//   • Display name computed per ADR-0006.
//   • updateDemandEntryDate sole-owner: date updated in place, FK unchanged.
//   • updateDemandEntryDate shared: new DE created, order_line FK updated, old decremented.

import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, orderLines } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { PAYMENT_STATUS, ORDER_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { getOrCreateDemandEntry, updateDemandEntryDate } from '../repos/stockRepo.js';

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── Helpers ──

const ACTOR = { actorRole: 'system', actorPinLabel: null };

const PEONY_PINK = {
  typeName: 'Peony',
  colour:   'Pink',
  sizeCm:   60,
  cultivar: 'Sarah Bernhardt',
};

// Creates a minimal order + order_line with the given stockItemId.
// Needed for updateDemandEntryDate tests (which require the FK to exist).
async function seedOrderLine(db, stockItemId, qty = 5) {
  const [orderRow] = await db.insert(orders).values({
    customerId: 'cust-1',
    appOrderId: `TEST-${Math.random().toString(36).slice(2, 7)}`,
    status: ORDER_STATUS.NEW,
    deliveryType: 'Pickup',
    orderDate: '2026-05-10',
    paymentStatus: PAYMENT_STATUS.UNPAID,
  }).returning();

  const [lineRow] = await db.insert(orderLines).values({
    orderId: orderRow.id,
    stockItemId,
    flowerName: 'Test Flower',
    quantity: qty,
  }).returning();

  return { order: orderRow, line: lineRow };
}

// ─────────────────────────────────────────────────────────────────────
// getOrCreateDemandEntry
// ─────────────────────────────────────────────────────────────────────

describe('getOrCreateDemandEntry', () => {
  it('creates a new Demand Entry for a Variety+date when none exists', async () => {
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 10, tx, ACTOR);
    });

    expect(de['Current Quantity']).toBe(-10);
    expect(de._pgId).toBeTruthy();

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(1);
    expect(rows[0].currentQuantity).toBe(-10);
    expect(rows[0].typeName).toBe('Peony');
    expect(rows[0].colour).toBe('Pink');
    expect(rows[0].sizeCm).toBe(60);
    expect(rows[0].cultivar).toBe('Sarah Bernhardt');
    expect(rows[0].date).toBe('2026-05-15');
  });

  it('same Variety + same date → reuses row, sums qty (no new row)', async () => {
    const de1 = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 10, tx, ACTOR);
    });
    const de2 = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 5, tx, ACTOR);
    });

    // Same id — row reused
    expect(de2._pgId).toBe(de1._pgId);

    // Qty summed: -10 + (-5) = -15
    expect(de2['Current Quantity']).toBe(-15);

    // Still only one row in the table
    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(1);
    expect(rows[0].currentQuantity).toBe(-15);
  });

  it('same Variety + different date → two distinct DE rows', async () => {
    const de1 = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 10, tx, ACTOR);
    });
    const de2 = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-20', 8, tx, ACTOR);
    });

    expect(de1._pgId).not.toBe(de2._pgId);

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.date).sort()).toEqual(['2026-05-15', '2026-05-20']);
  });

  it('same Type/Colour/Size, different cultivar (null vs filled) → two distinct DE rows', async () => {
    const withCultivar = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 5, tx, ACTOR);
    });
    const nullCultivar = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(
        { typeName: 'Peony', colour: 'Pink', sizeCm: 60, cultivar: null },
        '2026-05-15',
        5,
        tx,
        ACTOR,
      );
    });

    // Two distinct rows — strict identity per ADR-0006
    expect(withCultivar._pgId).not.toBe(nullCultivar._pgId);

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(2);
  });

  it('partial unique index rejects a raw INSERT that duplicates (Variety, date)', async () => {
    // First insert via getOrCreateDemandEntry
    await harness.db.transaction(async (tx) => {
      await getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 10, tx, ACTOR);
    });

    // Attempt a direct raw INSERT with the same Variety+date but qty < 0
    // This bypasses our upsert logic and should be rejected by the unique index.
    await expect(
      harness.db.insert(stock).values({
        displayName: 'Peony Pink 60cm Sarah Bernhardt (2026-05-15) [duplicate]',
        currentQuantity: -5,
        typeName: 'Peony',
        colour: 'Pink',
        sizeCm: 60,
        cultivar: 'Sarah Bernhardt',
        date: '2026-05-15',
        active: true,
      }),
    ).rejects.toThrow(); // unique constraint violation
  });

  it('display name computed per ADR-0006: "<Type> <Colour> <Size>cm <Cultivar> (<Date>)"', async () => {
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 5, tx, ACTOR);
    });

    expect(de['Display Name']).toBe('Peony Pink 60cm Sarah Bernhardt (2026-05-15)');
  });

  it('display name omits null optional fields', async () => {
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(
        { typeName: 'Rose', colour: null, sizeCm: null, cultivar: null },
        '2026-05-15',
        5,
        tx,
        ACTOR,
      );
    });

    expect(de['Display Name']).toBe('Rose (2026-05-15)');
  });

  it('throws 400 when typeName is missing', async () => {
    await expect(
      harness.db.transaction(async (tx) => {
        return getOrCreateDemandEntry(
          { typeName: null, colour: 'Pink', sizeCm: 60, cultivar: null },
          '2026-05-15',
          5,
          tx,
          ACTOR,
        );
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when date is missing', async () => {
    await expect(
      harness.db.transaction(async (tx) => {
        return getOrCreateDemandEntry(PEONY_PINK, null, 5, tx, ACTOR);
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateDemandEntryDate
// ─────────────────────────────────────────────────────────────────────

describe('updateDemandEntryDate', () => {
  it('sole-owner: date column updated in place, order_line FK unchanged', async () => {
    // 1. Create a DE
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 8, tx, ACTOR);
    });

    // 2. Seed an order line pointing at it
    const { line } = await seedOrderLine(harness.db, de._pgId, 8);

    // 3. Cascade date change
    const result = await harness.db.transaction(async (tx) => {
      return updateDemandEntryDate(line.id, '2026-05-20', tx, ACTOR);
    });

    expect(result.action).toBe('updated-in-place');
    expect(result.demandEntryId).toBe(de._pgId);

    // Verify DE date changed
    const [deRow] = await harness.db.select().from(stock).where(eq(stock.id, de._pgId));
    expect(deRow.date).toBe('2026-05-20');

    // Verify order_line FK unchanged
    const [lineRow] = await harness.db.select().from(orderLines).where(eq(orderLines.id, line.id));
    expect(lineRow.stockItemId).toBe(de._pgId);
  });

  it('shared: new DE created, order_line FK updated, old DE qty decremented', async () => {
    // 1. Create a DE
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(PEONY_PINK, '2026-05-15', 8, tx, ACTOR);
    });

    // 2. Seed TWO order lines pointing at the same DE (shared)
    const { line: line1 } = await seedOrderLine(harness.db, de._pgId, 5);
    const { line: line2 } = await seedOrderLine(harness.db, de._pgId, 3);

    // The DE has qty -8 total. We'll cascade the date for line1 (qty=5).
    const result = await harness.db.transaction(async (tx) => {
      return updateDemandEntryDate(line1.id, '2026-05-22', tx, ACTOR);
    });

    expect(result.action).toBe('split');

    // line1 should point to a new DE
    const [updatedLine1] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, line1.id));
    expect(updatedLine1.stockItemId).not.toBe(de._pgId);
    expect(updatedLine1.stockItemId).toBe(result.demandEntryId);

    // line2 should still point to the original DE
    const [updatedLine2] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, line2.id));
    expect(updatedLine2.stockItemId).toBe(de._pgId);

    // Old DE qty should have been decremented by line1's qty (5): -8 + 5 = -3
    const [oldDeRow] = await harness.db.select().from(stock).where(eq(stock.id, de._pgId));
    expect(oldDeRow.currentQuantity).toBe(-3);

    // New DE should have qty -5
    const [newDeRow] = await harness.db.select().from(stock)
      .where(eq(stock.id, result.demandEntryId));
    expect(newDeRow.currentQuantity).toBe(-5);
    expect(newDeRow.date).toBe('2026-05-22');
  });

  it('returns null when order_line has no stockItemId', async () => {
    const [orderRow] = await harness.db.insert(orders).values({
      customerId: 'cust-1',
      appOrderId: 'TEST-NULL-STOCK',
      status: ORDER_STATUS.NEW,
      deliveryType: 'Pickup',
      orderDate: '2026-05-10',
      paymentStatus: PAYMENT_STATUS.UNPAID,
    }).returning();

    const [lineRow] = await harness.db.insert(orderLines).values({
      orderId: orderRow.id,
      stockItemId: null, // no stock link
      flowerName: 'Some Flower',
      quantity: 3,
    }).returning();

    const result = await harness.db.transaction(async (tx) => {
      return updateDemandEntryDate(lineRow.id, '2026-05-25', tx, ACTOR);
    });

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criteria — additional partial unique index + display name
// ─────────────────────────────────────────────────────────────────────

import { computeDemandDate } from '../repos/stockRepo.js';

describe('partial unique index — NULLS NOT DISTINCT acceptance', () => {
  it('two raw inserts same (Variety, null-colour, date) → second insert throws', async () => {
    // First insert with NULL colour
    await harness.db.insert(stock).values({
      displayName: 'Rose (2026-05-15)',
      currentQuantity: -5,
      typeName: 'Rose',
      colour: null,
      sizeCm: null,
      cultivar: null,
      date: '2026-05-15',
      active: true,
    });

    // Second insert with same Variety (null colour) and same date → must fail
    await expect(
      harness.db.insert(stock).values({
        displayName: 'Rose (2026-05-15) [dup]',
        currentQuantity: -3,
        typeName: 'Rose',
        colour: null,
        sizeCm: null,
        cultivar: null,
        date: '2026-05-15',
        active: true,
      }),
    ).rejects.toThrow(); // unique constraint violation
  });

  it('same Type/Size, different cultivar (null vs Sarah Bernhardt) → both succeed', async () => {
    // Insert with cultivar = null
    await harness.db.insert(stock).values({
      displayName: 'Peony Pink 60cm (2026-05-15)',
      currentQuantity: -5,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: null,
      date: '2026-05-15',
      active: true,
    });

    // Insert with cultivar = 'Sarah Bernhardt' — should NOT conflict (different Variety)
    await expect(
      harness.db.insert(stock).values({
        displayName: 'Peony Pink 60cm Sarah Bernhardt (2026-05-15)',
        currentQuantity: -8,
        typeName: 'Peony',
        colour: 'Pink',
        sizeCm: 60,
        cultivar: 'Sarah Bernhardt',
        date: '2026-05-15',
        active: true,
      }),
    ).resolves.toBeDefined();

    const rows = await harness.db.select().from(stock);
    expect(rows).toHaveLength(2);
  });
});

describe('computeDemandDate acceptance criteria', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('required by → order date → today (YYYY-MM-DD from fake timer)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T00:00:00.000Z'));
    expect(computeDemandDate({})).toBe('2026-05-10');
  });

  it('display name format: "Peony Pink 60cm Sarah Bernhardt (2026-05-15)"', async () => {
    const de = await harness.db.transaction(async (tx) => {
      return getOrCreateDemandEntry(
        { typeName: 'Peony', colour: 'Pink', sizeCm: 60, cultivar: 'Sarah Bernhardt' },
        '2026-05-15',
        5,
        tx,
        ACTOR,
      );
    });
    expect(de['Display Name']).toBe('Peony Pink 60cm Sarah Bernhardt (2026-05-15)');
  });
});
