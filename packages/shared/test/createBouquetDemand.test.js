import { describe, it, expect, vi } from 'vitest';
import { createBouquetDemand } from '../utils/createBouquetDemand.js';

function apiMock({ patchData, postData } = {}) {
  return {
    patch: vi.fn().mockResolvedValue({ data: patchData ?? {} }),
    post:  vi.fn().mockResolvedValue({ data: postData ?? { id: 'new-1', 'Display Name': 'X' } }),
  };
}

describe('createBouquetDemand', () => {
  it('reuses an existing out-of-stock Variety and PATCHes the entered price', async () => {
    const existing = {
      id: 'de-1', 'Display Name': 'Peony White',
      'Current Cost Price': 4, 'Current Sell Price': 8, 'Current Quantity': 0,
    };
    const apiClient = apiMock({ patchData: { ...existing, 'Current Sell Price': 30, 'Current Cost Price': 15 } });

    const { stockItem, line } = await createBouquetDemand({
      apiClient, stockItems: [existing], displayName: 'Peony White',
      costPrice: 15, sellPrice: 30, quantity: 2,
    });

    expect(apiClient.post).not.toHaveBeenCalled(); // no duplicate stock item
    expect(apiClient.patch).toHaveBeenCalledWith('/stock/de-1', {
      'Current Sell Price': 30, 'Current Cost Price': 15,
    });
    expect(stockItem['Current Sell Price']).toBe(30);
    expect(line).toMatchObject({
      stockItemId: 'de-1', flowerName: 'Peony White',
      quantity: 2, sellPricePerUnit: 30, costPricePerUnit: 15,
    });
  });

  it('reuses an existing Variety WITHOUT a price: no PATCH, keeps its stored price', async () => {
    const existing = {
      id: 'de-1', 'Display Name': 'Peony White',
      'Current Cost Price': 4, 'Current Sell Price': 8, 'Current Quantity': 0,
    };
    const apiClient = apiMock();

    const { line } = await createBouquetDemand({
      apiClient, stockItems: [existing], displayName: 'Peony White',
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(line).toMatchObject({ stockItemId: 'de-1', sellPricePerUnit: 8, costPricePerUnit: 4 });
  });

  it('prefers the undated Demand Entry over dated batches when reusing', async () => {
    const stockItems = [
      { id: 'batch-1', 'Display Name': 'Rose Red (11.Jul.)', 'Current Quantity': 4, 'Current Sell Price': 60 },
      { id: 'de-1',    'Display Name': 'Rose Red',           'Current Quantity': -3, 'Current Sell Price': 55 },
    ];
    const apiClient = apiMock({ patchData: {} });

    const { line } = await createBouquetDemand({
      apiClient, stockItems, displayName: 'Rose Red', sellPrice: 70,
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/stock/de-1', { 'Current Sell Price': 70 });
    expect(line.stockItemId).toBe('de-1');
    expect(line.sellPricePerUnit).toBe(70);
  });

  // ── No undated Demand Entry (only dated Batches) — Y-model alignment ──────
  // Per ADR-0005/0006 the Demand Entry is the undated aggregate-demand row.
  // When a Variety has only dated Batches, create a fresh Demand Entry
  // (inheriting price from the most-recently-restocked Batch) — never PATCH
  // a Batch's price (a Batch is a dated, physical receipt).

  it('when only dated Batches exist: creates a fresh Demand Entry inheriting price from the most recent Batch, never patches a Batch', async () => {
    const stockItems = [
      { id: 'batch-1', 'Display Name': 'Rose Red (11.Jul.)', 'Current Quantity': 4, 'Current Sell Price': 60, 'Current Cost Price': 20, 'Last Restocked': '2026-07-01' },
      { id: 'batch-2', 'Display Name': 'Rose Red (20.Jun.)', 'Current Quantity': 0, 'Current Sell Price': 55, 'Current Cost Price': 18, 'Last Restocked': '2026-06-20' },
    ];
    const apiClient = apiMock({ postData: { id: 'de-new', 'Display Name': 'Rose Red' } });

    const { stockItem, line } = await createBouquetDemand({
      apiClient, stockItems, displayName: 'Rose Red',
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/stock', expect.objectContaining({
      displayName: 'Rose Red', quantity: 0,
      costPrice: 20, sellPrice: 60, // inherited from the most-recently-restocked batch (batch-1)
    }));
    expect(stockItem.id).toBe('de-new');
    expect(line).toMatchObject({ stockItemId: 'de-new', sellPricePerUnit: 60, costPricePerUnit: 20 });
  });

  it('when only dated Batches exist AND a price is entered: creates a fresh Demand Entry at the entered price (not inherited)', async () => {
    const stockItems = [
      { id: 'batch-1', 'Display Name': 'Tulip Yellow (01.Jul.)', 'Current Quantity': 3, 'Current Sell Price': 12, 'Current Cost Price': 5, 'Last Restocked': '2026-07-01' },
    ];
    const apiClient = apiMock({ postData: { id: 'de-new2', 'Display Name': 'Tulip Yellow' } });

    await createBouquetDemand({
      apiClient, stockItems, displayName: 'Tulip Yellow', costPrice: 6, sellPrice: 15,
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/stock', expect.objectContaining({
      costPrice: 6, sellPrice: 15,
    }));
  });

  it('creates a brand-new Variety (qty 0) with its price when none exists', async () => {
    const apiClient = apiMock({ postData: { id: 'new-9', 'Display Name': 'Ranunculus Peach' } });

    const { stockItem, line } = await createBouquetDemand({
      apiClient, stockItems: [], displayName: 'Ranunculus Peach',
      variety: { type_name: 'Ranunculus', colour: 'Peach' },
      costPrice: 6, sellPrice: 18, quantity: 3,
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/stock', expect.objectContaining({
      displayName: 'Ranunculus Peach', typeName: 'Ranunculus', colour: 'Peach',
      costPrice: 6, sellPrice: 18, quantity: 0,
    }));
    expect(stockItem.id).toBe('new-9');
    expect(line).toMatchObject({ stockItemId: 'new-9', quantity: 3, sellPricePerUnit: 18, costPricePerUnit: 6 });
  });

  it('falls back typeName to the display name for a brand-new flower (pitfall #9)', async () => {
    const apiClient = apiMock({ postData: { id: 'n', 'Display Name': 'Mystery' } });
    await createBouquetDemand({ apiClient, stockItems: [], displayName: 'Mystery' });
    expect(apiClient.post.mock.calls[0][1].typeName).toBe('Mystery');
  });

  it('passes supplier + lotSize through only for a brand-new flower, omitting blanks', async () => {
    const apiClient = apiMock({ postData: { id: 'n2', 'Display Name': 'Iris Blue' } });
    await createBouquetDemand({
      apiClient, stockItems: [], displayName: 'Iris Blue',
      supplier: 'Stefan', lotSize: 25,
    });
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ supplier: 'Stefan', lotSize: 25 });

    const apiClient2 = apiMock({ postData: { id: 'n3', 'Display Name': 'Iris Blue' } });
    await createBouquetDemand({ apiClient: apiClient2, stockItems: [], displayName: 'Iris Blue', supplier: '', lotSize: 0 });
    expect(apiClient2.post.mock.calls[0][1]).not.toHaveProperty('supplier');
    expect(apiClient2.post.mock.calls[0][1]).not.toHaveProperty('lotSize');
  });

  // ── lotSize standardization ────────────────────────────────────────────
  // Decision: include lotSize in the POST only when Number(lotSize) > 0,
  // else omit (the backend defaults it). Previously the florist wizard used
  // `> 1` (excluding lotSize=1); this locks the standardized `> 0` rule.
  it('lotSize standardization: included when > 0 (even lotSize=1), omitted when <= 0', async () => {
    const apiClient = apiMock({ postData: { id: 'n4', 'Display Name': 'Peony' } });
    await createBouquetDemand({ apiClient, stockItems: [], displayName: 'Peony', lotSize: 1 });
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ lotSize: 1 });

    const apiClient2 = apiMock({ postData: { id: 'n5', 'Display Name': 'Peony' } });
    await createBouquetDemand({ apiClient: apiClient2, stockItems: [], displayName: 'Peony', lotSize: -3 });
    expect(apiClient2.post.mock.calls[0][1]).not.toHaveProperty('lotSize');

    const apiClient3 = apiMock({ postData: { id: 'n6', 'Display Name': 'Peony' } });
    await createBouquetDemand({ apiClient: apiClient3, stockItems: [], displayName: 'Peony', lotSize: '' });
    expect(apiClient3.post.mock.calls[0][1]).not.toHaveProperty('lotSize');
  });

  it('still returns a line at the entered price if the PATCH fails', async () => {
    const existing = { id: 'de-1', 'Display Name': 'Tulip', 'Current Quantity': 0, 'Current Sell Price': 5 };
    const apiClient = {
      patch: vi.fn().mockRejectedValue(new Error('network')),
      post:  vi.fn(),
    };
    const { line } = await createBouquetDemand({
      apiClient, stockItems: [existing], displayName: 'Tulip', sellPrice: 40,
    });
    expect(line.sellPricePerUnit).toBe(40);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('throws when displayName is blank', async () => {
    await expect(createBouquetDemand({ apiClient: apiMock(), displayName: '   ' }))
      .rejects.toThrow(/displayName/);
  });

  // ── varietyDraft convention (useOrderEditing back-compat) ──────────────
  // useOrderEditing.createDemandEntry delegates straight through with its
  // pre-consolidation call shape: a plain string omits the 4-tuple entirely;
  // an object only sends the 4-tuple keys actually present on the draft (no
  // fallback defaulting) — distinct from the `variety` convention above,
  // which always fills all 4 keys with pitfall-#9 fallback.
  describe('varietyDraft convention', () => {
    it('string draft: creates with quantity/cost/sell only, no 4-tuple fields', async () => {
      const apiClient = apiMock({ postData: { id: 'vd-1', 'Display Name': 'Rose' } });
      await createBouquetDemand({ apiClient, stockItems: [], varietyDraft: 'Rose' });
      expect(apiClient.post).toHaveBeenCalledWith('/stock', {
        displayName: 'Rose', quantity: 0, costPrice: 0, sellPrice: 0,
      });
    });

    it('object draft: auto-computes displayName via varietyDisplayName when no baseName given', async () => {
      const apiClient = apiMock({ postData: { id: 'vd-2', 'Display Name': 'Rose Pink 60cm' } });
      await createBouquetDemand({
        apiClient, stockItems: [],
        varietyDraft: { type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null },
      });
      expect(apiClient.post).toHaveBeenCalledWith('/stock', {
        displayName: 'Rose Pink 60cm', typeName: 'Rose', colour: 'Pink', sizeCm: 60, cultivar: null,
        quantity: 0, costPrice: 0, sellPrice: 0,
      });
    });

    it('object draft: baseName wins over auto-computed name; only present tuple keys are sent', async () => {
      const apiClient = apiMock({ postData: { id: 'vd-3', 'Display Name': 'My Rose' } });
      await createBouquetDemand({
        apiClient, stockItems: [],
        varietyDraft: { baseName: 'My Rose', type_name: 'Rose' },
      });
      const body = apiClient.post.mock.calls[0][1];
      expect(body.displayName).toBe('My Rose');
      expect(body.typeName).toBe('Rose');
      expect(body).not.toHaveProperty('colour');
      expect(body).not.toHaveProperty('sizeCm');
      expect(body).not.toHaveProperty('cultivar');
    });

    it('object draft: reuses an existing undated Demand Entry the same way as the string/variety conventions', async () => {
      const existingEntry = { id: 'de-x', 'Display Name': 'Rose', 'Current Cost Price': 5, 'Current Sell Price': 10, 'Current Quantity': -3 };
      const patch = vi.fn().mockResolvedValue({ data: { ...existingEntry, 'Current Sell Price': 25 } });
      const apiClient = { patch, post: vi.fn() };
      const { line } = await createBouquetDemand({
        apiClient, stockItems: [existingEntry],
        varietyDraft: { type_name: 'Rose' }, sellPrice: 25,
      });
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(patch).toHaveBeenCalledWith('/stock/de-x', { 'Current Sell Price': 25 });
      expect(line.stockItemId).toBe('de-x');
    });
  });
});

