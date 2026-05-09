// E2E coverage for the public storefront endpoints (/api/public/*).
// Locks in two invariants that surfaced as bugs during the May 2026
// Available Today incident:
//
//   1. /categories.auto[available-today].productCount is always numeric.
//      Pre-fix it was `null` whenever the in-memory products cache was
//      cold (process restart or 60s TTL elapsed). masterPage.js on the
//      Wix storefront does `productCount > 0`, so `null > 0` hid the
//      menu entry even when qualifying products existed.
//
//   2. /categories.auto[available-today].productCount matches the count
//      derived from /products (products where availableToday === true
//      AND category includes 'Available Today'). Drift between the two
//      endpoints means the menu would advertise a count the category
//      page can't deliver.
//
// The fixture starts with zero product config rows, so both numbers are
// 0 — that's fine. The invariants are what we lock down, not specific
// counts.

import { test, expect } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3002';

async function reset(request) {
  const res = await request.post(`${HARNESS_URL}/api/test/reset`);
  expect(res.ok()).toBe(true);
}

test.describe('public storefront API', () => {
  test('/categories returns numeric productCount on cold cache (no prior /products call)', async ({ request }) => {
    await reset(request);

    // Hit /categories FIRST — products cache is cold. Pre-fix returned null.
    const res = await request.get(`${HARNESS_URL}/api/public/categories`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    const at = body.auto.find(a => a.slug === 'available-today');
    expect(at).toBeDefined();
    expect(typeof at.productCount).toBe('number');
    expect(at.productCount).not.toBeNull();
  });

  test('/categories productCount matches the AT count derived from /products', async ({ request }) => {
    await reset(request);

    const productsRes = await request.get(`${HARNESS_URL}/api/public/products`);
    expect(productsRes.ok()).toBe(true);
    const products = (await productsRes.json()).products || [];
    const expectedCount = products.filter(
      p => p.availableToday && (p.category || []).includes('Available Today')
    ).length;

    const catRes = await request.get(`${HARNESS_URL}/api/public/categories`);
    expect(catRes.ok()).toBe(true);
    const at = (await catRes.json()).auto.find(a => a.slug === 'available-today');

    expect(at.productCount).toBe(expectedCount);
  });
});
