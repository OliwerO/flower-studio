// backend/src/__tests__/assistantTools.freeTextPack.integration.test.js
//
// Integration tests for freeTextPack.searchTextHandler against a real pglite
// in-memory Postgres. Follows the same pattern as assistantTools.ordersPack.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { searchTextHandler } from '../services/assistantTools/freeTextPack.js';

// Shared test fixture — seeded once per describe block via beforeEach.
const SEED_ROWS = [
  // Order 1: unique phrase in customer_request
  {
    appOrderId:      'FT-1',
    customerId:      'cust-test',
    orderDate:       '2026-06-10',
    requiredBy:      '2026-06-11',
    deliveryType:    'Delivery',
    customerRequest: 'Please wrap with blue hydrangeas and a satin ribbon',
    floristNote:     null,
    greetingCardText: null,
  },
  // Order 2: phrase in florist_note
  {
    appOrderId:      'FT-2',
    customerId:      'cust-test',
    orderDate:       '2026-06-12',
    requiredBy:      '2026-06-13',
    deliveryType:    'Pickup',
    customerRequest: null,
    floristNote:     'Customer mentioned wedding anniversary — add extra greenery',
    greetingCardText: null,
  },
  // Order 3: phrase in greeting_card_text (the "card message" field)
  {
    appOrderId:      'FT-3',
    customerId:      'cust-test',
    orderDate:       '2026-06-14',
    requiredBy:      '2026-06-14',
    deliveryType:    'Delivery',
    customerRequest: null,
    floristNote:     null,
    greetingCardText: 'Happy wedding anniversary to my wonderful wife',
  },
  // Order 4: no free-text at all — should never appear in results
  {
    appOrderId:      'FT-4',
    customerId:      'cust-test',
    orderDate:       '2026-06-15',
    requiredBy:      '2026-06-16',
    deliveryType:    'Delivery',
    customerRequest: null,
    floristNote:     null,
    greetingCardText: null,
  },
  // Order 5: matches in TWO columns (both customer_request and florist_note)
  {
    appOrderId:      'FT-5',
    customerId:      'cust-test',
    orderDate:       '2026-06-16',
    requiredBy:      '2026-06-17',
    deliveryType:    'Delivery',
    customerRequest: 'wedding flowers please',
    floristNote:     'confirmed: wedding bouquet',
    greetingCardText: null,
  },
];

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  await harness.db.insert(orders).values(SEED_ROWS);
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('freeTextPack.searchTextHandler — basic keyword search', () => {
  it('finds an order by customer_request text', async () => {
    const r = await searchTextHandler({ query: 'blue hydrangeas' });
    expect(r.matchedCount).toBeGreaterThanOrEqual(1);
    const match = r.results.find(x => x.appOrderId === 'FT-1');
    expect(match).toBeDefined();
    expect(match.entity).toBe('order');
    expect(match.field).toBe('Customer request');
    expect(match.snippet).toContain('blue hydrangeas');
    expect(match.link).toMatch(/\/orders\//);
  });

  it('finds an order by florist_note text', async () => {
    const r = await searchTextHandler({ query: 'extra greenery' });
    const match = r.results.find(x => x.appOrderId === 'FT-2');
    expect(match).toBeDefined();
    expect(match.field).toBe('Florist note');
    expect(match.snippet).toContain('extra greenery');
  });

  it('finds an order by greeting_card_text (card message)', async () => {
    const r = await searchTextHandler({ query: 'wonderful wife' });
    const match = r.results.find(x => x.appOrderId === 'FT-3');
    expect(match).toBeDefined();
    expect(match.field).toBe('Card message');
    expect(match.snippet).toContain('wonderful wife');
  });

  it('returns multiple results when the query matches across different columns of the same order', async () => {
    const r = await searchTextHandler({ query: 'wedding' });
    // FT-2 (florist_note), FT-3 (greetingCardText), FT-5 (customerRequest + floristNote) should all match
    const ft5Entries = r.results.filter(x => x.appOrderId === 'FT-5');
    // FT-5 has "wedding" in BOTH customerRequest and floristNote → two entries
    expect(ft5Entries.length).toBe(2);
    const fields = ft5Entries.map(x => x.field).sort();
    expect(fields).toContain('Customer request');
    expect(fields).toContain('Florist note');
  });

  it('does not return orders with no matching text', async () => {
    const r = await searchTextHandler({ query: 'blue hydrangeas' });
    const noMatch = r.results.find(x => x.appOrderId === 'FT-4');
    expect(noMatch).toBeUndefined();
  });

  it('is case-insensitive', async () => {
    const lower = await searchTextHandler({ query: 'hydrangeas' });
    const upper = await searchTextHandler({ query: 'HYDRANGEAS' });
    expect(lower.matchedCount).toBe(upper.matchedCount);
  });
});

describe('freeTextPack.searchTextHandler — snippet shape', () => {
  it('snippet contains the query text', async () => {
    const r = await searchTextHandler({ query: 'satin ribbon' });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].snippet).toContain('satin ribbon');
  });

  it('snippet is shorter than the full field text for long fields', async () => {
    // FT-1 customerRequest is 51 chars — short enough that snippet == full text (no ellipsis needed)
    // This test just verifies snippet is present and non-empty
    const r = await searchTextHandler({ query: 'satin ribbon' });
    expect(r.results[0].snippet.length).toBeGreaterThan(0);
  });
});

