import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockListDeliveries } = vi.hoisted(() => ({ mockListDeliveries: vi.fn() }));
vi.mock('../repos/orderRepo.js', () => ({ listDeliveries: mockListDeliveries }));
import { deliveryStatusHandler } from '../services/assistantTools/deliveriesPack.js';
beforeEach(() => vi.clearAllMocks());

describe('deliveriesPack.delivery_status', () => {
  it('aggregates counts by status and driver', async () => {
    mockListDeliveries.mockResolvedValueOnce([
      { id: '1', Status: 'Delivered', 'Assigned Driver': 'Nikita', 'Delivery Date': '2026-05-02' },
      { id: '2', Status: 'Delivered', 'Assigned Driver': 'Timur', 'Delivery Date': '2026-05-03' },
      { id: '3', Status: 'Out for Delivery', 'Assigned Driver': 'Nikita', 'Delivery Date': '2026-05-04' },
    ]);
    const r = await deliveryStatusHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.matchedCount).toBe(3);
    expect(r.byStatus).toEqual({ Delivered: 2, 'Out for Delivery': 1 });
    expect(r.byDriver).toEqual({ Nikita: 2, Timur: 1 });
    expect(r.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(mockListDeliveries).toHaveBeenCalledWith({ pg: { from: '2026-05-01', to: '2026-05-31', status: undefined, driver: undefined } });
  });
  it('caps the data list and flags truncated', async () => {
    mockListDeliveries.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => ({ id: String(i), Status: 'Pending', 'Assigned Driver': 'X', 'Delivery Date': '2026-05-01' })));
    const r = await deliveryStatusHandler({});
    expect(r.matchedCount).toBe(30);
    expect(r.shown).toBe(25);
    expect(r.truncated).toBe(true);
  });
  it('counts null status/driver as Unknown/Unassigned', async () => {
    mockListDeliveries.mockResolvedValueOnce([{ id: '1', Status: null, 'Assigned Driver': null }]);
    const r = await deliveryStatusHandler({});
    expect(r.byStatus).toEqual({ Unknown: 1 });
    expect(r.byDriver).toEqual({ Unassigned: 1 });
  });
});
