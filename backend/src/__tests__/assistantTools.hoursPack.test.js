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
    expect(mockHoursList).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31', name: undefined });
    expect(mockBuildPayroll).toHaveBeenCalledWith([{ Name: 'Anna' }, { Name: 'Bob' }], { Anna: 30 });
  });

  it('surfaces configured per-florist pay rates (top-level + per florist)', async () => {
    const RATES = {
      Masha: { Wedding: 25, Holidays: 25, Standard: 25 },
      Sasha: { Wedding: 50, Holidays: 40, Standard: 33 },
    };
    mockGetConfig.mockReturnValue(RATES);
    mockHoursList.mockResolvedValueOnce([{ Name: 'Sasha' }]);
    mockBuildPayroll.mockReturnValue({
      days: [{ name: 'Sasha', hours: 8, earnings: 264, deliveryCount: 0 }],
      totals: { hours: 8, earnings: 264, deliveries: 0, days: 1 },
    });
    const r = await hoursSummaryHandler({ from: '2026-05-01', to: '2026-05-31' });
    // Top-level rates map carries the full configured rate model.
    expect(r.rates).toEqual(RATES);
    // The florist who logged hours carries their own rate(s).
    const sasha = r.florists.find(f => f.name === 'Sasha');
    expect(sasha.rates).toEqual({ Wedding: 50, Holidays: 40, Standard: 33 });
    // Masha has configured rates but no logged hours — still surfaced (zeroed hours).
    const masha = r.florists.find(f => f.name === 'Masha');
    expect(masha).toBeDefined();
    expect(masha.rates).toEqual({ Wedding: 25, Holidays: 25, Standard: 25 });
    expect(masha).toMatchObject({ hours: 0, earnings: 0, days: 0 });
  });

  it('answers a rate question with no date range and no logged hours', async () => {
    mockGetConfig.mockReturnValue({ Sasha: { Standard: 33 } });
    mockHoursList.mockResolvedValueOnce([]);
    mockBuildPayroll.mockReturnValue({ days: [], totals: { hours: 0, earnings: 0, deliveries: 0, days: 0 } });
    const r = await hoursSummaryHandler({});
    expect(mockHoursList).toHaveBeenCalledWith({ dateFrom: undefined, dateTo: undefined, name: undefined });
    expect(r.rates).toEqual({ Sasha: { Standard: 33 } });
    expect(r.florists.find(f => f.name === 'Sasha').rates).toEqual({ Standard: 33 });
  });

  it('scopes rates to one florist when name is given', async () => {
    mockGetConfig.mockReturnValue({
      Masha: { Standard: 25 },
      Sasha: { Wedding: 50, Standard: 33 },
    });
    mockHoursList.mockResolvedValueOnce([{ Name: 'Sasha' }]);
    mockBuildPayroll.mockReturnValue({
      days: [{ name: 'Sasha', hours: 5, earnings: 165, deliveryCount: 0 }],
      totals: { hours: 5, earnings: 165, deliveries: 0, days: 1 },
    });
    const r = await hoursSummaryHandler({ name: 'Sasha' });
    expect(r.rates).toEqual({ Sasha: { Wedding: 50, Standard: 33 } });
    expect(r.florists.map(f => f.name)).toEqual(['Sasha']);
  });
});
