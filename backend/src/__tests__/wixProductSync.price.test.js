import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression suite for #428 — the price-push phase batching fix.
//
// Root cause: runPush()'s price phase fired ONE `PATCH .../products/{id}/
// variants` call PER (product, variant) pair, all through a single shared
// PQueue with NO grouping by product. Wix treats that endpoint as a full
// variant-collection replace, not a per-variant merge — so two concurrent
// PATCHes for two DIFFERENT variants of the SAME product raced, the later
// write won, and the earlier variant's new price was silently discarded
// while `stats.errors` stayed empty and the UI reported clean success
// (confirmed against sync_log on the 2026-06-23 incident day: every push
// that afternoon logged `status=success(push)` with a non-zero
// `price_syncs` count).
//
// `updateWixInventory` and `updateWixVariantVisibility` hit the same/an
// adjacent Wix endpoint shape and already solved this by batching every one
// of a product's variants into a single call. The fix mirrors that for
// price: group changed variants BY PRODUCT, send exactly one PATCH per
// product, keep concurrency ACROSS products (PUSH_CONCURRENCY) — never
// within one product.

const upsertMock = vi.fn();
const listMock = vi.fn();
const softDeleteMock = vi.fn();
const deactivateMock = vi.fn();
const notifyWixSyncErrorMock = vi.fn();

vi.mock('../repos/productConfigRepo.js', () => ({
  list: (...a) => listMock(...a),
  upsert: (...a) => upsertMock(...a),
  softDelete: (...a) => softDeleteMock(...a),
  deactivate: (...a) => deactivateMock(...a),
}));
vi.mock('../repos/syncLogRepo.js', () => ({ logSync: vi.fn() }));
vi.mock('../repos/stockRepo.js', () => ({ list: vi.fn(async () => []) }));
vi.mock('../services/telegram.js', () => ({
  sendAlert: vi.fn(),
  notifyWixSyncError: (...a) => notifyWixSyncErrorMock(...a),
}));
vi.mock('../services/configService.js', () => ({
  getConfig: () => ({}),
  updateConfig: vi.fn(),
  getActiveSeasonalSlots: () => [],
  getActiveSeasonalCategory: () => null,
}));

/** Wix `/stores/v1/products/query` response: N products, each with managed variants. */
function wixProductsPayload(products) {
  return {
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      visible: true,
      variants: p.variants.map(v => ({
        id: v.id,
        choices: { Size: v.id },
        variant: { visible: true, priceData: { price: v.wixPrice } },
      })),
    })),
  };
}

/** product_config row (wire format) driving the price phase comparison. */
function configRow({ pid, vid, productName, variantName, price }) {
  return {
    'Wix Product ID': pid,
    'Wix Variant ID': vid,
    'Product Name': productName,
    'Variant Name': variantName,
    Price: price,
    Active: true,
  };
}

/**
 * Matches PATCH .../products/{pid}/variants calls carrying a PRICE body —
 * distinguishes them from the Visibility phase's PATCH to the SAME URL
 * (which carries `{variantIds, visible}` with no `priceData`), since both
 * phases run inside the same `runPush()` call.
 */
function priceCallsFor(pid) {
  return fetch.mock.calls.filter(([url, opts]) => {
    if (url !== `https://www.wixapis.com/stores/v1/products/${pid}/variants`) return false;
    const body = JSON.parse(opts.body);
    return Array.isArray(body.variants) && body.variants.length > 0
      && body.variants.every(v => v.variant?.priceData !== undefined);
  });
}

/** Baseline fetch router shared by all tests — real Wix endpoints touched by runPush(). */
function baseFetchImpl({ productsResponse, onPricePatch } = {}) {
  return async (url, opts) => {
    if (typeof url === 'string' && url.includes('/stores/v1/products/query')) {
      return productsResponse();
    }
    if (typeof url === 'string' && url.includes('/stores/v1/collections/query')) {
      return { ok: true, json: async () => ({ collections: [] }) };
    }
    if (typeof url === 'string' && url.includes('/stores/v2/inventoryItems/product/')) {
      return { ok: true, json: async () => ({}) }; // Availability phase — irrelevant here
    }
    if (typeof url === 'string' && url.endsWith('/variants')) {
      const body = JSON.parse(opts.body);
      const isPricePatch = Array.isArray(body.variants) && body.variants.every(v => v.variant?.priceData !== undefined);
      if (isPricePatch && onPricePatch) return onPricePatch(url, body);
      return { ok: true, json: async () => ({}) }; // Visibility phase (same URL) — always succeeds
    }
    return { ok: true, json: async () => ({}) };
  };
}

