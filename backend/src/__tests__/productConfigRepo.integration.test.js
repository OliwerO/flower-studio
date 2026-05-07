import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as repo from '../repos/productConfigRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

async function seed(overrides = {}) {
  return repo.create({
    wixProductId: overrides.wixProductId || 'prod-1',
    wixVariantId: overrides.wixVariantId || 'var-1',
    productName:  overrides.productName  || 'Red Rose',
    variantName:  overrides.variantName  || '5 stems',
    price:        overrides.price        ?? 49,
    active:       overrides.active       ?? true,
    ...overrides,
  });
}

describe('productConfigRepo', () => {
  it('creates and lists a product config row', async () => {
    await seed();
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]['Product Name']).toBe('Red Rose');
  });

  it('setImage writes image URL to all variants of a product', async () => {
    await seed({ wixProductId: 'p1', wixVariantId: 'v1' });
    await seed({ wixProductId: 'p1', wixVariantId: 'v2' });
    await repo.setImage('p1', 'https://example.com/img.jpg');
    const rows = await repo.list();
    expect(rows.every(r => r['Image URL'] === 'https://example.com/img.jpg')).toBe(true);
  });

  it('getImage returns empty string when no row matches', async () => {
    const url = await repo.getImage('no-such-product');
    expect(url).toBe('');
  });

  it('getImagesBatch returns a Map of wixProductId → imageUrl', async () => {
    await seed({ wixProductId: 'p1', wixVariantId: 'v1', imageUrl: 'https://a.com/1.jpg' });
    await seed({ wixProductId: 'p2', wixVariantId: 'v1', imageUrl: 'https://a.com/2.jpg' });
    const map = await repo.getImagesBatch(['p1', 'p2', 'p3']);
    expect(map.get('p1')).toBe('https://a.com/1.jpg');
    expect(map.get('p2')).toBe('https://a.com/2.jpg');
    expect(map.has('p3')).toBe(false);
  });

  it('upsert creates new row and updates existing on wix pair key', async () => {
    await repo.upsert({ wixProductId: 'p1', wixVariantId: 'v1', productName: 'Rose', price: 40 });
    await repo.upsert({ wixProductId: 'p1', wixVariantId: 'v1', productName: 'Rose Deluxe', price: 50 });
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]['Product Name']).toBe('Rose Deluxe');
  });

  it('update patches editable fields', async () => {
    const row = await seed();
    const updated = await repo.update(row.id, { Price: 99, Active: false });
    expect(updated.Price).toBe(99);
    expect(updated.Active).toBe(false);
  });

  it('decrementQuantity clamps at 0 and skips null', async () => {
    await seed({ wixProductId: 'p1', wixVariantId: 'v1', quantity: 5 });
    await repo.decrementQuantity('p1', 'v1', 3);
    const rows = await repo.list();
    expect(Number(rows[0].Quantity)).toBe(2);
  });
});
