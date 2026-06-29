import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockHoursList, mockBuildPayroll, mockGetConfig } = vi.hoisted(() => ({
  mockHoursList: vi.fn(), mockBuildPayroll: vi.fn(), mockGetConfig: vi.fn(),
}));
vi.mock('../repos/hoursRepo.js', () => ({ list: mockHoursList }));
vi.mock('../services/floristHoursService.js', () => ({ buildPayroll: mockBuildPayroll }));
vi.mock('../services/configService.js', () => ({ getConfig: mockGetConfig }));
import { hoursSummaryHandler } from '../services/assistantTools/hoursPack.js';
beforeEach(() => vi.clearAllMocks());

describe('hoursPack.hours_summary', () => {
  it('groups buildPayroll days per florist + passes totals through', async () => {
    mockGetConfig.mockReturnValue({ Anna: 30 });
    mockHoursList.mockResolvedValueOnce([{ Name: 'Anna' }, { Name: 'Bob' }]); // opaque — buildPayroll is mocked
    mockBuildPayroll.mockReturnValue({
      days: [
        { name: 'Anna', hours: 8, earnings: 240, deliveryCount: 2 },
        { name: 'Anna', hours: 4, earnings: 130, deliveryCount: 0 },
        { name: 'Bob', hours: 6, earnings: 145, deliveryCount: 1 },
      ],
      totals: { hours: 18, earnings: 515, deliveries: 3, days: 3 },
    });
    const r = await hoursSummaryHandler({ from: '2026-05-01', to: '2026-05-31' });
    const anna = r.florists.find(f => f.name === 'Anna');
    const bob = r.florists.find(f => f.name === 'Bob');
    expect(anna).toMatchObject({ hours: 12, earnings: 370, deliveries: 2, days: 2 });
    expect(bob).toMatchObject({ hours: 6, earnings: 145, deliveries: 1, days: 1 });
    expect(r.totals).toMatchObject({ hours: 18, earnings: 515 });
    expect(r.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(mockHoursList).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31', name: undefined });
    expect(mockBuildPayroll).toHaveBeenCalledWith([{ Name: 'Anna' }, { Name: 'Bob' }], { Anna: 30 });
  });
});
