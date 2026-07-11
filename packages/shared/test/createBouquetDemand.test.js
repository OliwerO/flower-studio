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
});
