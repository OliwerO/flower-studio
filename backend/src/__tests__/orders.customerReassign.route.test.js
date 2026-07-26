// Route-level tests for PATCH /api/orders/:id — Customer reassignment (#389).
//
// The owner-only "Change customer" affordance (florist + dashboard apps)
// PATCHes { Customer: [newCustomerId] }. orderRepo.updateOrder already wrote
// the Customer field (ORDER_WRITE_ALLOWED listed it) — what was actually
// missing was at the ROUTE layer: 'Customer' wasn't in ORDERS_PATCH_ALLOWED,
// so pickAllowed() silently stripped it before it ever reached the repo.
// This file mocks every repo/service orders.js touches (mirrors
// orders.imageRoute.test.js's pattern) so the router can be exercised in
// isolation via supertest, and pins the new HTTP-layer contract:
//   - owner-only gate (florist attempting to reassign gets 403)
//   - target-customer existence check (400 on an unknown id)
//   - shape normalization (bare string id OR [id] array both accepted)
//   - unrelated PATCH fields (no Customer key) are unaffected
//
// Complements the real-Postgres persistence proof in
// orderRepo.integration.test.js ("updateOrder — Customer reassignment").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../repos/stockRepo.js', () => ({
  getById:        vi.fn(),
  adjustQuantity: vi.fn(),
}));
vi.mock('../repos/productRepo.js', () => ({
  getImagesBatch: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../repos/customerRepo.js', () => ({
  getById: vi.fn(),
}));
vi.mock('../repos/orderRepo.js', () => ({
  getById:               vi.fn(),
  list:                  vi.fn(),
  updateOrder:           vi.fn(),
  getOrderStatusHistory: vi.fn(),
  convertToDelivery:     vi.fn(),
  updateOrderLine:       vi.fn(),
}));
vi.mock('../services/orderService.js', () => ({
  createOrder:           vi.fn(),
  transitionStatus:      vi.fn(),
  cancelWithStockReturn: vi.fn(),
  deleteOrder:           vi.fn(),
  editBouquetLines:      vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/driverNotifyService.js', () => ({ notifyDeliveryAssigned: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getDriverOfDay:  vi.fn(),
  getConfig:       vi.fn(),
  generateOrderId: vi.fn(),
}));

const customerRepo = await import('../repos/customerRepo.js');
const orderRepo    = await import('../repos/orderRepo.js');

async function buildApp(role = 'owner') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = role;
    next();
  });
  const m = await import('../routes/orders.js');
  app.use('/api/orders', m.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/orders/:id — Customer reassignment (#389)', () => {
  it('florist gets 403 — reassigning the customer is owner-only', async () => {
    const app = await buildApp('florist');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: ['cust-new'] });

    expect(res.status).toBe(403);
    expect(customerRepo.getById).not.toHaveBeenCalled();
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
  });

  it('400 when the target customer id does not resolve to a real customer', async () => {
    const notFound = new Error('Customer not found.');
    notFound.statusCode = 404;
    customerRepo.getById.mockRejectedValue(notFound);

    const app = await buildApp('owner');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: ['cust-missing'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
  });

  it('400 when Customer is an empty array', async () => {
    const app = await buildApp('owner');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: [] });

    expect(res.status).toBe(400);
    expect(customerRepo.getById).not.toHaveBeenCalled();
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
  });

  it('owner happy path: validates the customer, reassigns, returns the updated order', async () => {
    customerRepo.getById.mockResolvedValue({ id: 'cust-new', Name: 'Anna Kowalska' });
    orderRepo.updateOrder.mockResolvedValue({ id: 'ord1', Customer: ['cust-new'] });

    const app = await buildApp('owner');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: ['cust-new'] });

    expect(res.status).toBe(200);
    expect(res.body.Customer).toEqual(['cust-new']);
    expect(customerRepo.getById).toHaveBeenCalledWith('cust-new');
    expect(orderRepo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { Customer: ['cust-new'], keyPersonId: null },
      expect.objectContaining({ actor: expect.objectContaining({ actorRole: 'owner' }) }),
    );
  });

  it('accepts a bare string id (not just an array) and normalizes it before writing', async () => {
    customerRepo.getById.mockResolvedValue({ id: 'cust-new', Name: 'Anna Kowalska' });
    orderRepo.updateOrder.mockResolvedValue({ id: 'ord1', Customer: ['cust-new'] });

    const app = await buildApp('owner');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: 'cust-new' });

    expect(res.status).toBe(200);
    expect(orderRepo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { Customer: ['cust-new'], keyPersonId: null },
      expect.any(Object),
    );
  });

  it('clears the stale key-person link on reassignment (review fix) — otherwise a recipient tied to the OLD customer would prefill Step 3 for the new one', async () => {
    customerRepo.getById.mockResolvedValue({ id: 'cust-new', Name: 'Anna Kowalska' });
    orderRepo.updateOrder.mockResolvedValue({ id: 'ord1', Customer: ['cust-new'], keyPersonId: null });

    const app = await buildApp('owner');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ Customer: ['cust-new'] });

    expect(res.status).toBe(200);
    expect(orderRepo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      expect.objectContaining({ keyPersonId: null }),
      expect.any(Object),
    );
  });

  it('does NOT touch keyPersonId when Customer is absent from the PATCH body', async () => {
    orderRepo.updateOrder.mockResolvedValue({ id: 'ord1', 'Florist Note': 'Add ribbon' });

    const app = await buildApp('florist');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ 'Florist Note': 'Add ribbon' });

    expect(res.status).toBe(200);
    expect(orderRepo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { 'Florist Note': 'Add ribbon' },
      expect.any(Object),
    );
    const calledFields = orderRepo.updateOrder.mock.calls[0][1];
    expect('keyPersonId' in calledFields).toBe(false);
  });

  it('unrelated PATCH fields still work for a florist (no Customer key in body)', async () => {
    orderRepo.updateOrder.mockResolvedValue({ id: 'ord1', 'Florist Note': 'Add ribbon' });

    const app = await buildApp('florist');
    const res = await request(app)
      .patch('/api/orders/ord1')
      .send({ 'Florist Note': 'Add ribbon' });

    expect(res.status).toBe(200);
    expect(customerRepo.getById).not.toHaveBeenCalled();
    expect(orderRepo.updateOrder).toHaveBeenCalledWith(
      'ord1',
      { 'Florist Note': 'Add ribbon' },
      expect.any(Object),
    );
  });
});
