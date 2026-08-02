import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression suite for the Pull price-clobber guard (#428 follow-up to #572).
//
// The bug this locks down: runPull's price step used to mirror whatever price
// Wix currently reported straight over `product_config.price`, unconditionally,
// on EVERY Pull. There was no equivalent of `localNameOwned` (ADR-0008), which
// protects Product Name from exactly this. So a Pull taken before Wix reflected
// a Push — because the Push silently lost the write (the #572 race), or Wix's
// read path simply lagged — re-stamped the stale Wix price over the owner's
// edit and destroyed the local record of what she had asked for. Same
// owner-visible symptom as #428 ("I set it, it says success, it's still
// wrong"), reached through a completely different mechanism.
//
// The fix (ADR-0020) is value-based, NOT time-based: `Wix Price Seen` records
// the price Wix reported at the previous Pull, and the mirror only fires when
// Wix's own price MOVED since then. Prod sync_log showed push→clobber gaps of
// 49 seconds to 10.4 hours across 7 occurrences (2026-06-23 → 2026-07-22), so
// no cooldown window separates "stale echo of our Push" from "genuine Wix
// edit" — only "did Wix's value actually change" does.

const upsertMock = vi.fn();
const listMock = vi.fn();
const softDeleteMock = vi.fn();
const deactivateMock = vi.fn();
const logSyncMock = vi.fn();

vi.mock('../repos/productConfigRepo.js', () => ({
  list: (...a) => listMock(...a),
  upsert: (...a) => upsertMock(...a),
  softDelete: (...a) => softDeleteMock(...a),
  deactivate: (...a) => deactivateMock(...a),
}));
vi.mock('../repos/syncLogRepo.js', () => ({ logSync: (...a) => logSyncMock(...a) }));
vi.mock('../repos/stockRepo.js', () => ({ list: vi.fn(async () => []) }));
vi.mock('../services/telegram.js', () => ({ sendAlert: vi.fn(), notifyWixSyncError: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getConfig: () => ({}),
  updateConfig: vi.fn(),
  getActiveSeasonalSlots: () => [],
  getActiveSeasonalCategory: () => null,
}));

// One managed-variant product. `price` here is what WIX reports — the mirror
// source. Nested under `variant.priceData` to match the real
// /stores/v1/products/query envelope (same nesting as `variant.visible`).
function hydrangeasPayload(variantPrices) {
  return {
    products: [
      {
        id: 'p-hyd',
        name: 'White Hydrangeas',
        visible: true,
        variants: variantPrices.map(({ id, price }) => ({
          id,
          choices: { Bouquet: id },
          variant: { visible: true, priceData: { price } },
        })),
      },
    ],
  };
}

/** The wire shape productConfigRepo.list() returns for an existing row. */
function row(fields) {
  return {
    id: `r-${fields['Wix Variant ID']}`,
    'Wix Product ID': 'p-hyd',
    'Product Name': 'White Hydrangeas',
    'Variant Name': fields['Wix Variant ID'],
    Active: true,
    'Visible in Wix': true,
    // Must match the fixture product's (absent) media, or every row picks up a
    // spurious `Image URL: ''` update and the stats assertions drift.
    'Image URL': '',
    ...fields,
  };
}

/**
 * Collect the upsert payload runPull wrote for one variant, if any.
 * The update path keys by camelCase (`wixVariantId`); the create path passes
 * the Airtable-shaped row through verbatim — accept either.
 */
function upsertFor(variantId) {
  return upsertMock.mock.calls
    .map(([f]) => f)
    .find(f => f.wixVariantId === variantId || f['Wix Variant ID'] === variantId);
}

describe('runPull — price mirror guard (#428)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
    upsertMock.mockReset().mockResolvedValue({});
    softDeleteMock.mockReset().mockResolvedValue({});
    deactivateMock.mockReset().mockResolvedValue({});
    logSyncMock.mockReset().mockResolvedValue({});
    listMock.mockReset();
  });

  /** Point the Wix products query at a given per-variant price set. */
  function wixReports(variantPrices) {
    fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/stores/v1/products/query')) {
        return { ok: true, json: async () => hydrangeasPayload(variantPrices) };
      }
      return { ok: true, json: async () => ({ collections: [] }) };
    });
  }

  it('does NOT overwrite a locally-set price when Wix has not moved since the last Pull', async () => {
    // Owner set 70 in the Dashboard and Pushed. The Push did not land (or Wix
    // is still serving the old read), so Wix still says 65 — exactly what the
    // previous Pull recorded. Nothing changed on Wix, so there is nothing to
    // mirror, and the local 70 must survive.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': 65 }),
    ]);
    wixReports([{ id: 'v1', price: 65 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    const written = upsertFor('v1');
    expect(written?.['Price']).toBeUndefined();   // the clobber that used to happen
    expect(stats.pricesNotOnWix).toBe(1);          // surfaced instead of silent
  });

  it('DOES mirror a genuine Wix-side price change', async () => {
    // Nobody edited locally; the price changed in the Wix admin from 65 to 90.
    // Wix moved since the last Pull, so this is real news — import it.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 65, 'Wix Price Seen': 65 }),
    ]);
    wixReports([{ id: 'v1', price: 90 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    const written = upsertFor('v1');
    expect(written['Price']).toBe(90);
    expect(written['Wix Price Seen']).toBe(90);   // baseline advances with it
    expect(stats.pricesNotOnWix).toBe(0);
  });

  it('advances the baseline once a Push lands, without touching the price', async () => {
    // Owner set 70, Pushed, and this time Wix took it. Wix moved (65 → 70) and
    // now agrees with local, so only the baseline needs updating.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': 65 }),
    ]);
    wixReports([{ id: 'v1', price: 70 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    const written = upsertFor('v1');
    expect(written['Wix Price Seen']).toBe(70);
    expect(written['Price']).toBeUndefined();      // already equal — no write
    expect(stats.pricesNotOnWix).toBe(0);
    // Bookkeeping-only writes must not inflate the owner-facing counter,
    // otherwise the first Pull after this ships reports every row as updated.
    expect(stats.updated).toBe(0);
  });

  it('seeds a baseline without mirroring when a row has none yet (existing prod rows)', async () => {
    // Every row on prod starts with wix_price_seen = NULL. With no baseline we
    // cannot tell a Wix edit from an echo of our own Push, so the safe move is
    // to record the observation and leave the local price alone. That is why
    // the migration ships with no data backfill.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': null }),
    ]);
    wixReports([{ id: 'v1', price: 65 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    const written = upsertFor('v1');
    expect(written['Wix Price Seen']).toBe(65);
    expect(written['Price']).toBeUndefined();
    expect(stats.pricesNotOnWix).toBe(1);
  });

  it('seeds the baseline on a brand-new row imported from Wix', async () => {
    listMock.mockResolvedValue([]);
    wixReports([{ id: 'v1', price: 65 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    const created = upsertFor('v1');
    expect(created['Price']).toBe(65);
    expect(created['Wix Price Seen']).toBe(65);
    expect(stats.new).toBe(1);
  });

  it('replays the 2026-06-23 incident: a whole batch of re-priced variants survives the Pull', async () => {
    // sync_log, 2026-06-23: push 12:52:37 reported 15 prices synced; the Pull
    // 49 seconds later rewrote exactly 15 rows. Same shape here with 3 variants
    // of one product — every one re-priced locally, none of it live on Wix yet.
    // Pre-fix, all three local prices were reverted to the Wix values.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': 65 }),
      row({ 'Wix Variant ID': 'v2', Price: 140, 'Wix Price Seen': 130 }),
      row({ 'Wix Variant ID': 'v3', Price: 210, 'Wix Price Seen': 195 }),
    ]);
    wixReports([
      { id: 'v1', price: 65 },
      { id: 'v2', price: 130 },
      { id: 'v3', price: 195 },
    ]);

    const { runPull } = await import('../services/wixProductSync.js');
    const stats = await runPull();

    for (const vid of ['v1', 'v2', 'v3']) {
      expect(upsertFor(vid)?.['Price']).toBeUndefined();
    }
    expect(stats.pricesNotOnWix).toBe(3);
  });

  it('reports the unconfirmed count to sync_log', async () => {
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': 65 }),
    ]);
    wixReports([{ id: 'v1', price: 65 }]);

    const { runPull } = await import('../services/wixProductSync.js');
    await runPull();

    expect(logSyncMock).toHaveBeenCalledTimes(1);
    expect(logSyncMock.mock.calls[0][0]).toMatchObject({
      status: 'success (pull)',
      pricesNotOnWix: 1,
    });
  });

  it('leaves the non-price mirrors alone', async () => {
    // The guard is price-only: a Wix-side deactivation must still land even
    // while the price mirror is being withheld for the same row.
    listMock.mockResolvedValue([
      row({ 'Wix Variant ID': 'v1', Price: 70, 'Wix Price Seen': 65, Active: true }),
    ]);
    fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/stores/v1/products/query')) {
        return {
          ok: true,
          json: async () => ({
            products: [{
              id: 'p-hyd',
              name: 'White Hydrangeas',
              visible: true,
              variants: [{
                id: 'v1',
                choices: { Bouquet: '1' },
                variant: { visible: false, priceData: { price: 65 } },
              }],
            }],
          }),
        };
      }
      return { ok: true, json: async () => ({ collections: [] }) };
    });

    const { runPull } = await import('../services/wixProductSync.js');
    await runPull();

    const written = upsertFor('v1');
    expect(written['Active']).toBe(false);        // visibility still mirrors
    expect(written['Price']).toBeUndefined();     // price still protected
  });
});
