// backend/src/__tests__/assistantTools.goldenQuestions.test.js
//
// Golden-questions eval: for each question we force the LLM to call a specific
// tool (mocked Anthropic SDK) and then assert a self-consistency invariant on
// the REAL handler output (running against pglite with seeded data).
//
// We import the REAL ask() + REAL TOOL_HANDLERS — index.js is NOT mocked.
// The Anthropic SDK is mocked via vi.hoisted to avoid real network calls.
// The db is redirected to pglite via the dbHolder getter pattern.
// conversationRepo writes to pglite (assistant_conversations exists via migration 0016) — fine.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import {
  orders,
  orderLines,
  stock,
  stockLossLog,
  marketingSpend,
  customers,
  keyPeople,
  stockPurchases,
} from '../db/schema.js';

// ── Mock @anthropic-ai/sdk (must be before any imports that pull it in) ────────
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: mockCreate }; },
}));

// ── Redirect db import to the per-test pglite instance ────────────────────────
const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// ── Import the REAL ask + REAL registry ───────────────────────────────────────
import { ask } from '../services/assistantService.js';
import { _resetAggregateCache } from '../repos/customerRepo.js';

// ── Dates relative to today so invariants hold regardless of when tests run ───
const today = new Date().toISOString().slice(0, 10);
// A date that's ~16 days in the future from test execution — stays within 365d
const futureBirthday = (() => {
  const d = new Date(Date.now() + 16 * 86400000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
})();
const futureBirthdayMmdd = futureBirthday.slice(5); // MM-DD for assertion

let harness;
let customerId; // UUID string of the seeded customer

beforeEach(async () => {
  vi.clearAllMocks();
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  // Reset the customerRepo aggregate cache so stale data from a previous
  // test's pglite instance doesn't leak into this one.
  _resetAggregateCache();

  // ── Seed a customer ──
  const [cust] = await harness.db.insert(customers).values({
    name: 'Alice Test',
    phone: '+48 111 222 333',
    segment: 'VIP',
  }).returning();
  customerId = cust.id;

  // ── Seed orders in May 2026 (non-cancelled, with prices) ──
  const [ord1] = await harness.db.insert(orders).values({
    appOrderId: 'GQ-1',
    customerId,
    orderDate: '2026-05-05',
    requiredBy: '2026-05-06',
    deliveryType: 'Delivery',
    status: 'Delivered',
    paymentStatus: 'Paid',
    priceOverride: '150.00',
    deliveryFee: '20.00',
    source: 'Instagram',
  }).returning();

  const [ord2] = await harness.db.insert(orders).values({
    appOrderId: 'GQ-2',
    customerId,
    orderDate: '2026-05-10',
    requiredBy: '2026-05-10',
    deliveryType: 'Pickup',
    status: 'Picked Up',
    paymentStatus: 'Paid',
    priceOverride: '90.00',
    source: 'Wix',
  }).returning();

  // ── Seed order lines for top_products ──
  await harness.db.insert(orderLines).values([
    { orderId: ord1.id, flowerName: 'Rose',  quantity: 8, costPricePerUnit: '8.00',  sellPricePerUnit: '20.00' },
    { orderId: ord1.id, flowerName: 'Tulip', quantity: 3, costPricePerUnit: '4.00',  sellPricePerUnit: '10.00' },
    { orderId: ord2.id, flowerName: 'Rose',  quantity: 4, costPricePerUnit: '8.00',  sellPricePerUnit: '20.00' },
  ]);

  // ── Seed stock (one negative for shortfallOnly test) ──
  await harness.db.insert(stock).values([
    { displayName: 'Red Rose',    currentQuantity: 50,  active: true },
    { displayName: 'White Peony', currentQuantity: 20,  active: true },
    { displayName: 'Carnation',   currentQuantity: -5,  active: true }, // shortfall
  ]);

  // ── Seed stock loss log ──
  await harness.db.insert(stockLossLog).values([
    { date: '2026-05-08', reason: 'Damage',  quantity: '4', notes: '' },
    { date: '2026-05-12', reason: 'Damage',  quantity: '3', notes: '' },
    { date: '2026-05-20', reason: 'Expired', quantity: '2', notes: '' },
  ]);

  // ── Seed marketing spend ──
  await harness.db.insert(marketingSpend).values([
    { month: '2026-05-01', channel: 'Instagram', amount: '500', notes: '' },
    { month: '2026-05-01', channel: 'Facebook',  amount: '200', notes: '' },
  ]);

  // ── Seed stock purchases (for supplier_scorecard) ──
  await harness.db.insert(stockPurchases).values([
    { purchaseDate: '2026-05-03', supplier: 'FlowerCo', quantityPurchased: 50, pricePerUnit: '3.00', notes: '' },
  ]);

  // ── Seed key people with a future important date (for upcoming_occasions) ──
  await harness.db.insert(keyPeople).values({
    customerId,
    name: 'Mom',
    importantDate: futureBirthday,
    importantDateLabel: 'Birthday',
  });
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
  _resetAggregateCache();
});

// ── Helper: set up mock so the LLM forces a specific tool call ────────────────
function mockToolCall(name, input, answer = 'ok') {
  mockCreate
    .mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name, input }],
    })
    .mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: answer }],
    });
}

// ── Golden questions ──────────────────────────────────────────────────────────

