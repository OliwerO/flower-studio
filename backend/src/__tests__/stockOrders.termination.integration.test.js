// Stock Order termination — ADR-0015.
//
// The rule: before the driver starts shopping (Draft or Sent) a Stock Order and
// its lines are DELETED outright; from Shopping onward they are CANCELLED and
// the record is kept. The boundary is not arbitrary — a line PATCH from the
// driver auto-transitions Sent → Shopping, so it lands exactly on their first
// keystroke.
//
// The subtle half is what "cancel" means mid-shopping. Stems the driver already
// found are physically in the van and were paid for; cancelling them would
// erase the record of the purchase, not the purchase. So a cancel with anything
// found routes the order to Reviewing instead, and an individual found line
// refuses to cancel at all.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notifyPoCancelled = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
  notifyPoCancelled:      (...a) => notifyPoCancelled(...a),
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

function buildApp(role = 'owner') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = role; next(); });
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

async function createDraft(lines = [{ flowerName: 'Peony Pink', quantity: 20, costPrice: 4 }]) {
  const res = await agent().post('/api/stock-orders').send({ lines });
  expect(res.status).toBe(201);
  const detail = await agent().get(`/api/stock-orders/${res.body.id}`);
  return { poId: res.body.id, lines: detail.body.lines };
}

async function createSent(lines) {
  const po = await createDraft(lines);
  const sent = await agent().post(`/api/stock-orders/${po.poId}/send`).send({ driverName: 'Timur' });
  expect(sent.body.Status).toBe(PO_STATUS.SENT);
  return po;
}

// The driver touching any line's Driver Status flips the order to Shopping.
async function createShopping(lines) {
  const po = await createSent(lines);
  await agent().patch(`/api/stock-orders/${po.poId}/lines/${po.lines[0].id}`)
    .send({ 'Driver Status': 'Pending' });
  const detail = await agent().get(`/api/stock-orders/${po.poId}`);
  expect(detail.body.Status).toBe(PO_STATUS.SHOPPING);
  return { ...po, lines: detail.body.lines };
}

describe('deletion — allowed before shopping', () => {
  it('deletes a Draft order without notifying anyone', async () => {
    const { poId } = await createDraft();
    const res = await agent().delete(`/api/stock-orders/${poId}`);
    expect(res.status).toBe(200);
    expect(notifyPoCancelled).not.toHaveBeenCalled();
  });

  it('deletes a Sent order AND tells the driver the run is off', async () => {
    // They already got a Telegram when it was sent, so silence would leave
    // them shopping for an order that no longer exists.
    const { poId } = await createSent();
    const res = await agent().delete(`/api/stock-orders/${poId}`);
    expect(res.status).toBe(200);
    expect(notifyPoCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ driverName: 'Timur' }),
    );
  });

  it('refuses to delete a Shopping order, pointing at cancellation', async () => {
    const { poId } = await createShopping();
    const res = await agent().delete(`/api/stock-orders/${poId}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancel/i);
  });

  it('refuses to delete a LINE from a Shopping order', async () => {
    const { poId, lines } = await createShopping();
    const res = await agent().delete(`/api/stock-orders/${poId}/lines/${lines[0].id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancel/i);
  });

  it('still deletes a line from a Sent order', async () => {
    const { poId, lines } = await createSent();
    const res = await agent().delete(`/api/stock-orders/${poId}/lines/${lines[0].id}`);
    expect(res.status).toBe(200);
  });
});

describe('cancellation — from shopping onward', () => {
  it('cancels a Shopping order outright when nothing has been bought', async () => {
    const { poId } = await createShopping();
    const res = await agent().post(`/api/stock-orders/${poId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.Status).toBe(PO_STATUS.CANCELLED);
    expect(res.body.cancelledLines).toBe(1);
    expect(res.body.keptLines).toBe(0);
    expect(notifyPoCancelled).toHaveBeenCalled();
  });

  it('routes to Reviewing when the driver already has stems in the van', async () => {
    // "Stop shopping, come back with what you have" — the bought stems must
    // still be received, so the order continues rather than vanishing.
    const { poId, lines } = await createShopping([
      { flowerName: 'Peony Pink', quantity: 20, costPrice: 4 },
      { flowerName: 'Rose Red',   quantity: 25, costPrice: 3 },
    ]);
    await agent().patch(`/api/stock-orders/${poId}/lines/${lines[0].id}`)
      .send({ 'Driver Status': 'Found All', 'Quantity Found': 20 });

    const res = await agent().post(`/api/stock-orders/${poId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.Status).toBe(PO_STATUS.REVIEWING);
    expect(res.body.keptLines).toBe(1);       // the bought one
    expect(res.body.cancelledLines).toBe(1);  // the untouched one

    const detail = await agent().get(`/api/stock-orders/${poId}`);
    const byName = Object.fromEntries(detail.body.lines.map(l => [l['Flower Name'], l]));
    expect(byName['Peony Pink']['Cancelled At']).toBeFalsy();
    expect(byName['Rose Red']['Cancelled At']).toBeTruthy();
  });

  it('refuses to cancel a line the driver already bought', async () => {
    const { poId, lines } = await createShopping();
    await agent().patch(`/api/stock-orders/${poId}/lines/${lines[0].id}`)
      .send({ 'Driver Status': 'Found All', 'Quantity Found': 20 });

    const res = await agent().post(`/api/stock-orders/${poId}/lines/${lines[0].id}/cancel`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/write off/i);
  });

  it('cancels an untouched line and keeps it visible', async () => {
    const { poId, lines } = await createShopping();
    const res = await agent().post(`/api/stock-orders/${poId}/lines/${lines[0].id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body['Cancelled At']).toBeTruthy();

    // Kept, not removed — a line vanishing from the driver's screen mid-run is
    // worse than one shown struck through.
    const detail = await agent().get(`/api/stock-orders/${poId}`);
    expect(detail.body.lines).toHaveLength(1);
  });

  it('refuses to cancel an order that is not Shopping', async () => {
    const { poId } = await createSent();
    const res = await agent().post(`/api/stock-orders/${poId}/cancel`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delete it instead/i);
  });

  it('reopens a Cancelled order to Draft', async () => {
    // Nothing was ever received, so there is no stock effect to unwind.
    const { poId } = await createShopping();
    await agent().post(`/api/stock-orders/${poId}/cancel`);
    const res = await agent().patch(`/api/stock-orders/${poId}`).send({ Status: PO_STATUS.DRAFT });
    expect(res.status).toBe(200);
    expect(res.body.Status).toBe(PO_STATUS.DRAFT);
  });
});

describe('the Owner note and the Driver Market Note are separate fields', () => {
  it('a driver writing a Market Note leaves the owner instruction intact', async () => {
    const { poId, lines } = await createShopping();
    await agent().patch(`/api/stock-orders/${poId}/lines/${lines[0].id}`)
      .send({ Notes: 'возьми потемнее' });

    // The driver's app writes Driver Notes now, not Notes.
    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${lines[0].id}`)
      .send({ 'Driver Notes': 'было только 8' });

    expect(res.status).toBe(200);
    expect(res.body.Notes).toBe('возьми потемнее');
    expect(res.body['Driver Notes']).toBe('было только 8');
  });
});