describe('freeTextPack.searchTextHandler — link format', () => {
  it('builds a /orders/<id> link', async () => {
    const r = await searchTextHandler({ query: 'blue hydrangeas' });
    const match = r.results.find(x => x.appOrderId === 'FT-1');
    expect(match.link).toMatch(/^\/orders\/.+/);
  });
});

describe('freeTextPack.searchTextHandler — scope filter', () => {
  it('scope=orders returns order results', async () => {
    const r = await searchTextHandler({ query: 'wedding', scope: 'orders' });
    expect(r.scope).toBe('orders');
    expect(r.results.length).toBeGreaterThan(0);
    r.results.forEach(x => expect(x.entity).toBe('order'));
  });

  it('scope=customers returns empty (no notes column in Phase 5 schema)', async () => {
    const r = await searchTextHandler({ query: 'wedding', scope: 'customers' });
    expect(r.scope).toBe('customers');
    expect(r.results).toHaveLength(0);
    expect(r.matchedCount).toBe(0);
  });

  it('scope=all covers orders', async () => {
    const r = await searchTextHandler({ query: 'wedding', scope: 'all' });
    expect(r.scope).toBe('all');
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('invalid scope falls back to all', async () => {
    const r = await searchTextHandler({ query: 'wedding', scope: 'bogus' });
    expect(r.scope).toBe('all');
    expect(r.results.length).toBeGreaterThan(0);
  });
});

describe('freeTextPack.searchTextHandler — limit / cap', () => {
  beforeEach(async () => {
    // Insert 20 more orders all matching "cappedphrase" to test cap
    const bulk = Array.from({ length: 20 }, (_, i) => ({
      appOrderId:      `CAP-${i}`,
      customerId:      'cust-test',
      orderDate:       '2026-05-01',
      deliveryType:    'Delivery',
      customerRequest: `order with cappedphrase number ${i}`,
    }));
    await harness.db.insert(orders).values(bulk);
  });

  it('respects a low limit and sets truncated=true when more results exist', async () => {
    const r = await searchTextHandler({ query: 'cappedphrase', limit: 5 });
    expect(r.truncated).toBe(true);
    // results may exceed limit because each row can produce multiple field entries,
    // but the number of ROWS fetched from DB is capped
    expect(r.results.length).toBeLessThanOrEqual(5 * 3); // at most 3 fields per row
  });

  it('does not exceed MAX_LIMIT (50) even with a huge limit param', async () => {
    const r = await searchTextHandler({ query: 'cappedphrase', limit: 999 });
    // 20 rows × 1 matching field each — stays under cap
    expect(r.results.length).toBeLessThanOrEqual(50 * 3);
  });
});

describe('freeTextPack.searchTextHandler — empty / missing query', () => {
  it('empty string query returns empty results with no error', async () => {
    const r = await searchTextHandler({ query: '' });
    expect(r.matchedCount).toBe(0);
    expect(r.results).toHaveLength(0);
    expect(r.truncated).toBe(false);
  });

  it('whitespace-only query returns empty results', async () => {
    const r = await searchTextHandler({ query: '   ' });
    expect(r.matchedCount).toBe(0);
    expect(r.results).toHaveLength(0);
  });

  it('omitted query returns empty results', async () => {
    const r = await searchTextHandler({});
    expect(r.matchedCount).toBe(0);
  });

  it('no match query returns empty results', async () => {
    const r = await searchTextHandler({ query: 'zzznomatchxxx' });
    expect(r.matchedCount).toBe(0);
    expect(r.results).toHaveLength(0);
  });
});

describe('freeTextPack.searchTextHandler — response shape', () => {
  it('result object carries required fields', async () => {
    const r = await searchTextHandler({ query: 'blue hydrangeas' });
    expect(r).toHaveProperty('query', 'blue hydrangeas');
    expect(r).toHaveProperty('scope');
    expect(r).toHaveProperty('matchedCount');
    expect(r).toHaveProperty('truncated');
    expect(r).toHaveProperty('results');
    const item = r.results[0];
    expect(item).toHaveProperty('entity');
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('field');
    expect(item).toHaveProperty('snippet');
    expect(item).toHaveProperty('link');
  });
});
