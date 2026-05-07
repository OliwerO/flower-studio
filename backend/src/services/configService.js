// App configuration service — in-memory config backed by Postgres App Config table.
// Owns the singleton config state, daily session state (driver-of-day), and
// the available-today cutoff reminder. Other modules import getters from here;
// routes/settings.js handles the HTTP layer.
import * as appConfigRepo from '../repos/appConfigRepo.js';
import * as productConfigRepo from '../repos/productConfigRepo.js';
import { sendAlert } from './telegram.js';
import { db } from '../db/index.js';
import { recordAudit } from '../db/audit.js';

// ── Default configuration values ────────────────────────────
// Used as fallback if config row doesn't exist yet or is empty.
const DEFAULTS = {
  defaultDeliveryFee: 35,
  targetMarkup:       2.2,
  suppliers:          ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'],
  stockCategories:    ['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'],
  paymentMethods:     ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:       ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
  driverCostPerDelivery: 35,
  driverCostPerPORun: 45,
  floristNames: ['Anya', 'Daria'],
  rateTypes: ['Standard', 'Wedding', 'Holidays'],
  floristRates: {},
  extraDrivers: [],
  storefrontCategories: {
    permanent: [
      { name: 'All Bouquets', slug: 'all-bouquets', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
      { name: 'Bestsellers',  slug: 'bestsellers',  description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
    ],
    seasonal: [
      { name: "Valentine's Day", slug: 'valentines-day', from: '01-25', to: '02-15', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
      { name: "Women's Day",     slug: 'womens-day',     from: '02-25', to: '03-10', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
      { name: "Mother's Day",    slug: 'mothers-day',    from: '04-20', to: '05-26', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
      { name: 'Easter',          slug: 'easter',         from: '03-28', to: '04-15', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
      { name: 'Christmas',       slug: 'christmas',      from: '12-01', to: '12-26', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
    ],
    auto: [
      {
        name: 'Available Today',
        slug: 'available-today',
        description: 'Bouquets ready for same-day delivery or pickup.',
        translations: {
          en: { title: 'Available Today',   description: 'Bouquets ready for same-day delivery or pickup.' },
          pl: { title: 'Dostępne dziś',     description: 'Bukiety gotowe do dostawy lub odbioru tego samego dnia.' },
          ru: { title: 'Доступно сегодня',  description: 'Букеты, готовые к доставке или самовывозу сегодня.' },
          uk: { title: 'Доступно сьогодні', description: 'Букети, готові до доставки або самовивозу сьогодні.' },
        },
      },
    ],
    autoSchedule: true,
    manualOverride: null,
    wixCategoryMap: {},
  },
  deliveryZones: [
    { id: 1, name: 'Central Krakow', fee: 35, postcodes: ['30-0', '30-1', '31-0'] },
    { id: 2, name: 'Suburbs',        fee: 50, postcodes: ['32-0'] },
    { id: 3, name: 'Out of city',    fee: 80, postcodes: [] },
  ],
  freeDeliveryThreshold: 300,
  expressSurcharge: 20,
  deliveryTimeSlots: ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
  availableTodayCutoff: '18:00',
  availableTodayTimezone: 'Europe/Warsaw',
  cutoffReminderLastDate: null,
  slotLeadTimeMinutes: 30,
  // Shows the per-row "Reconcile premade" action on stock rows in the dashboard.
  // Off by default — admin tooling for fixing historical data mismatches.
  showStockRepairTools: false,
};

// ── In-memory config (loaded from Postgres on startup) ──────
let config = structuredClone(DEFAULTS);
let configLoaded = false;

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function normalizeMMDD(val) {
  if (!val) return val;
  const clean = val.replace(/\./g, '-');
  const parts = clean.split('-');
  if (parts.length !== 2) return clean;
  const [a, b] = parts.map(p => p.trim().padStart(2, '0'));
  if (Number(a) > 12) return `${b}-${a}`;
  return `${a}-${b}`;
}

function migrateSeasonalDates() {
  const sc = config.storefrontCategories;
  if (!sc?.seasonal) return;
  let changed = false;
  for (const entry of sc.seasonal) {
    const newFrom = normalizeMMDD(entry.from);
    const newTo = normalizeMMDD(entry.to);
    if (newFrom !== entry.from || newTo !== entry.to) {
      console.log(`[SETTINGS] Migrating dates for "${entry.name}": ${entry.from}→${newFrom}, ${entry.to}→${newTo}`);
      entry.from = newFrom;
      entry.to = newTo;
      changed = true;
    }
  }
  if (changed) saveConfig().catch(err => console.error('[SETTINGS] Date migration save failed:', err.message));
}

function migrateCategoryObjects() {
  const sc = config.storefrontCategories;
  if (!sc) return;
  const emptyTranslations = { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } };
  let changed = false;

  if (Array.isArray(sc.permanent) && sc.permanent.length > 0 && typeof sc.permanent[0] === 'string') {
    sc.permanent = sc.permanent.map(name => ({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
      description: '',
      translations: JSON.parse(JSON.stringify(emptyTranslations)),
    }));
    changed = true;
    console.log('[SETTINGS] Migrated permanent categories to object format');
  }

  if (!sc.auto) {
    sc.auto = DEFAULTS.storefrontCategories.auto;
    changed = true;
  } else if (Array.isArray(sc.auto) && sc.auto.length > 0 && typeof sc.auto[0] === 'string') {
    sc.auto = sc.auto.map(name => ({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
      description: '',
      translations: JSON.parse(JSON.stringify(emptyTranslations)),
    }));
    changed = true;
    console.log('[SETTINGS] Migrated auto categories to object format');
  }

  if (changed) saveConfig().catch(err => console.error('[SETTINGS] Category migration save failed:', err.message));
}

function migrateAutoCategoryTranslations() {
  const sc = config.storefrontCategories;
  if (!sc?.auto || !Array.isArray(sc.auto)) return;
  let changed = false;

  for (const stored of sc.auto) {
    if (!stored || typeof stored !== 'object') continue;
    const defaultEntry = (DEFAULTS.storefrontCategories.auto || []).find(d => d.slug === stored.slug);
    if (!defaultEntry) continue;
    if (!stored.translations) stored.translations = {};

    for (const lang of ['en', 'pl', 'ru', 'uk']) {
      const storedLang = stored.translations[lang] || {};
      const defaultLang = defaultEntry.translations?.[lang] || {};
      if (!storedLang.title && defaultLang.title) { storedLang.title = defaultLang.title; changed = true; }
      if (!storedLang.description && defaultLang.description) { storedLang.description = defaultLang.description; changed = true; }
      stored.translations[lang] = storedLang;
    }

    if (!stored.description && defaultEntry.description) { stored.description = defaultEntry.description; changed = true; }
  }

  if (changed) {
    console.log('[SETTINGS] Backfilled auto-category translations');
    saveConfig().catch(err => console.error('[SETTINGS] Auto-category translation backfill save failed:', err.message));
  }
}

function migrateFloristRates() {
  const rates = config.floristRates;
  if (!rates || typeof rates !== 'object') return;
  let changed = false;
  const defaultType = (config.rateTypes && config.rateTypes[0]) || 'Standard';
  for (const name of Object.keys(rates)) {
    if (typeof rates[name] === 'number') {
      rates[name] = { [defaultType]: rates[name] };
      changed = true;
    }
  }
  if (changed) {
    console.log('[SETTINGS] Migrated floristRates to per-type format');
    saveConfig().catch(err => console.error('[SETTINGS] FloristRates migration save failed:', err.message));
  }
}

async function saveConfig(before) {
  try {
    await appConfigRepo.set('config', config);
    if (before) {
      await recordAudit(db, {
        entityType: 'app_config',
        entityId:   'config',
        action:     'update',
        before:     { storefrontCategories: before.storefrontCategories },
        after:      { storefrontCategories: config.storefrontCategories },
        actorRole:  'system',
        actorPinLabel: null,
      }).catch(err => console.error('[SETTINGS] Failed to log audit event:', err.message));
    }
  } catch (err) {
    console.error('[SETTINGS] Failed to save config to Postgres:', err.message);
  }
}

async function loadConfig() {
  try {
    const stored = await appConfigRepo.get('config');
    if (stored) {
      config = deepMerge(DEFAULTS, stored);
      migrateSeasonalDates();
      migrateCategoryObjects();
      migrateAutoCategoryTranslations();
      migrateFloristRates();
      console.log('[SETTINGS] Config loaded from Postgres');
    } else {
      await appConfigRepo.set('config', DEFAULTS);
      console.log('[SETTINGS] Config row created in Postgres with defaults');
    }
  } catch (err) {
    console.error('[SETTINGS] Failed to load config from Postgres:', err.message);
    console.warn('[SETTINGS] Using in-memory defaults');
  }
  configLoaded = true;
}

// Load on startup
loadConfig();

// ── Available Today cutoff reminder ─────────────────────────
setInterval(async () => {
  try {
    if (!configLoaded) return;
    const cutoff = config.availableTodayCutoff || '18:00';
    const tz = config.availableTodayTimezone || 'Europe/Warsaw';
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(now);
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

    if (timeStr < cutoff) return;
    if (config.cutoffReminderLastDate === todayStr) return;

    const allActiveRows = await productConfigRepo.list({ activeOnly: true });
    const zeroLeadRows = allActiveRows.filter(r => r['Lead Time Days'] === 0);

    if (zeroLeadRows.length > 0) {
      await sendAlert(
        `⏰ Available Today reminder\n\n`
        + `It's past ${cutoff} — you still have products marked as Available Today.\n`
        + `Deactivate them in the dashboard if they're no longer available.`
      );
      config.cutoffReminderLastDate = todayStr;
      saveConfig().catch(err => console.error('[SETTINGS] Failed to persist reminder date:', err.message));
      console.log('[SETTINGS] Cutoff reminder sent');
    }
  } catch (err) {
    console.error('[SETTINGS] Cutoff reminder error:', err.message);
  }
}, 60_000);

// ── Daily session state (auto-reset at midnight) ─────────────
const daily = {
  driverOfDay:  null,
  _lastSetDate: null,
};

// Build driver names from env vars (same pattern as auth.js)
export const driverNames = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([key]) =>
    key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
    + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase()
  );

export function autoClearIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (daily._lastSetDate && daily._lastSetDate !== today) {
    daily.driverOfDay = null;
    daily._lastSetDate = null;
  }
}

export function setDailyDriver(name) {
  daily.driverOfDay = name || null;
  daily._lastSetDate = name ? new Date().toISOString().split('T')[0] : null;
}

export function getDailyState() {
  return daily;
}

// ── Public getters ────────────────────────────────────────────

export function getDriverOfDay() {
  autoClearIfNewDay();
  return daily.driverOfDay;
}

export function getConfig(key) {
  return config[key];
}

export function getAllConfig() {
  return config;
}

export function updateConfig(key, value) {
  config[key] = value;
  saveConfig().catch(err => console.error('[SETTINGS] Background save failed:', err.message));
}

export function updateConfigBulk(updates) {
  const before = JSON.parse(JSON.stringify(config));
  const allowed = Object.keys(config);
  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) config[key] = updates[key];
  }
  saveConfig(before).catch(err => console.error('[SETTINGS] Background save failed:', err.message));
}

export async function generateOrderId() {
  const now      = new Date();
  const monthKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    return await appConfigRepo.nextOrderId(monthKey);
  } catch (err) {
    console.error('[ORDER-ID] Counter error:', err.message);
    return `${monthKey}-T${Date.now().toString().slice(-5)}`;
  }
}

export function isPastCutoff() {
  const cutoff = config.availableTodayCutoff || '18:00';
  const tz = config.availableTodayTimezone || 'Europe/Warsaw';
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: tz,
  }).format(now);
  return timeStr >= cutoff;
}

export function getActiveSeasonalCategory() {
  const sc = config.storefrontCategories;

  if (sc.manualOverride) {
    const forced = sc.seasonal.find(s => s.slug === sc.manualOverride);
    if (forced) return {
      name: forced.name, slug: forced.slug,
      description: forced.description || '',
      translations: forced.translations || {},
    };
  }

  if (sc.autoSchedule) {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const s of sc.seasonal) {
      if (mmdd >= s.from && mmdd <= s.to) {
        return {
          name: s.name, slug: s.slug,
          description: s.description || '',
          translations: s.translations || {},
        };
      }
    }
  }

  return null;
}
