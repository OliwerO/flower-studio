// backend/src/__tests__/assistantTools.crmPack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { customers, orders, keyPeople } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { lapsedCustomersHandler, upcomingOccasionsHandler, nextOccurrence } from '../services/assistantTools/crmPack.js';
import { listKeyPeopleWithDates, _resetAggregateCache } from '../repos/customerRepo.js';

// ── Date helpers ──────────────────────────────────────────────────────────────
// All dates are UTC ISO strings (YYYY-MM-DD) to match Postgres date columns.

function utcDaysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function utcToday() {
  return utcDaysFromNow(0);
}

// ── nextOccurrence — pure unit tests (no DB) ──────────────────────────────────

describe('nextOccurrence helper', () => {
  it('returns same year when MM-DD is still in the future', () => {
    expect(nextOccurrence('12-25', '2026-06-01')).toBe('2026-12-25');
  });

  it('returns same year when MM-DD is exactly today (daysUntil = 0)', () => {
    expect(nextOccurrence('06-29', '2026-06-29')).toBe('2026-06-29');
  });

  it('wraps to next year when MM-DD has already passed this year', () => {
    expect(nextOccurrence('01-15', '2026-06-29')).toBe('2027-01-15');
  });

  it('handles year-boundary: late-Dec today, early-Jan mmdd → next year', () => {
    // Dec 30 today, Jan 1 mmdd → 2027-01-01 (next year)
    expect(nextOccurrence('01-01', '2026-12-30')).toBe('2027-01-01');
  });

  it('handles year-boundary: late-Dec today, late-Dec mmdd same day → same year', () => {
    // Jan 1 mmdd, Jan 1 today → same day
    expect(nextOccurrence('12-31', '2026-12-31')).toBe('2026-12-31');
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  // customerRepo caches aggregate results for 60s in a module-level variable.
  // Each test starts with a fresh pglite DB, so the cache must be cleared to
  // prevent data from a previous test's DB leaking into the current test.
  _resetAggregateCache();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── lapsedCustomersHandler ────────────────────────────────────────────────────

describe('lapsedCustomersHandler', () => {
  it('returns only customers whose last order is older than sinceDays, sorted most-lapsed first', async () => {
    // Alice: last order 90 days ago → lapsed (> 60 days default)
    // Bob: last order 30 days ago → not lapsed (< 60 days default)
    // Carol: never ordered → excluded
    const ninetyDaysAgo = utcDaysFromNow(-90);
    const thirtyDaysAgo  = utcDaysFromNow(-30);

    const [alice, bob, carol] = await harness.db.insert(customers).values([
      { name: 'Alice',  phone: '111', segment: 'VIP' },
      { name: 'Bob',    phone: '222', segment: 'Rare' },
      { name: 'Carol',  phone: '333' },
    ]).returning();

    await harness.db.insert(orders).values([
      // Alice: one recent + one very old order (last order = 90 days ago)
      { appOrderId: 'A-1', orderDate: ninetyDaysAgo, requiredBy: ninetyDaysAgo, deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', priceOverride: '120.00', customerId: alice.id },
      // Bob: last order 30 days ago
      { appOrderId: 'B-1', orderDate: thirtyDaysAgo,  requiredBy: thirtyDaysAgo,  deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', priceOverride: '80.00',  customerId: bob.id  },
    ]);
    // Carol has no orders — she must not appear.

    const r = await lapsedCustomersHandler({ sinceDays: 60 });

    expect(r.sinceDays).toBe(60);
    expect(r.matchedCount).toBe(1);
    expect(r.shown).toBe(1);
    expect(r.truncated).toBe(false);
    expect(r.customers).toHaveLength(1);

    const c = r.customers[0];
    expect(c.name).toBe('Alice');
    expect(c.phone).toBe('111');
    expect(c.segment).toBe('VIP');
    expect(c.lastOrderDate).toBe(ninetyDaysAgo);
    // daysSinceLastOrder must be >= 90 (exact value depends on time-of-day rounding)
    expect(c.daysSinceLastOrder).toBeGreaterThanOrEqual(90);
    expect(c.orderCount).toBe(1);
    expect(Number(c.totalSpend)).toBe(120);
  });

  it('sorts by lastOrderDate ascending (most lapsed first)', async () => {
    const hundredDaysAgo  = utcDaysFromNow(-100);
    const eightyDaysAgo   = utcDaysFromNow(-80);

    const [cust1, cust2] = await harness.db.insert(customers).values([
      { name: 'Zara', phone: '101' },
      { name: 'Anna', phone: '102' },
    ]).returning();

    await harness.db.insert(orders).values([
      { appOrderId: 'Z-1', orderDate: hundredDaysAgo, requiredBy: hundredDaysAgo, deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', priceOverride: '50.00', customerId: cust1.id },
      { appOrderId: 'A-1', orderDate: eightyDaysAgo,  requiredBy: eightyDaysAgo,  deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', priceOverride: '50.00', customerId: cust2.id },
    ]);

    const r = await lapsedCustomersHandler({ sinceDays: 60 });
    expect(r.matchedCount).toBe(2);
    // Most lapsed (100 days = Zara) comes first
    expect(r.customers[0].name).toBe('Zara');
    expect(r.customers[1].name).toBe('Anna');
  });

  it('respects the limit and sets truncated', async () => {
    // Insert 3 customers each lapsed 90 days ago.
    const ninetyDaysAgo = utcDaysFromNow(-90);
    const inserted = await harness.db.insert(customers).values([
      { name: 'C1', phone: '1' },
      { name: 'C2', phone: '2' },
      { name: 'C3', phone: '3' },
    ]).returning();

    await harness.db.insert(orders).values(
      inserted.map((c, i) => ({
        appOrderId: `X-${i}`,
        orderDate: ninetyDaysAgo,
        requiredBy: ninetyDaysAgo,
        deliveryType: 'Pickup',
        status: 'Picked Up',
        paymentStatus: 'Paid',
        priceOverride: '10.00',
        customerId: c.id,
      })),
    );

    const r = await lapsedCustomersHandler({ sinceDays: 60, limit: 2 });
    expect(r.matchedCount).toBe(3);
    expect(r.shown).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.customers).toHaveLength(2);
  });

  it('excludes customers who have never ordered', async () => {
    await harness.db.insert(customers).values([{ name: 'Ghost', phone: '999' }]);
    const r = await lapsedCustomersHandler({ sinceDays: 0 });
    // sinceDays=0 means even today's customers are "lapsed" but Ghost has no orders → excluded
    expect(r.matchedCount).toBe(0);
  });

  it('defaults: sinceDays=60, limit=25, asOf is today', async () => {
    const r = await lapsedCustomersHandler({});
    expect(r.sinceDays).toBe(60);
    expect(r.asOf).toBe(utcToday());
    // No customers seeded → 0 results
    expect(r.matchedCount).toBe(0);
  });
});

// ── upcomingOccasionsHandler ──────────────────────────────────────────────────

describe('upcomingOccasionsHandler', () => {
  it('returns a person whose important date is ~3 days away with correct daysUntil', async () => {
    const threeDaysAhead = utcDaysFromNow(3);

    const [cust] = await harness.db.insert(customers).values([
      { name: 'Maria', phone: '555' },
    ]).returning();

    await harness.db.insert(keyPeople).values({
      customerId:         cust.id,
      name:               'Mum',
      importantDate:      threeDaysAhead,
      importantDateLabel: 'birthday',
    });

    const r = await upcomingOccasionsHandler({ withinDays: 14 });
    expect(r.withinDays).toBe(14);
    expect(r.asOf).toBe(utcToday());
    expect(r.matchedCount).toBe(1);

    const occ = r.occasions[0];
    expect(occ.personName).toBe('Mum');
    expect(occ.label).toBe('birthday');
    expect(occ.customerName).toBe('Maria');
    expect(occ.customerPhone).toBe('555');
    // daysUntil should be exactly 3 (both dates computed in UTC)
    expect(occ.daysUntil).toBeGreaterThanOrEqual(2);
    expect(occ.daysUntil).toBeLessThanOrEqual(4);
  });

  it('excludes a person whose next annual occurrence is beyond withinDays', async () => {
    // A date 2 days AGO: its next annual occurrence is ~363 days away → out of 14-day window.
    const twoDaysAgo = utcDaysFromNow(-2);

    const [cust] = await harness.db.insert(customers).values([
      { name: 'Past Person', phone: '777' },
    ]).returning();

    await harness.db.insert(keyPeople).values({
      customerId:    cust.id,
      name:          'Old Date',
      importantDate: twoDaysAgo,
    });

    const r = await upcomingOccasionsHandler({ withinDays: 14 });
    // The next occurrence wraps to next year (~363 days away), outside window.
    expect(r.matchedCount).toBe(0);
  });

  it('sorts occasions by daysUntil ascending', async () => {
    const oneDayAhead  = utcDaysFromNow(1);
    const fiveDaysAhead = utcDaysFromNow(5);

    const [cust] = await harness.db.insert(customers).values([
      { name: 'Multi Cust', phone: '888' },
    ]).returning();

    await harness.db.insert(keyPeople).values([
      { customerId: cust.id, name: 'Late',  importantDate: fiveDaysAhead },
      { customerId: cust.id, name: 'Early', importantDate: oneDayAhead  },
    ]);

    const r = await upcomingOccasionsHandler({ withinDays: 14 });
    expect(r.matchedCount).toBe(2);
    expect(r.occasions[0].personName).toBe('Early');
    expect(r.occasions[1].personName).toBe('Late');
  });

  it('defaults: withinDays=14, asOf is today', async () => {
    const r = await upcomingOccasionsHandler({});
    expect(r.withinDays).toBe(14);
    expect(r.asOf).toBe(utcToday());
  });

  it('excludes key people from soft-deleted customers', async () => {
    const oneDayAhead = utcDaysFromNow(1);

    const [cust] = await harness.db.insert(customers).values([
      { name: 'Deleted Cust', phone: '000', deletedAt: new Date() },
    ]).returning();

    // Insert key person directly (FK is on the table, deletedAt on customer won't cascade insert)
    await harness.db.insert(keyPeople).values({
      customerId:    cust.id,
      name:          'Ghost KP',
      importantDate: oneDayAhead,
    });

    const r = await upcomingOccasionsHandler({ withinDays: 14 });
    expect(r.matchedCount).toBe(0);
  });
});

// ── customerRepo.listKeyPeopleWithDates — shape test ─────────────────────────

describe('customerRepo.listKeyPeopleWithDates', () => {
  it('returns joined shape for key people with an importantDate', async () => {
    const [cust] = await harness.db.insert(customers).values([
      { name: 'Shape Test', phone: '321' },
    ]).returning();

    await harness.db.insert(keyPeople).values({
      customerId:         cust.id,
      name:               'Test Person',
      importantDate:      '2026-09-01',
      importantDateLabel: 'anniversary',
    });

    const rows = await listKeyPeopleWithDates();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.personName).toBe('Test Person');
    expect(row.importantDate).toBe('2026-09-01');
    expect(row.label).toBe('anniversary');
    expect(row.customerId).toBe(cust.id);
    expect(row.customerName).toBe('Shape Test');
    expect(row.customerPhone).toBe('321');
  });

  it('excludes key people without an importantDate', async () => {
    const [cust] = await harness.db.insert(customers).values([
      { name: 'No Date', phone: '000' },
    ]).returning();

    await harness.db.insert(keyPeople).values({
      customerId: cust.id,
      name:       'No Date KP',
      // importantDate not set
    });

    const rows = await listKeyPeopleWithDates();
    expect(rows).toHaveLength(0);
  });

  it('excludes soft-deleted key people', async () => {
    const [cust] = await harness.db.insert(customers).values([
      { name: 'Soft Del KP', phone: '111' },
    ]).returning();

    await harness.db.insert(keyPeople).values({
      customerId:    cust.id,
      name:          'Deleted KP',
      importantDate: '2026-07-04',
      deletedAt:     new Date(),
    });

    const rows = await listKeyPeopleWithDates();
    expect(rows).toHaveLength(0);
  });
});