// ── #605: identity-resolved reuse + the confirmed-create escape hatch ──
//
// The base-name lookup this util has always used matches on NAME. That misses a
// card whose name drifted from its Variety (the #558 shape) and cannot see a
// case difference the server WOULD match on. `resolvedStockItem` lets the caller
// hand over a card it resolved by identity, so the flower the user was shown and
// the record actually written can never disagree.
describe('createBouquetDemand — resolvedStockItem / newVariety (#605)', () => {
  const RENAMED_CARD = {
    id: 'de-renamed', 'Display Name': 'Пион Розовый 60cm',
    Type: 'Peony', Colour: 'Pink', Size: 60,
    'Current Cost Price': 4, 'Current Sell Price': 12, 'Current Quantity': 0,
  };

  it('reuses a resolved card the name lookup would never have found', async () => {
    const patch = vi.fn().mockResolvedValue({ data: { ...RENAMED_CARD, 'Current Sell Price': 20 } });
    const apiClient = { patch, post: vi.fn() };

    const { line } = await createBouquetDemand({
      apiClient,
      stockItems: [RENAMED_CARD],
      displayName: 'Peony Pink 60cm',   // does NOT equal the card's name
      resolvedStockItem: RENAMED_CARD,
      sellPrice: 20,
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith('/stock/de-renamed', { 'Current Sell Price': 20 });
    expect(line.stockItemId).toBe('de-renamed');
    expect(line.flowerName).toBe('Пион Розовый 60cm'); // the card's name, not the typed one
  });

  it('ignores a resolved DATED batch and creates the undated Demand Entry instead', async () => {
    const batch = { ...RENAMED_CARD, id: 'batch-1', 'Display Name': 'Peony Pink 60cm (24.Jul.)' };
    const apiClient = {
      patch: vi.fn(),
      post: vi.fn().mockResolvedValue({ data: { id: 'de-new', 'Display Name': 'Peony Pink 60cm' } }),
    };

    await createBouquetDemand({
      apiClient, stockItems: [batch], displayName: 'Peony Pink 60cm',
      resolvedStockItem: batch, variety: { type_name: 'Peony', colour: 'Pink', size_cm: 60 },
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('sends newVariety only when explicitly confirmed', async () => {
    const post = vi.fn().mockResolvedValue({ data: { id: 'de-new', 'Display Name': 'Ranunculus Peach' } });
    await createBouquetDemand({
      apiClient: { patch: vi.fn(), post }, stockItems: [],
      displayName: 'Ranunculus Peach',
      variety: { type_name: 'Ranunculus', colour: 'Peach' },
      newVariety: true,
    });
    expect(post.mock.calls[0][1].newVariety).toBe(true);
  });

  it('back-compat: without either param the POST body is byte-identical to before', async () => {
    const post = vi.fn().mockResolvedValue({ data: { id: 'de-new', 'Display Name': 'Ranunculus Peach' } });
    await createBouquetDemand({
      apiClient: { patch: vi.fn(), post }, stockItems: [],
      displayName: 'Ranunculus Peach',
      variety: { type_name: 'Ranunculus', colour: 'Peach' },
      costPrice: 7, sellPrice: 21,
    });
    // Whole-object assertion, not toMatchObject — a stray key must fail here.
    expect(post.mock.calls[0][1]).toEqual({
      displayName: 'Ranunculus Peach',
      quantity: 0,
      costPrice: 7,
      sellPrice: 21,
      typeName: 'Ranunculus',
      colour: 'Peach',
      sizeCm: null,
      cultivar: null,
    });
    expect(post.mock.calls[0][1]).not.toHaveProperty('newVariety');
  });

  it('newVariety: false is not sent — only an explicit true opts out of the server guard', async () => {
    const post = vi.fn().mockResolvedValue({ data: { id: 'de-new', 'Display Name': 'X' } });
    await createBouquetDemand({
      apiClient: { patch: vi.fn(), post }, stockItems: [],
      displayName: 'X', variety: { type_name: 'X' }, newVariety: false,
    });
    expect(post.mock.calls[0][1]).not.toHaveProperty('newVariety');
  });
});
