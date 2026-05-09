// Regression test for the cold-cache bug in /api/public/categories.
// Pre-fix: `productCount` for the `available-today` auto category was `null`
// when the in-memory products cache was cold (process restart or TTL elapsed).
// masterPage.js on the Wix storefront does `productCount > 0`, so `null > 0`
// hid the menu entry even when qualifying products existed. The route now
// shares the products fetcher and warms the cache inline.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../repos/productConfigRepo.js', () => ({
  list: vi.fn(),
}));
vi.mock('../repos/stockRepo.js', () => ({
  list: vi.fn(),
}));
vi.mock('../services/configService.js', () => ({
  getConfig: vi.fn(),
  getActiveSeasonalCategory: vi.fn(() => null),
  getActiveSeasonalSlots: vi.fn(() => []),
}));

const productConfigRepo = await import('../repos/productConfigRepo.js');
const stockRepo         = await import('../repos/stockRepo.js');
const configService     = await import('../services/configService.js');

async function buildApp() {
  // Re-import the router fresh so the module-level cache resets between tests.
  vi.resetModules();
  const app = express();
  const m = await import('../routes/public.js');
  app.use('/api/public', m.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  configService.getConfig.mockImplementation((key) => {
    if (key === 'storefrontCategories') {
      return {
        permanent: [{ name: 'All Bouquets', slug: 'all-bouquets' }],
        seasonal: [],
        auto: [{ name: 'Available Today', slug: 'available-today', translations: {} }],
      };
    }
    return null;
  });
});

describe('GET /api/public/categories', () => {
  it('returns numeric productCount for available-today on cold cache (regression)', async () => {
    productConfigRepo.list.mockResolvedValue([
      {
        'Wix Product ID': 'prod-1',
        'Product Name': 'Mix of the day - L',
        'Variant Name': 'L',
        'Wix Variant ID': 'var-1',
        'Price': 250,
        'Lead Time Days': 0,
        'Min Stems': 0,
        'Category': ['Available Today'],
        'Active': true,
      },
      {
        'Wix Product ID': 'prod-2',
        'Product Name': 'Mix of the day - M',
        'Variant Name': 'M',
        'Wix Variant ID': 'var-2',
        'Price': 180,
        'Lead Time Days': 0,
        'Min Stems': 0,
        'Category': ['Available Today'],
        'Active': true,
      },
    ]);
    stockRepo.list.mockResolvedValue([]); // no stock rows needed — Min Stems=0 + no Key Flower → inStock via Infinity

    const app = await buildApp();
    const res = await request(app).get('/api/public/categories');

    expect(res.status).toBe(200);
    const at = res.body.auto.find(a => a.slug === 'available-today');
    expect(at).toBeDefined();
    expect(at.productCount).toBe(2);
    // Pre-fix this was `null`. Guarding against regression to null.
    expect(at.productCount).not.toBeNull();
  });

  it('invalidatePublicCache evicts entries so the next request rebuilds', async () => {
    productConfigRepo.list.mockResolvedValue([]);
    stockRepo.list.mockResolvedValue([]);

    vi.resetModules();
    const m = await import('../routes/public.js');
    const app = express();
    app.use('/api/public', m.default);

    await request(app).get('/api/public/products');
    expect(productConfigRepo.list).toHaveBeenCalledTimes(1);

    // Cached on the next call — fetcher not invoked again.
    await request(app).get('/api/public/products');
    expect(productConfigRepo.list).toHaveBeenCalledTimes(1);

    // Eviction forces a rebuild on the next request.
    m.invalidatePublicCache('products');
    await request(app).get('/api/public/products');
    expect(productConfigRepo.list).toHaveBeenCalledTimes(2);
  });

  it('returns 0 (not null) when no qualifying products exist', async () => {
    productConfigRepo.list.mockResolvedValue([
      {
        'Wix Product ID': 'prod-3',
        'Product Name': 'Slow lead',
        'Wix Variant ID': 'var-3',
        'Variant Name': 'std',
        'Price': 100,
        'Lead Time Days': 2,
        'Min Stems': 0,
        'Category': ['All Bouquets'],
        'Active': true,
      },
    ]);
    stockRepo.list.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app).get('/api/public/categories');

    expect(res.status).toBe(200);
    const at = res.body.auto.find(a => a.slug === 'available-today');
    expect(at.productCount).toBe(0);
  });
});
