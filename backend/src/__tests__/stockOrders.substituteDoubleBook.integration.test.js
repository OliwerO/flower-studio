// Regression: a fully-substituted PO line (Driver Status = "Not Found") must
// NOT book the original flower into stock — only the substitute.
//
// Prod incident 2026-07-06 (PO-20260705-1): the owner ordered flowers she did
// not get, recorded a substitute from an alternative supplier, and the florist
// evaluated. The evaluate route booked BOTH the original primary quantity AND
// the substitute quantity as received, creating phantom original batches
// (Dahlia Pink +10, Peony/Stefan +14, Lisianthus/Mateusz +10) that never
// physically arrived.
//
// Invariant proven here: Driver Status "Not Found" means none of the ORIGINAL
// arrived, so the primary receive is skipped regardless of what quantityAccepted
// the UI submits. Only the substitute lands in stock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  createOrder: vi.fn(),
  autoMatchStock: vi.fn(),
  findOrdersNeedingSubstitution: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({ targetMarkup: 2.5 }[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';
import { stock } from '../db/schema.js';
import { ilike } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockOrdersRouter from '../routes/stockOrders.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; next(); });
  app.use('/api/stock-orders', stockOrdersRouter);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

let harness, app;
const agent = () => supertest(app);

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function batchesLike(name) {
  return harness.db.select().from(stock).where(ilike(stock.displayName, `${name}%`));
}

describe('PO evaluate — fully-substituted line does not double-book the original', () => {
  it('Driver Status "Not Found" + substitute: books only the substitute, never the original', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'double-book-guard',
      lines: [{ flowerName: 'Dahlia Pink', quantity: 10, costPrice: 5, sellPrice: 12, supplier: 'Pan Zbigniew Dalie' }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);

    // Owner records: original NOT found (Not Found), substitute Dahlia Coral
    // found at an alternative supplier. Note Quantity Found is left at the
    // ordered qty — reproducing the exact prod data contradiction.
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({
      'Driver Status':      'Not Found',
      'Quantity Found':     10,
      'Alt Supplier':       'Pan Zbigniew',
      'Alt Flower Name':    'Dahlia Coral',
      'Alt Quantity Found': 10,
      'Alt Cost':           32,
    });
    await agent().post(`/api/stock-orders/${poId}/approve-review`);

    // The UI (bug) submits BOTH primary and substitute as fully accepted.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{
        lineId,
        quantityAccepted: 10, writeOffQty: 0,
        altQuantityAccepted: 10, altWriteOffQty: 0,
        altType: 'Dahlia', altColour: 'Coral',
      }],
    });
    expect(evaluated.status).toBe(200);

    const original = await batchesLike('Dahlia Pink');
    const substitute = await batchesLike('Dahlia Coral');

    // No phantom original batch may hold received stems.
    const phantomStems = original.reduce((s, r) => s + Number(r.currentQuantity || 0), 0);
    expect(phantomStems).toBe(0);

    // The substitute must be received in full.
    const subStems = substitute.reduce((s, r) => s + Number(r.currentQuantity || 0), 0);
    expect(subStems).toBe(10);
  });
});