describe('golden questions — tool invariants', () => {
  it('query_orders: matchedCount is a number; truncated===false on small data', async () => {
    mockToolCall('query_orders', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: 'How many orders in May?' });
    expect(r.toolResults[0].name).toBe('query_orders');
    const out = r.toolResults[0].output;
    expect(typeof out.matchedCount).toBe('number');
    expect(out.truncated).toBe(false);
  });

  it('financial_summary: revenue.total ≈ revenue.flowers + revenue.delivery', async () => {
    mockToolCall('financial_summary', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: 'What was the revenue in May?' });
    expect(r.toolResults[0].name).toBe('financial_summary');
    const { revenue } = r.toolResults[0].output;
    expect(revenue.total).toBeCloseTo(revenue.flowers + revenue.delivery, 2);
  });

  it('breakdown_orders: sum(breakdown values) === total', async () => {
    mockToolCall('breakdown_orders', { dimension: 'deliveryType', from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: 'Break May orders by delivery type.' });
    expect(r.toolResults[0].name).toBe('breakdown_orders');
    const { total, breakdown } = r.toolResults[0].output;
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(total);
  });

  it('stock_status shortfallOnly: every returned item has quantity < 0', async () => {
    mockToolCall('stock_status', { shortfallOnly: true });
    const r = await ask({ message: "What's in shortfall?" });
    expect(r.toolResults[0].name).toBe('stock_status');
    const { items } = r.toolResults[0].output;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.quantity).toBeLessThan(0);
    }
  });

  it('stock_writeoffs: sum(byReason values) === totalQuantity', async () => {
    mockToolCall('stock_writeoffs', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: 'How much was written off in May?' });
    expect(r.toolResults[0].name).toBe('stock_writeoffs');
    const { totalQuantity, byReason } = r.toolResults[0].output;
    const sum = Object.values(byReason).reduce((a, b) => a + b, 0);
    expect(sum).toBe(totalQuantity);
  });

  it('top_products: products is an array; total >= products.length', async () => {
    mockToolCall('top_products', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: "What were the best sellers in May?" });
    expect(r.toolResults[0].name).toBe('top_products');
    const { products, total } = r.toolResults[0].output;
    expect(Array.isArray(products)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(products.length);
  });

  it('sales_trends: weeklyRhythm has exactly 7 entries', async () => {
    mockToolCall('sales_trends', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: "What's the busiest day of the week?" });
    expect(r.toolResults[0].name).toBe('sales_trends');
    const { weeklyRhythm } = r.toolResults[0].output;
    expect(weeklyRhythm).toHaveLength(7);
  });

  it('supplier_scorecard: every supplier has a numeric wastePercent', async () => {
    mockToolCall('supplier_scorecard', { from: '2026-05-01', to: '2026-05-31' });
    const r = await ask({ message: 'Which supplier has the most waste?' });
    expect(r.toolResults[0].name).toBe('supplier_scorecard');
    const { suppliers } = r.toolResults[0].output;
    for (const s of suppliers) {
      expect(typeof s.wastePercent).toBe('number');
    }
  });

  it('marketing_spend: sum(byChannel amounts) === totalSpend', async () => {
    mockToolCall('marketing_spend', { from: '2026-05', to: '2026-05' });
    const r = await ask({ message: 'How much did I spend on ads in May?' });
    expect(r.toolResults[0].name).toBe('marketing_spend');
    const { totalSpend, byChannel } = r.toolResults[0].output;
    const sum = byChannel.reduce((a, c) => a + c.amount, 0);
    expect(sum).toBeCloseTo(totalSpend, 2);
  });

  it('stock_velocity fastest: items sorted by qtySold descending', async () => {
    mockToolCall('stock_velocity', { sort: 'fastest' });
    const r = await ask({ message: "What flowers are selling fastest?" });
    expect(r.toolResults[0].name).toBe('stock_velocity');
    const { items } = r.toolResults[0].output;
    // Items must be sorted by qtySold descending (stable sort)
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].qtySold).toBeGreaterThanOrEqual(items[i + 1].qtySold);
    }
  });

  it('lapsed_customers: every customer daysSinceLastOrder >= sinceDays', async () => {
    // Alice's last order was 2026-05-10 — well more than 30 days before today (2026-06-29)
    mockToolCall('lapsed_customers', { sinceDays: 30 });
    const r = await ask({ message: "Who hasn't ordered in 30 days?" });
    expect(r.toolResults[0].name).toBe('lapsed_customers');
    const { customers: lapsed, sinceDays } = r.toolResults[0].output;
    for (const c of lapsed) {
      expect(c.daysSinceLastOrder).toBeGreaterThanOrEqual(sinceDays);
    }
  });

  it('upcoming_occasions: every occasion daysUntil <= withinDays', async () => {
    mockToolCall('upcoming_occasions', { withinDays: 365 });
    const r = await ask({ message: "Whose birthday is coming up?" });
    expect(r.toolResults[0].name).toBe('upcoming_occasions');
    const { occasions, withinDays } = r.toolResults[0].output;
    expect(occasions.length).toBeGreaterThan(0); // Mom's birthday is in the future
    for (const o of occasions) {
      expect(o.daysUntil).toBeLessThanOrEqual(withinDays);
      expect(o.daysUntil).toBeGreaterThanOrEqual(0);
    }
  });
});
