// Pending arrivals must not count cancelled work — ADR-0015.
//
// `GET /stock/pending-po` builds from an explicit status ALLOW-list, so
// PO_STATUS.CANCELLED is excluded by construction rather than by a rule someone
// wrote. That is exactly why it needs a test: the comment above that list
// already claimed "non-Cancelled POs" long before a Cancelled status existed,
// and nothing enforced it. A future "simplification" to `status !== Complete`
// would silently resurrect cancelled runs as incoming stock.
//
// The line-level half matters just as much: a live Shopping order can carry
// cancelled lines, and those stems are not coming either.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
  notifyPoCancelled:      vi.fn().mockResolvedValue(undefined),
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
  getActiveSeasonalCategory: () => null,
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';
import { stock } from '../db/schema.js';
import { PO_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockOrdersRouter from '../routes/stockOrders.js';
import stockRouter from '../routes/stock.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; next(); });
  app.use('/api/stock-orders', stockOrdersRouter);
  app.use('/api/stock', stockRouter);
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

async function makeStockItem(displayName) {
  const [row] = await harness.db.insert(stock).values({
    displayName, typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    currentQuantity: 0, active: true, category: 'Other',
  }).returning();
  return row;
}

// Draft → Sent → Shopping (the driver's first line PATCH flips it).
async function shoppingPoFor(stockItem, extraLines = []) {
  const created = await agent().post('/api/stock-orders').send({
    lines: [
      { stockItemId: stockItem.id, flowerName: stockItem.displayName, quantity: 30, costPrice: 4 },
      ...extraLines,
    ],
  });
  const poId = created.body.id;
  await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
  const detail = await agent().get(`/api/stock-orders/${poId}`);
  await agent().patch(`/api/stock-orders/${poId}/lines/${detail.body.lines[0].id}`)
    .send({ 'Driver Status': 'Pending' });
  const after = await agent().get(`/api/stock-orders/${poId}`);
  expect(after.body.Status).toBe(PO_STATUS.SHOPPING);
  return { poId, lines: after.body.lines };
}

describe('GET /stock/pending-po', () => {
  it('counts an in-flight order as incoming', async () => {
    const item = await makeStockItem('Peony Pink 60cm');
    await shoppingPoFor(item);

    const res = await agent().get('/api/stock/pending-po');
    expect(res.status).toBe(200);
    expect(res.body[item.id]?.ordered).toBe(30);
  });

  it('stops counting it once the order is cancelled', async () => {
    const item = await makeStockItem('Peony Pink 60cm');
    const { poId } = await shoppingPoFor(item);

    await agent().post(`/api/stock-orders/${poId}/cancel`);

    const res = await agent().get('/api/stock/pending-po');
    expect(res.body[item.id]).toBeUndefined();
  });

  it('drops a cancelled LINE while the rest of the order stays incoming', async () => {
    const peony = await makeStockItem('Peony Pink 60cm');
    const rose  = await makeStockItem('Rose Red 50cm');
    const { poId, lines } = await shoppingPoFor(peony, [
      { stockItemId: rose.id, flowerName: rose.displayName, quantity: 25, costPrice: 3 },
    ]);
    const roseLine = lines.find(l => l['Flower Name'] === 'Rose Red 50cm');

    await agent().post(`/api/stock-orders/${poId}/lines/${roseLine.id}/cancel`);

    const res = await agent().get('/api/stock/pending-po');
    expect(res.body[peony.id]?.ordered).toBe(30);  // untouched
    expect(res.body[rose.id]).toBeUndefined();     // cancelled — not coming
  });

  it('the status allow-list contains no terminal state', async () => {
    // Guards the shape of the rule, not just one instance of it: if someone
    // adds Cancelled or Complete to that list, incoming stock starts counting
    // work that will never arrive.
    const item = await makeStockItem('Peony Pink 60cm');
    const { poId } = await shoppingPoFor(item);
    await agent().post(`/api/stock-orders/${poId}/cancel`);

    const detail = await agent().get(`/api/stock-orders/${poId}`);
    expect(detail.body.Status).toBe(PO_STATUS.CANCELLED);

    const res = await agent().get('/api/stock/pending-po');
    expect(Object.keys(res.body)).toHaveLength(0);
  });
});
