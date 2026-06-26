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

import * as productConfigRepo from '../repos/productConfigRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('productConfig accepts Product Name edits', () => {
  it('update persists Product Name', async () => {
    const created = await productConfigRepo.create({
      'Product Name': 'Old Name', 'Variant Name': 'L',
      'Wix Product ID': 'p1', 'Wix Variant ID': 'v1',
    });
    const updated = await productConfigRepo.update(created.id, { 'Product Name': 'New Name' });
    expect(updated['Product Name']).toBe('New Name');
  });
});
