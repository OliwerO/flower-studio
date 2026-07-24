// Regression tests for issue #550 — "cannot select flower details when adding
// to a sent Stock Order". The owner reported that adding a line to a PO that
// had already been sent to a driver only let her fill quantity + lot size —
// no flower type, size, variety, or Stock Item link.
//
// Root cause: this was a FRONTEND-only gap. `POST /:id/lines` below already
// accepted `stockItemId` and the Y-model new-Variety `type/colour/size/
// cultivar` fields for any editable-status PO (Draft/Sent/Shopping) — the
// reduced `AddLineInlineForm` component (florist PurchaseOrderPage.jsx /
// dashboard StockOrderPanel.jsx) just never sent them. The fix widened that
// form to match `DraftLineEditor`'s field set; the backend contract these
// tests lock in was already correct and required NO changes. These tests
// exist so a future refactor of this endpoint can't silently narrow it back
// down to "Draft only", and so the Variety-attrs-survive-to-Batch guarantee
// (pitfall #9 / batch-variety-attrs, #327) is proven for a line added AFTER
// send, not just at Draft-time (already covered by
// stockOrders.receiveIntoStock.integration.test.js for the Draft path).

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
  getActiveSeasonalCategory: () => null,
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';
import { stock } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

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

// Create a Draft PO with one seed line (so /send has a valid identity to
// check) and immediately send it to a driver.
async function createSentPO() {
  const created = await agent().post('/api/stock-orders').send({
    notes: '#550-regression',
    lines: [{ flowerName: 'Seed Line', quantity: 1, costPrice: 1 }],
  });
  expect(created.status).toBe(201);
  const poId = created.body.id;
  const sent = await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
  expect(sent.status).toBe(200);
  expect(sent.body.Status).toBe('Sent');
  return poId;
}

describe('POST /stock-orders/:id/lines — post-send identity (#550)', () => {
  it('accepts a new-Variety line (Type/Colour/Size/Cultivar, no Flower Name) on a Sent PO', async () => {
    const poId = await createSentPO();

    const added = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
      quantity: 20, costPrice: 3, supplier: 'Stefan',
    });

    expect(added.status).toBe(200);
    expect(added.body.Type).toBe('Tulip');
    expect(added.body.Colour).toBe('Yellow');
    expect(added.body.Size).toBe(40);
    expect(String(added.body['Flower Name'] || '').trim()).not.toBe('');
    expect(added.body['Quantity Needed']).toBe(20);
  });

  it('accepts an existing Stock Item link on a Sent PO', async () => {
    const [item] = await harness.db.insert(stock).values({
      displayName: 'Rose Red', purchaseName: 'Rose Red', currentQuantity: 0, active: true,
    }).returning();
    const poId = await createSentPO();

    const added = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      stockItemId: item.id, flowerName: 'Rose Red', quantity: 10, costPrice: 4, supplier: 'Stefan',
    });

    expect(added.status).toBe(200);
    expect(added.body['Stock Item']).toEqual([item.id]);
    expect(added.body['Flower Name']).toBe('Rose Red');
  });

  it('still rejects a genuinely blank line (no stock item, no name, no Type) on a Sent PO', async () => {
    const poId = await createSentPO();

    const added = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      quantity: 5, costPrice: 3, supplier: 'Stefan',
    });

    expect(added.status).toBe(400);
    expect(added.body.error).toMatch(/stock item or flower name/i);
  });

  it('a new-Variety line added AFTER send carries its attrs onto the received Batch (pitfall #9)', async () => {
    const poId = await createSentPO();
    const added = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      type: 'Peony', colour: 'Pink', size: 55, cultivar: 'Sarah Bernhardt',
      quantity: 12, costPrice: 8, sellPrice: 20, supplier: 'Stefan',
    });
    expect(added.status).toBe(200);
    const lineId = added.body.id;

    // Progress the PO to Evaluating (Sent → Reviewing is a direct allowed
    // transition — no need to hop through Shopping for this test).
    await agent().patch(`/api/stock-orders/${poId}`).send({ Status: 'Reviewing' });
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ 'Quantity Found': 12 });
    const approved = await agent().post(`/api/stock-orders/${poId}/approve-review`);
    expect(approved.status).toBe(200);

    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 12, writeOffQty: 0 }],
    });
    expect(evaluated.status).toBe(200);
    expect(evaluated.body.success).toBe(true);

    // Two stock rows now carry these Variety attrs: the auto-created
    // qty-0 template (linked at evaluate time) and the new dated Batch that
    // actually received the 12 accepted stems. Find the Batch by quantity.
    const rows = await harness.db.select().from(stock).where(
      and(eq(stock.typeName, 'Peony'), eq(stock.colour, 'Pink'), eq(stock.sizeCm, 55)),
    );
    const batchRow = rows.find(r => r.currentQuantity === 12);
    expect(batchRow, 'received Batch should exist and carry the line Variety attrs').toBeDefined();
    expect(batchRow.cultivar).toBe('Sarah Bernhardt');
    expect(batchRow.displayName).toMatch(/^Peony Pink 55cm Sarah Bernhardt \(\d{1,2}\.\w{3,4}\.\)$/);
  });
});
