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
