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

const airtable    = await import('../services/airtable.js');
const productRepo = await import('../repos/productRepo.js');

beforeEach(() => { vi.clearAllMocks(); });

async function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'florist'; next(); });
  const m = await import('../routes/orders.js');
  app.use('/api/orders', m.default);
  return app;
}

describe('GET /api/orders/:id includes bouquetImageUrl', () => {
  it('attaches imageUrl from productRepo when order has Wix Product ID', async () => {
    airtable.getById.mockImplementation(async (table, id) => {
      if (id === 'ord1') {
        return {
          id: 'ord1',
          'Wix Product ID': 'prod-1',
          'Order Lines': [],
          Status: 'New',
          Customer: [],
          Deliveries: [],
        };
      }
      return null;
    });
    airtable.list.mockResolvedValue([]); // no order lines
    productRepo.getImagesBatch.mockResolvedValue(new Map([['prod-1', 'https://static/x.jpg']]));

    const app = await buildApp();
    const res = await request(app).get('/api/orders/ord1');
    expect(res.status).toBe(200);
    expect(res.body.bouquetImageUrl).toBe('https://static/x.jpg');
    expect(productRepo.getImagesBatch).toHaveBeenCalledWith(['prod-1']);
  });

  it('returns empty bouquetImageUrl when order has no Wix Product ID', async () => {
    airtable.getById.mockImplementation(async (_t, id) => {
      if (id === 'ord1') return {
        id: 'ord1',
        'Order Lines': [],
        Status: 'New',
        Customer: [],
        Deliveries: [],
      };
      return null;
    });
    airtable.list.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app).get('/api/orders/ord1');
    expect(res.status).toBe(200);
    expect(res.body.bouquetImageUrl).toBe('');
    expect(productRepo.getImagesBatch).not.toHaveBeenCalled();
  });

  it('returns empty bouquetImageUrl when productRepo throws (does not 500)', async () => {
    airtable.getById.mockImplementation(async (_t, id) => {
      if (id === 'ord1') return {
        id: 'ord1',
        'Wix Product ID': 'prod-1',
        'Order Lines': [],
        Status: 'New',
        Customer: [],
        Deliveries: [],
      };
      return null;
    });
    airtable.list.mockResolvedValue([]);
    productRepo.getImagesBatch.mockRejectedValue(new Error('airtable down'));

    const app = await buildApp();
    const res = await request(app).get('/api/orders/ord1');
    expect(res.status).toBe(200);
    expect(res.body.bouquetImageUrl).toBe('');
  });
});

describe('GET /api/orders list enrichment', () => {
  it('attaches bouquetImageUrl to each order using one batched lookup', async () => {
    // Mock the orders list. The route calls airtable.list multiple times
    // for related lookups — set the FIRST call to return the orders.
    airtable.list.mockResolvedValueOnce([
      { id: 'o1', 'Wix Product ID': 'p1', 'Order Lines': [], Status: 'New', Customer: [], Deliveries: [] },
      { id: 'o2', 'Wix Product ID': 'p2', 'Order Lines': [], Status: 'New', Customer: [], Deliveries: [] },
      { id: 'o3', 'Wix Product ID': '',   'Order Lines': [], Status: 'New', Customer: [], Deliveries: [] },
    ]);
    // Subsequent airtable.list calls (for lines, deliveries, customers) → empty
    airtable.list.mockResolvedValue([]);
    productRepo.getImagesBatch.mockResolvedValue(new Map([['p1', 'u1'], ['p2', 'u2']]));

    const app = await buildApp();
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map(o => [o.id, o.bouquetImageUrl]));
    expect(byId).toEqual({ o1: 'u1', o2: 'u2', o3: '' });
    expect(productRepo.getImagesBatch).toHaveBeenCalledTimes(1);
    // distinct, sorted-by-encounter order, only non-empty IDs
    expect(productRepo.getImagesBatch).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('per-order Image URL overrides the storefront product image', async () => {
    airtable.list.mockResolvedValueOnce([
      { id: 'o1', 'Wix Product ID': 'p1', 'Image URL': 'https://override/o1.jpg', 'Order Lines': [], Status: 'New', Customer: [], Deliveries: [] },
      { id: 'o2', 'Wix Product ID': 'p2', 'Order Lines': [], Status: 'New', Customer: [], Deliveries: [] },
    ]);
    airtable.list.mockResolvedValue([]);
    productRepo.getImagesBatch.mockResolvedValue(new Map([['p2', 'storefront-p2']]));

    const app = await buildApp();
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map(o => [o.id, o.bouquetImageUrl]));
    expect(byId).toEqual({ o1: 'https://override/o1.jpg', o2: 'storefront-p2' });
    // Only o2 needed the storefront lookup — o1 was already overridden.
    expect(productRepo.getImagesBatch).toHaveBeenCalledWith(['p2']);
  });
});

describe('GET /api/orders/:id Image URL precedence', () => {
  it('uses per-order Image URL when set, skipping storefront lookup', async () => {
    airtable.getById.mockImplementation(async (_t, id) => {
      if (id === 'ord1') return {
        id: 'ord1',
        'Wix Product ID': 'prod-1',
        'Image URL': 'https://override/ord1.jpg',
        'Order Lines': [],
        Status: 'New',
        Customer: [],
        Deliveries: [],
      };
      return null;
    });
    airtable.list.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app).get('/api/orders/ord1');
    expect(res.status).toBe(200);
    expect(res.body.bouquetImageUrl).toBe('https://override/ord1.jpg');
    expect(productRepo.getImagesBatch).not.toHaveBeenCalled();
  });
});
