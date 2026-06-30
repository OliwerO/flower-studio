import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock('../repos/marketingSpendRepo.js', () => ({ list: mockList }));

import { marketingSpendHandler } from '../services/assistantTools/marketingPack.js';

beforeEach(() => vi.clearAllMocks());

describe('marketingPack.marketing_spend', () => {
  it('sums total, groups by channel sorted desc, returns rowCount', async () => {
    mockList.mockResolvedValueOnce([
      { id: '1', Month: '2026-05', Channel: 'Instagram', Amount: 300, Notes: '' },
      { id: '2', Month: '2026-05', Channel: 'Google',    Amount: 150, Notes: '' },
      { id: '3', Month: '2026-05', Channel: 'Instagram', Amount: 200, Notes: '' },
    ]);

    const r = await marketingSpendHandler({ from: '2026-05', to: '2026-05' });

    expect(r.totalSpend).toBe(650);
    expect(r.rowCount).toBe(3);
    // Instagram (500) should come before Google (150)
    expect(r.byChannel).toEqual([
      { channel: 'Instagram', amount: 500 },
      { channel: 'Google',    amount: 150 },
    ]);
    expect(r.period).toEqual({ from: '2026-05', to: '2026-05' });
    expect(mockList).toHaveBeenCalledWith({ from: '2026-05', to: '2026-05' });
  });

  it('returns zeros and empty byChannel when no rows', async () => {
    mockList.mockResolvedValueOnce([]);

    const r = await marketingSpendHandler({ from: '2026-01', to: '2026-01' });

    expect(r.totalSpend).toBe(0);
    expect(r.byChannel).toEqual([]);
    expect(r.rowCount).toBe(0);
    expect(r.period).toEqual({ from: '2026-01', to: '2026-01' });
  });

  it('passes from/to through to repo unchanged', async () => {
    mockList.mockResolvedValueOnce([]);

    await marketingSpendHandler({ from: '2026-03', to: '2026-06' });

    expect(mockList).toHaveBeenCalledWith({ from: '2026-03', to: '2026-06' });
  });

  it('period fields are null when from/to are omitted', async () => {
    mockList.mockResolvedValueOnce([]);

    const r = await marketingSpendHandler({});

    expect(r.period).toEqual({ from: null, to: null });
    expect(mockList).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });
});
