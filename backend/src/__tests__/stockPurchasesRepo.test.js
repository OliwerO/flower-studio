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

import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('stockPurchasesRepo — quantityAccepted (#492)', () => {
  it('persists and returns quantityAccepted when provided', async () => {
    const row = await stockPurchasesRepo.create({
      purchaseDate: '2026-07-01',
      supplier: 'Stefan',
      quantityPurchased: 20,
      quantityAccepted: 17,
      pricePerUnit: 5,
      notes: 'test',
    });
    expect(row['Quantity Purchased']).toBe(20);
    expect(row['Quantity Accepted']).toBe(17);

    const [listed] = await stockPurchasesRepo.list({ from: '2026-07-01', to: '2026-07-01' });
    expect(listed['Quantity Accepted']).toBe(17);
  });

  it('returns null (not 0) for quantityAccepted on a legacy-shaped row', async () => {
    const row = await stockPurchasesRepo.create({
      purchaseDate: '2026-07-01',
      supplier: 'Stefan',
      quantityPurchased: 10,
      pricePerUnit: 5,
      notes: 'legacy-shape, no quantityAccepted',
    });
    expect(row['Quantity Accepted']).toBe(null);
  });
});
