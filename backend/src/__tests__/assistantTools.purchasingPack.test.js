import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockPoList, mockPurchList } = vi.hoisted(() => ({ mockPoList: vi.fn(), mockPurchList: vi.fn() }));
vi.mock('../repos/stockOrderRepo.js', () => ({ list: mockPoList }));
vi.mock('../repos/stockPurchasesRepo.js', () => ({ list: mockPurchList }));
import { poStatusHandler, purchaseSpendHandler } from '../services/assistantTools/purchasingPack.js';
beforeEach(() => vi.clearAllMocks());

describe('purchasingPack.po_status', () => {
  it('counts by status + open vs complete', async () => {
    mockPoList.mockResolvedValueOnce([
      { id: 'a', Status: 'Complete', 'Stock Order ID': 'PO-1', 'Created Date': '2026-05-01' },
      { id: 'b', Status: 'Sent', 'Stock Order ID': 'PO-2', 'Created Date': '2026-05-02' },
      { id: 'c', Status: 'Draft', 'Stock Order ID': 'PO-3', 'Created Date': '2026-05-03' },
    ]);
    const r = await poStatusHandler({});
    expect(r.matchedCount).toBe(3);
    expect(r.complete).toBe(1);
    expect(r.open).toBe(2);
    expect(r.byStatus).toEqual({ Complete: 1, Sent: 1, Draft: 1 });
    expect(mockPoList).toHaveBeenCalledWith({});
  });
  it('passes a status filter through', async () => {
    mockPoList.mockResolvedValueOnce([]);
    await poStatusHandler({ status: 'Complete' });
    expect(mockPoList).toHaveBeenCalledWith({ status: 'Complete' });
  });
});

describe('purchasingPack.purchase_spend', () => {
  it('sums total + by supplier (rounded)', async () => {
    mockPurchList.mockResolvedValueOnce([
      { Supplier: 'A', 'Price Per Unit': 2, 'Quantity Purchased': 10 },
      { Supplier: 'A', 'Price Per Unit': 1.5, 'Quantity Purchased': 4 },
      { Supplier: 'B', 'Price Per Unit': 3, 'Quantity Purchased': 5 },
    ]);
    const r = await purchaseSpendHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.purchaseCount).toBe(3);
    expect(r.totalSpend).toBe(41);
    expect(r.bySupplier).toEqual({ A: 26, B: 15 });
    expect(r.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(mockPurchList).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
  });
});
