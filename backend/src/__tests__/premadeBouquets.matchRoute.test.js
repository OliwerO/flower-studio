// Route test for POST /premade-bouquets/:id/match — issues #189/#517.
//
// The new-order wizard's Step 3 now captures a Florist Note at creation and
// may resolve a keyPersonId for a manually-typed recipient. Both must survive
// the "matched to a premade bouquet" order-creation path too (Step2Bouquet's
// premade picker + the dashboard FAB's premade shortcut), not just the plain
// POST /orders path — the wizard sends the same body to whichever endpoint
// applies. Before this fix, routes/premadeBouquets.js's /:id/match handler
// silently dropped both fields from req.body.
//
// Exercises the REAL router + REAL matchPremadeBouquetToOrder/createOrder
// against pglite (not mocked) so this is a true end-to-end plumbing check,
// matching the style of stock.premadeCommitted.route.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, premadeBouquets, premadeBouquetLines, orders, customers, keyPeople } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));

let orderIdCounter = 0;
vi.mock('../services/configService.js', () => ({
  getConfig: (k) => ({ defaultDeliveryFee: 25 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `TEST-MATCH-${++orderIdCounter}`,
}));

import premadeBouquetsRouter from '../routes/premadeBouquets.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = req.headers['x-test-role'] || 'owner';
    next();
  });
  app.use('/premade-bouquets', premadeBouquetsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness;
let app;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  orderIdCounter = 0;
  app = buildApp();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedPremadeBouquet() {
  const [rose] = await harness.db.insert(stock).values({
    displayName: 'Pink Rose 60cm', currentQuantity: 20,
    currentCostPrice: '4', currentSellPrice: '15',
  }).returning();
  const [bouquet] = await harness.db.insert(premadeBouquets).values({ name: 'Spring Mix' }).returning();
  await harness.db.insert(premadeBouquetLines).values({
    bouquetId: bouquet.id,
    stockId: rose.id,
    flowerName: 'Pink Rose 60cm',
    quantity: 3,
    costPricePerUnit: '4',
    sellPricePerUnit: '15',
  });
  return bouquet;
}

describe('POST /premade-bouquets/:id/match — floristNote + keyPersonId pass-through (#189/#517)', () => {
  it('persists floristNote + keyPersonId on the order created from a matched premade bouquet', async () => {
    const bouquet = await seedPremadeBouquet();
    // orders.key_person_id carries a real FK (orders_key_person_id_fk, migration
    // 0006) → key_people(id) ON DELETE SET NULL, so this needs a real row.
    const [cust] = await harness.db.insert(customers).values({ name: 'Anna Test' }).returning();
    const [kp] = await harness.db.insert(keyPeople).values({ customerId: cust.id, name: 'Maria' }).returning();

    const res = await supertest(app)
      .post(`/premade-bouquets/${bouquet.id}/match`)
      .send({
        customer: 'recCust1',
        deliveryType: 'Pickup',
        requiredBy: '2026-08-01',
        paymentStatus: 'Unpaid',
        floristNote: 'Wrap in kraft paper, no card',
        keyPersonId: kp.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.order['Florist Note']).toBe('Wrap in kraft paper, no card');
    expect(res.body.order.keyPersonId).toBe(kp.id);

    // Re-fetch from the DB directly — proves it's actually persisted, not just echoed.
    const [row] = await harness.db.select().from(orders).where(eq(orders.id, res.body.order.id));
    expect(row.floristNote).toBe('Wrap in kraft paper, no card');
    expect(row.keyPersonId).toBe(kp.id);
  });

  it('defaults floristNote and keyPersonId to null when omitted', async () => {
    const bouquet = await seedPremadeBouquet();

    const res = await supertest(app)
      .post(`/premade-bouquets/${bouquet.id}/match`)
      .send({
        customer: 'recCust1',
        deliveryType: 'Pickup',
        requiredBy: '2026-08-01',
        paymentStatus: 'Unpaid',
      });

    expect(res.status).toBe(201);
    // '' round-trips to null via orderResponseToPg's `fields['Florist Note'] || null`
    // (pre-existing behavior, unchanged by this PR).
    expect(res.body.order['Florist Note']).toBeNull();
    expect(res.body.order.keyPersonId).toBeNull();
  });
});
