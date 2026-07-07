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

describe('migrateRestoreAirtableConfig (Phase 7 cutover regression)', () => {
  // Simulates Postgres being seeded from DEFAULTS — the regression state.
  async function loadWithDefaults(overrides = {}) {
    vi.resetModules();
    vi.doMock('../repos/appConfigRepo.js', () => ({
      get: vi.fn().mockResolvedValue({
        defaultDeliveryFee: 35,
        targetMarkup: 2.2,
        suppliers: ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'],
        stockCategories: ['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'],
        paymentMethods: ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
        orderSources: ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
        floristNames: ['Anya', 'Daria'],
        floristRates: {},
        freeDeliveryThreshold: 300,
        expressSurcharge: 20,
        deliveryTimeSlots: ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
        ...overrides,
      }),
      set: vi.fn().mockResolvedValue(undefined),
      nextOrderId: vi.fn().mockResolvedValue('202605-001'),
    }));
    vi.doMock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../services/telegram.js', () => ({ sendAlert: vi.fn() }));
    vi.doMock('../db/index.js', () => ({ db: {} }));
    vi.doMock('../db/audit.js', () => ({ recordAudit: vi.fn() }));
    const { getConfig: gc } = await import('../services/configService.js');
    await new Promise(r => setTimeout(r, 50));
    return gc;
  }

  afterEach(() => { vi.resetModules(); });

  it('restores freeDeliveryThreshold from 300 → 600', async () => {
    const gc = await loadWithDefaults();
    expect(gc('freeDeliveryThreshold')).toBe(600);
  });

  it('restores targetMarkup from 2.2 → 2.5', async () => {
    const gc = await loadWithDefaults();
    expect(gc('targetMarkup')).toBe(2.5);
  });

  it('restores suppliers — adds Arek, OZ, Pani Marysia, Bisping', async () => {
    const gc = await loadWithDefaults();
    const s = gc('suppliers');
    expect(s).toContain('Arek');
    expect(s).toContain('OZ');
    expect(s).toContain('Pani Marysia');
    expect(s).toContain('Bisping');
  });

  it('restores stockCategories — adds 8 flower types', async () => {
    const gc = await loadWithDefaults();
    const cats = gc('stockCategories');
    expect(cats).toContain('Ranunculus');
    expect(cats).toContain('Dahlias');
    expect(cats).toContain('Hydrangeas');
    expect(cats.length).toBe(14);
  });

  it('restores paymentMethods — Stripe, RUB, TwojStartUp', async () => {
    const gc = await loadWithDefaults();
    const pm = gc('paymentMethods');
    expect(pm).toContain('Stripe');
    expect(pm).toContain('RUB');
    expect(pm).toContain('TwojStartUp');
  });

  it('restores orderSources — adds Facebook, Phone', async () => {
    const gc = await loadWithDefaults();
    const os = gc('orderSources');
    expect(os).toContain('Facebook');
    expect(os).toContain('Phone');
  });

  it('restores floristNames → [Sasha] and floristRates', async () => {
    const gc = await loadWithDefaults();
    expect(gc('floristNames')).toEqual(['Sasha']);
    expect(gc('floristRates')).toEqual({ Sasha: { Standard: 33 } });
  });

  it('skips restore when value already differs from DEFAULTS (manual edit preserved)', async () => {
    const gc = await loadWithDefaults({ freeDeliveryThreshold: 450 });
    // 450 is neither DEFAULTS (300) nor backup (600) — a manual edit → preserved
    expect(gc('freeDeliveryThreshold')).toBe(450);
  });
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

