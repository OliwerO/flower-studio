import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/airtable.js', () => ({
  list:    vi.fn(),
  getById: vi.fn(),
  update:  vi.fn(),
  create:  vi.fn(),
  deleteRecord: vi.fn(),
}));
vi.mock('../repos/productRepo.js', () => ({ getImagesBatch: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: null }));

const airtable = await import('../services/airtable.js');
const repo     = await import('../repos/productRepo.js');

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/deliveries enriches each row with bouquetImageUrl', () => {
  it('attaches bouquetImageUrl from a single batched lookup', async () => {
    // Route call sequence (airtable mode):
    //   1. orderRepo.listDeliveries → airtable.list(DELIVERIES) → [delivery rows]
    //   2. orderRepo.listByIds(orderIds) → airtable.list(ORDERS) → [order rows]
    //   3. db.list(CUSTOMERS) → [] (no customers needed for this test)
    airtable.list.mockResolvedValueOnce([
      { id: 'd1', Status: 'Pending', 'Linked Order': ['ord1'] },
    ]);
    airtable.list.mockResolvedValueOnce([
      { id: 'ord1', 'Wix Product ID': 'p1', 'App Order ID': '202605-001', Customer: [] },
    ]);
    airtable.list.mockResolvedValue([]);
    repo.getImagesBatch.mockResolvedValue(new Map([['p1', 'u1']]));

    const app = express();
    app.use((r, _s, n) => { r.role = 'driver'; r.driverName = 'Timur'; n(); });
    const m = await import('../routes/deliveries.js');
    app.use('/api/deliveries', m.default);
    const res = await request(app).get('/api/deliveries');
    expect(res.status).toBe(200);
    expect(res.body[0].bouquetImageUrl).toBe('u1');
    expect(repo.getImagesBatch).toHaveBeenCalledTimes(1);
    expect(repo.getImagesBatch).toHaveBeenCalledWith(['p1']);
  });

  it('per-order Image URL overrides the storefront product image', async () => {
    airtable.list.mockResolvedValueOnce([
      { id: 'd1', Status: 'Pending', 'Linked Order': ['ord1'] },
      { id: 'd2', Status: 'Pending', 'Linked Order': ['ord2'] },
    ]);
    airtable.list.mockResolvedValueOnce([
      { id: 'ord1', 'Wix Product ID': 'p1', 'Image URL': 'https://override/ord1.jpg', 'App Order ID': '001', Customer: [] },
      { id: 'ord2', 'Wix Product ID': 'p2', 'App Order ID': '002', Customer: [] },
    ]);
    airtable.list.mockResolvedValue([]);
    repo.getImagesBatch.mockResolvedValue(new Map([['p2', 'storefront-p2']]));

    const app = express();
    app.use((r, _s, n) => { r.role = 'driver'; r.driverName = 'Timur'; n(); });
    const m = await import('../routes/deliveries.js');
    app.use('/api/deliveries', m.default);
    const res = await request(app).get('/api/deliveries');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map(d => [d.id, d.bouquetImageUrl]));
    expect(byId).toEqual({ d1: 'https://override/ord1.jpg', d2: 'storefront-p2' });
    // Only the order without an override hit the storefront lookup.
    expect(repo.getImagesBatch).toHaveBeenCalledWith(['p2']);
    // orderId now stamped on each delivery so SSE can patch in place.
    const d1 = res.body.find(d => d.id === 'd1');
    expect(d1.orderId).toBe('ord1');
  });
});
