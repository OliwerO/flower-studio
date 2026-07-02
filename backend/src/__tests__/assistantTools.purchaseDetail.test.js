import { describe, it, expect, vi } from 'vitest';

vi.mock('../repos/stockPurchasesRepo.js', () => ({
  list: vi.fn().mockResolvedValue([
    {
      'Purchase Date': '2026-07-01',
      Supplier: 'Stefan',
      Flower: ['stock-1'],
      'Quantity Purchased': 20,
      'Quantity Accepted': 17,
      'Price Per Unit': 5,
      Notes: 'PO #PO-20260701-1 L#abc primary',
    },
    {
      'Purchase Date': '2026-07-02',
      Supplier: 'Stefan',
      Flower: ['stock-1'],
      'Quantity Purchased': 10,
      'Quantity Accepted': null, // legacy row, pre-#492
      'Price Per Unit': 4,
      Notes: 'PO #PO-20260702-1 L#def primary',
    },
  ]),
}));
vi.mock('../repos/stockRepo.js', () => ({
  listByIds: vi.fn().mockResolvedValue([{ id: 'stock-1', 'Display Name': 'Ranunculus' }]),
}));

import { purchaseDetailHandler } from '../services/assistantTools/purchaseDetailPack.js';

describe('purchase_detail — Found vs Accepted (#492)', () => {
  it('reports amount against Found (quantityPurchased) and surfaces Accepted + writtenOff', async () => {
    const result = await purchaseDetailHandler({ supplier: 'Stefan' });

    expect(result.totalSpend).toBe(20 * 5 + 10 * 4); // 140 — Found-based, not Accepted-based

    const [t1, t2] = result.transactions;
    expect(t1.qty).toBe(20);
    expect(t1.quantityAccepted).toBe(17);
    expect(t1.writtenOff).toBe(3);
    expect(t1.amount).toBe(100);

    expect(t2.qty).toBe(10);
    expect(t2.quantityAccepted).toBe(null);
    expect(t2.writtenOff).toBe(null); // can't derive writtenOff without a known Accepted value
  });
});
