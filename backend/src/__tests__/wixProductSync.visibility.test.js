import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression suite for per-variant storefront availability (#florist-variants).
//
// Two bugs this locks down:
//   1. PUSH never told Wix which VARIANTS to hide — it only wrote inventory
//      (`inStock`/`quantity`), which paints a "sold out" badge but does not
//      remove a size from the storefront option picker. Deactivating a size
//      in the app therefore had no visible effect on the website.
//   2. PULL stamped the PRODUCT-level `visible` flag onto EVERY variant, so a
//      Pull silently reactivated variants the owner had hidden ("7/7 active"
//      after a Pull that should have been "5/7").
//
// The fix round-trips availability through Wix's per-variant `variant.visible`.

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('buildVariantVisibilityPayload', () => {
  it('maps each managed variant Active flag to a visible toggle', async () => {
    const { buildVariantVisibilityPayload } = await import('../services/wixProductSync.js');
    const payload = buildVariantVisibilityPayload([
      { variantId: 'v1', active: true },
      { variantId: 'v2', active: false },
      { variantId: 'v3', active: true },
    ]);
    expect(payload).toEqual({
      variants: [
        { variantIds: ['v1'], visible: true },
        { variantIds: ['v2'], visible: false },
        { variantIds: ['v3'], visible: true },
      ],
    });
  });

  it('excludes the synthetic ZERO_UUID default variant (simple products)', async () => {
    const { buildVariantVisibilityPayload } = await import('../services/wixProductSync.js');
    const payload = buildVariantVisibilityPayload([{ variantId: ZERO_UUID, active: false }]);
    expect(payload).toEqual({ variants: [] });
  });

  it('treats only strict true as visible (never coerces truthy values)', async () => {
    const { buildVariantVisibilityPayload } = await import('../services/wixProductSync.js');
    const payload = buildVariantVisibilityPayload([
      { variantId: 'v1', active: 1 },
      { variantId: 'v2', active: undefined },
    ]);
    expect(payload).toEqual({
      variants: [
        { variantIds: ['v1'], visible: false },
        { variantIds: ['v2'], visible: false },
      ],
    });
  });
});

describe('updateWixVariantVisibility (HTTP wiring)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
  });

  it('PATCHes /products/{id}/variants with the per-variant visible payload', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { updateWixVariantVisibility } = await import('../services/wixProductSync.js');
    await updateWixVariantVisibility('prod-1', [
      { variantId: 'v1', active: true },
      { variantId: 'v2', active: false },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://www.wixapis.com/stores/v1/products/prod-1/variants');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      variants: [
        { variantIds: ['v1'], visible: true },
        { variantIds: ['v2'], visible: false },
      ],
    });
  });

  it('is a no-op (no fetch) for a simple product with only the default variant', async () => {
    const { updateWixVariantVisibility } = await import('../services/wixProductSync.js');
    await updateWixVariantVisibility('prod-1', [{ variantId: ZERO_UUID, active: false }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws WixProductNotFoundError on 404 PRODUCT_NOT_FOUND (so the push can dedupe stale ids)', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'PRODUCT_NOT_FOUND' });
    const { updateWixVariantVisibility } = await import('../services/wixProductSync.js');
    await expect(
      updateWixVariantVisibility('gone', [{ variantId: 'v1', active: false }])
    ).rejects.toMatchObject({ name: 'WixProductNotFoundError', productId: 'gone' });
  });

  it('retries once on a transient 5xx then succeeds', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'upstream reset' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const { updateWixVariantVisibility } = await import('../services/wixProductSync.js');
    await updateWixVariantVisibility('prod-1', [{ variantId: 'v1', active: true }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ── Full round-trip: runPull maps per-variant visible → Active ──
//
// Mocks the data-access + config seams so we can drive a deterministic Wix
// payload through the real runPull loop and assert what it writes back.

const upsertMock = vi.fn();
const listMock = vi.fn();
const softDeleteMock = vi.fn();
const deactivateMock = vi.fn();

vi.mock('../repos/productConfigRepo.js', () => ({
  list: (...a) => listMock(...a),
  upsert: (...a) => upsertMock(...a),
  softDelete: (...a) => softDeleteMock(...a),
  deactivate: (...a) => deactivateMock(...a),
}));
vi.mock('../repos/syncLogRepo.js', () => ({ logSync: vi.fn() }));
vi.mock('../repos/stockRepo.js', () => ({ list: vi.fn(async () => []) }));
vi.mock('../services/telegram.js', () => ({ sendAlert: vi.fn(), notifyWixSyncError: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getConfig: () => ({}),
  updateConfig: vi.fn(),
  getActiveSeasonalSlots: () => [],
  getActiveSeasonalCategory: () => null,
}));

// One managed-variant product: size "S" visible, size "L" hidden on Wix.
//
// IMPORTANT: this mirrors the REAL `/stores/v1/products/query` response shape,
// verified live against the Wix catalog: per-variant `visible` is NESTED under
// `variant.variant.visible` (the same envelope as `priceData`), NOT a top-level
// `variant.visible`. An earlier version of this fixture put `visible` at the top
// level, which matched a buggy top-level read in runPull — both wrong, so the
// test passed while production still reset every variant to active on Pull.
// Keep `visible` nested here so this test guards the actual API contract.
function redRosesPayload() {
  return {
    products: [
      {
        id: 'p-red',
        name: 'Red roses',
        visible: true, // product-level: the whole product is shown
        variants: [
          { id: 'v-s', choices: { Rozmiar: 'S' }, variant: { visible: true, priceData: { price: 100 } } },
          { id: 'v-l', choices: { Rozmiar: 'L' }, variant: { visible: false, priceData: { price: 200 } } },
        ],
      },
    ],
  };
}

describe('runPull — per-variant availability', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
    upsertMock.mockReset().mockResolvedValue({});
    softDeleteMock.mockReset().mockResolvedValue({});
    deactivateMock.mockReset().mockResolvedValue({});
    listMock.mockReset();
    // fetch: products query returns Red roses; anything else (categories) → empty
    fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/stores/v1/products/query')) {
        return { ok: true, json: async () => redRosesPayload() };
      }
      return { ok: true, json: async () => ({ collections: [] }) };
    });
  });

  it('sets Active from each variant.visible, NOT the product-level flag', async () => {
    // Both rows already exist and are currently Active — the hidden variant
    // must be flipped to inactive by the Pull (the pre-fix bug kept it active).
    listMock.mockResolvedValue([
      { id: 'r1', 'Wix Product ID': 'p-red', 'Wix Variant ID': 'v-s', 'Product Name': 'Red roses', 'Active': true, 'Price': 100 },
      { id: 'r2', 'Wix Product ID': 'p-red', 'Wix Variant ID': 'v-l', 'Product Name': 'Red roses', 'Active': true, 'Price': 200 },
    ]);

    const { runPull } = await import('../services/wixProductSync.js');
    await runPull();

    const hiddenUpdate = upsertMock.mock.calls
      .map(([f]) => f)
      .find(f => f.wixVariantId === 'v-l');
    expect(hiddenUpdate).toBeTruthy();
    expect(hiddenUpdate['Active']).toBe(false);

    // The visible variant must NOT be deactivated — no Active:false update for it.
    const visibleUpdate = upsertMock.mock.calls
      .map(([f]) => f)
      .find(f => f.wixVariantId === 'v-s' && 'Active' in f);
    expect(visibleUpdate?.['Active']).not.toBe(false);
  });

  it('new rows inherit per-variant visibility on first import', async () => {
    listMock.mockResolvedValue([]); // nothing local yet → both are new rows

    const { runPull } = await import('../services/wixProductSync.js');
    await runPull();

    const rows = upsertMock.mock.calls.map(([f]) => f);
    const sRow = rows.find(f => f['Wix Variant ID'] === 'v-s');
    const lRow = rows.find(f => f['Wix Variant ID'] === 'v-l');
    expect(sRow['Active']).toBe(true);
    expect(lRow['Active']).toBe(false);
    // Product-level flag is tracked separately and stays true for both.
    expect(sRow['Visible in Wix']).toBe(true);
    expect(lRow['Visible in Wix']).toBe(true);
  });
});