describe('runPush — price phase batching (#428)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
    listMock.mockReset();
    upsertMock.mockReset().mockResolvedValue({});
    softDeleteMock.mockReset().mockResolvedValue({});
    deactivateMock.mockReset().mockResolvedValue({});
    notifyWixSyncErrorMock.mockReset();
  });

  it('batches N changed variants of ONE product into exactly one PATCH', async () => {
    const products = [{
      id: 'prod-A',
      name: 'White Hydrangeas',
      variants: [
        { id: 'v-a1', wixPrice: 100 },
        { id: 'v-a2', wixPrice: 200 },
        { id: 'v-a3', wixPrice: 300 },
      ],
    }];
    fetch.mockImplementation(baseFetchImpl({
      productsResponse: async () => ({ ok: true, json: async () => wixProductsPayload(products) }),
    }));
    listMock.mockResolvedValue([
      configRow({ pid: 'prod-A', vid: 'v-a1', productName: 'White Hydrangeas', variantName: '1', price: 110 }),
      configRow({ pid: 'prod-A', vid: 'v-a2', productName: 'White Hydrangeas', variantName: '2', price: 210 }),
      configRow({ pid: 'prod-A', vid: 'v-a3', productName: 'White Hydrangeas', variantName: '3', price: 310 }),
    ]);

    const { runPush } = await import('../services/wixProductSync.js');
    const stats = await runPush();

    // Exactly ONE PATCH for the product — not one per variant.
    const calls = priceCallsFor('prod-A');
    expect(calls).toHaveLength(1);

    // ...carrying ALL 3 variants' new prices in a single body.
    const [, opts] = calls[0];
    const body = JSON.parse(opts.body);
    expect(body.variants).toHaveLength(3);
    const priceById = Object.fromEntries(body.variants.map(v => [v.id, v.variant.priceData.price]));
    expect(priceById).toEqual({ 'v-a1': 110, 'v-a2': 210, 'v-a3': 310 });

    expect(stats.pricesSynced).toBe(3);
    expect(stats.errors).toEqual([]);
  });

  it('still pushes multiple products concurrently (one batched PATCH each, in flight together)', async () => {
    const products = [
      { id: 'prod-A', name: 'Product A', variants: [{ id: 'v-a1', wixPrice: 100 }, { id: 'v-a2', wixPrice: 150 }] },
      { id: 'prod-B', name: 'Product B', variants: [{ id: 'v-b1', wixPrice: 50 }] },
    ];
    const pendingByProduct = new Map(); // pid -> resolve fn, held open until both have arrived
    fetch.mockImplementation(baseFetchImpl({
      productsResponse: async () => ({ ok: true, json: async () => wixProductsPayload(products) }),
      onPricePatch: (url) => new Promise(resolve => {
        const pid = url.split('/products/')[1].split('/variants')[0];
        pendingByProduct.set(pid, resolve);
      }),
    }));
    listMock.mockResolvedValue([
      configRow({ pid: 'prod-A', vid: 'v-a1', productName: 'Product A', variantName: '1', price: 120 }),
      configRow({ pid: 'prod-A', vid: 'v-a2', productName: 'Product A', variantName: '2', price: 170 }),
      configRow({ pid: 'prod-B', vid: 'v-b1', productName: 'Product B', variantName: '1', price: 60 }),
    ]);

    const { runPush } = await import('../services/wixProductSync.js');
    const runPromise = runPush();

    // Both products' price PATCHes must land BEFORE either resolves — if the
    // queue serialized across products, prod-B's call would not arrive until
    // prod-A's promise had already been resolved.
    await vi.waitFor(() => {
      expect(pendingByProduct.has('prod-A')).toBe(true);
      expect(pendingByProduct.has('prod-B')).toBe(true);
    });

    pendingByProduct.get('prod-A')({ ok: true, json: async () => ({}) });
    pendingByProduct.get('prod-B')({ ok: true, json: async () => ({}) });

    const stats = await runPromise;
    expect(stats.pricesSynced).toBe(3);
    expect(stats.errors).toEqual([]);
    expect(priceCallsFor('prod-A')).toHaveLength(1);
    expect(priceCallsFor('prod-B')).toHaveLength(1);
  });

  it('reports a per-product API error in stats.errors without aborting other products', async () => {
    const products = [
      { id: 'prod-A', name: 'Product A', variants: [{ id: 'v-a1', wixPrice: 100 }] },
      { id: 'prod-B', name: 'Product B', variants: [{ id: 'v-b1', wixPrice: 50 }, { id: 'v-b2', wixPrice: 75 }] },
    ];
    fetch.mockImplementation(baseFetchImpl({
      productsResponse: async () => ({ ok: true, json: async () => wixProductsPayload(products) }),
      onPricePatch: async (url) => {
        if (url.includes('prod-B')) {
          return { ok: false, status: 400, text: async () => 'INVALID_PRICE' };
        }
        return { ok: true, json: async () => ({}) };
      },
    }));
    listMock.mockResolvedValue([
      configRow({ pid: 'prod-A', vid: 'v-a1', productName: 'Product A', variantName: '1', price: 120 }),
      configRow({ pid: 'prod-B', vid: 'v-b1', productName: 'Product B', variantName: '1', price: 60 }),
      configRow({ pid: 'prod-B', vid: 'v-b2', productName: 'Product B', variantName: '2', price: 85 }),
    ]);

    const { runPush } = await import('../services/wixProductSync.js');
    const stats = await runPush();

    // prod-A succeeded despite prod-B's failure — the batch queue did not abort.
    expect(stats.pricesSynced).toBe(1);
    expect(priceCallsFor('prod-A')).toHaveLength(1);

    // prod-B's failure is captured per-item (one line per affected row) —
    // sync_log stays truthful about which rows failed, not just a job-level flag.
    expect(stats.errors).toHaveLength(2);
    expect(stats.errors.every(e => e.includes('prod-B'))).toBe(true);
    expect(stats.errors.some(e => e.includes('INVALID_PRICE'))).toBe(true);

    // Still exactly ONE PATCH attempt for prod-B — batched, not one per variant,
    // even on the failure path.
    expect(priceCallsFor('prod-B')).toHaveLength(1);

    // Errors are still surfaced to the owner via Telegram (pre-existing behavior,
    // unchanged by this fix).
    expect(notifyWixSyncErrorMock).toHaveBeenCalled();
  });
});
