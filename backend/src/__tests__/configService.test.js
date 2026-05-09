import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../repos/appConfigRepo.js', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  nextOrderId: vi.fn().mockResolvedValue('202605-001'),
}));
vi.mock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
vi.mock('./telegram.js', () => ({ sendAlert: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

import { getActiveSeasonalSlots, getActiveSeasonalCategory, updateConfig, getConfig } from '../services/configService.js';

const SEASONAL_LIBRARY = [
  { name: "Mother's Day", slug: 'mothers-day', from: '04-20', to: '05-26', description: '', translations: {} },
  { name: 'Christmas',    slug: 'christmas',   from: '12-01', to: '12-26', description: '', translations: {} },
  { name: 'Easter',       slug: 'easter',      from: '03-28', to: '04-15', description: '', translations: {} },
];

function setSlots(slot1Overrides = {}, slot2Overrides = {}) {
  const sc = getConfig('storefrontCategories');
  updateConfig('storefrontCategories', {
    ...sc,
    seasonal: SEASONAL_LIBRARY,
    slots: [
      { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null, ...slot1Overrides },
      { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null, ...slot2Overrides },
    ],
  });
}

beforeEach(() => {
  vi.useRealTimers();
  setSlots();
});

describe('deliveryTimeSlots defaults and migration', () => {
  it('DEFAULTS include 08:00-10:00 and 18:00-20:00', () => {
    // The module boots with appConfigRepo.get=null, so config is seeded from DEFAULTS.
    const slots = getConfig('deliveryTimeSlots');
    expect(slots).toContain('08:00-10:00');
    expect(slots).toContain('18:00-20:00');
  });

  it('migrateDeliveryTimeSlots restores missing slots when stored config only has 4', async () => {
    vi.resetModules();
    vi.doMock('../repos/appConfigRepo.js', () => ({
      get: vi.fn().mockResolvedValue({
        deliveryTimeSlots: ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
      }),
      set: vi.fn().mockResolvedValue(undefined),
      nextOrderId: vi.fn().mockResolvedValue('202605-001'),
    }));
    vi.doMock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../services/telegram.js', () => ({ sendAlert: vi.fn() }));
    vi.doMock('../db/index.js', () => ({ db: {} }));
    vi.doMock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

    const { getConfig: getConfigFresh } = await import('../services/configService.js');
    // loadConfig is async; give it one tick to complete
    await new Promise(r => setTimeout(r, 50));

    const slots = getConfigFresh('deliveryTimeSlots');
    expect(slots).toContain('08:00-10:00');
    expect(slots).toContain('18:00-20:00');
    expect(slots.length).toBeGreaterThanOrEqual(6);
  });

  afterEach(() => { vi.resetModules(); });
});

describe('getActiveSeasonalSlots', () => {
  it('returns two entries, one per slot', () => {
    const result = getActiveSeasonalSlots();
    expect(result).toHaveLength(2);
    expect(result[0].slot.id).toBe('slot1');
    expect(result[1].slot.id).toBe('slot2');
  });

  it("slot1 auto-schedules within Mother's Day range", () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    const result = getActiveSeasonalSlots();
    expect(result[0].category?.slug).toBe('mothers-day');
    expect(result[1].category).toBeNull();
  });

  it('slot1 returns null when date is outside all ranges', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
    expect(result[1].category).toBeNull();
  });

  it('slot1 manualOverride wins over date-based auto', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    setSlots({ manualOverride: 'christmas' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category?.slug).toBe('christmas');
  });

  it('slot2 manualOverride activates independently of slot1', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    setSlots({}, { manualOverride: 'easter' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
    expect(result[1].category?.slug).toBe('easter');
  });

  it('slot2 autoSchedule:false never auto-activates even when date matches', () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    const result = getActiveSeasonalSlots();
    expect(result[1].category).toBeNull();
  });

  it('manualOverride with unknown slug returns null', () => {
    setSlots({ autoSchedule: false, manualOverride: 'does-not-exist' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
  });
});

describe('getActiveSeasonalCategory (backward compat wrapper)', () => {
  it('returns the slot1 category', () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    expect(getActiveSeasonalCategory()?.slug).toBe('mothers-day');
  });

  it('returns null when slot1 has no active category', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(getActiveSeasonalCategory()).toBeNull();
  });
});
