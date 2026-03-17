// Settings routes — config persisted to Airtable, daily settings in memory.
// Like a factory config binder stored in the central filing cabinet (Airtable)
// instead of on a whiteboard that gets erased when the lights go off.
// Daily preferences (driver-of-day) still reset at midnight — that's intentional.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { getBackupDriverName, setBackupDriverName } from '../services/driverState.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();

// ── Default configuration values ────────────────────────────
// Used as fallback if Airtable config row doesn't exist yet or is empty.
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
      { name: 'Available Today', slug: 'available-today', description: '', translations: { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } } },
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
  slotLeadTimeMinutes: 30,
};

// ── In-memory config (loaded from Airtable on startup) ──────
let config = { ...DEFAULTS };
let configRecordId = null; // Airtable record ID for the config row
let configLoaded = false;

/**
 * Load config from Airtable App Config table.
 * Merges stored values over defaults so new keys auto-appear.
 */
async function loadConfig() {
  if (!TABLES.APP_CONFIG) {
    console.warn('[SETTINGS] AIRTABLE_APP_CONFIG_TABLE not set — using defaults');
    configLoaded = true;
    return;
  }

  try {
    const rows = await db.list(TABLES.APP_CONFIG, {
      filterByFormula: "{Key} = 'config'",
      maxRecords: 1,
    });

    if (rows.length > 0) {
      configRecordId = rows[0].id;
      const stored = rows[0].Value;
      if (stored) {
        const parsed = JSON.parse(stored);
        // Deep merge: defaults + stored values (stored wins)
        config = deepMerge(DEFAULTS, parsed);
        // Migrate: normalize seasonal dates to MM-DD format
        migrateSeasonalDates();
        // Migrate: convert permanent/auto from string arrays to object arrays
        migrateCategoryObjects();
      }
      console.log('[SETTINGS] Config loaded from Airtable');
    } else {
      // No config row yet — create one with defaults
      const created = await db.create(TABLES.APP_CONFIG, {
        Key: 'config',
        Value: JSON.stringify(DEFAULTS),
      });
      configRecordId = created.id;
      console.log('[SETTINGS] Config row created in Airtable with defaults');
    }
  } catch (err) {
    console.error('[SETTINGS] Failed to load config from Airtable:', err.message);
    console.warn('[SETTINGS] Using in-memory defaults');
  }

  configLoaded = true;
}

/**
 * Save current config to Airtable.
 */
async function saveConfig() {
  if (!TABLES.APP_CONFIG || !configRecordId) return;

  try {
    await db.update(TABLES.APP_CONFIG, configRecordId, {
      Value: JSON.stringify(config),
    });
  } catch (err) {
    console.error('[SETTINGS] Failed to save config to Airtable:', err.message);
  }
}

/**
 * Deep merge: target gets source values, preserving nested structure.
 * Arrays are replaced (not merged) — source array wins entirely.
 */
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

/**
 * Normalize seasonal dates to MM-DD format.
 * Handles DD-MM, DD.MM, MM.DD — auto-detects by checking if first part > 12.
 */
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
  if (changed) {
    saveConfig().catch(err =>
      console.error('[SETTINGS] Date migration save failed:', err.message)
    );
  }
}

/**
 * Migrate permanent and auto categories from plain string arrays to
 * object arrays with slug, description, and translations.
 * Backward-compat: stored Airtable config may still have the old format.
 */
function migrateCategoryObjects() {
  const sc = config.storefrontCategories;
  if (!sc) return;
  const emptyTranslations = { en: { title: '', description: '' }, pl: { title: '', description: '' }, ru: { title: '', description: '' }, uk: { title: '', description: '' } };
  let changed = false;

  // Permanent: string[] → object[]
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

  // Auto: missing or string[]
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

  if (changed) {
    saveConfig().catch(err =>
      console.error('[SETTINGS] Category migration save failed:', err.message)
    );
  }
}

// Load config on startup
loadConfig();

// ── Daily settings (auto-reset at midnight) ─────────────────
const daily = {
  driverOfDay:  null,
  _lastSetDate: null,
};

// Build driver names from env vars (same pattern as auth.js)
const driverNames = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([key]) =>
    key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
    + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase()
  );

function autoClearIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (daily._lastSetDate && daily._lastSetDate !== today) {
    daily.driverOfDay = null;
    daily._lastSetDate = null;
  }
}

// ── GET /api/settings — read all settings + config ──
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  const backupName = getBackupDriverName();
  const resolvedDrivers = [...new Set([...driverNames, ...config.extraDrivers])]
    .map(name => name === 'Backup' && backupName ? backupName : name);
  res.json({
    driverOfDay:      daily.driverOfDay,
    backupDriverName: backupName,
    drivers:          resolvedDrivers,
    pinDrivers:       driverNames,
    config,
  });
});

// ── PUT /api/settings/driver-of-day ──
// When a driver-of-day is set, auto-assign them to all today's unassigned deliveries.
// Like a shift supervisor assigning the day's driver to all open dispatches at once.
router.put('/driver-of-day', authorize('admin'), async (req, res, next) => {
  try {
    const { driverName } = req.body;
    daily.driverOfDay = driverName || null;
    daily._lastSetDate = driverName ? new Date().toISOString().split('T')[0] : null;

    let assignedCount = 0;
    if (driverName) {
      const today = new Date().toISOString().split('T')[0];
      const unassigned = await db.list(TABLES.DELIVERIES, {
        filterByFormula: `AND(DATESTR({Delivery Date}) = '${sanitizeFormulaValue(today)}', {Assigned Driver} = '', {Status} != 'Delivered')`,
        fields: ['Assigned Driver'],
      });
      for (const d of unassigned) {
        await db.update(TABLES.DELIVERIES, d.id, { 'Assigned Driver': driverName });
        assignedCount++;
      }
    }

    res.json({ driverOfDay: daily.driverOfDay, assignedCount });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/settings/backup-driver ──
router.put('/backup-driver', authorize('admin'), (req, res) => {
  const { name } = req.body;
  setBackupDriverName(name);
  res.json({ backupDriverName: getBackupDriverName() });
});

// ── PUT /api/settings/config — update + persist to Airtable ──
router.put('/config', authorize('admin'), async (req, res) => {
  const allowed = Object.keys(config);
  const updates = req.body;

  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) {
      config[key] = updates[key];
    }
  }

  // Persist to Airtable (fire-and-forget — don't block the response)
  saveConfig().catch(err =>
    console.error('[SETTINGS] Background save failed:', err.message)
  );

  res.json({ config });
});

// ── GET /api/settings/lists ──
router.get('/lists', authorize('orders'), (req, res) => {
  res.json({
    suppliers:      config.suppliers,
    categories:     config.stockCategories,
    paymentMethods: config.paymentMethods,
    orderSources:   config.orderSources,
    floristNames:   config.floristNames,
  });
});

// ── Exported getters for use by other modules ──

export function getDriverOfDay() {
  autoClearIfNewDay();
  return daily.driverOfDay;
}

export function getConfig(key) {
  return config[key];
}

export function updateConfig(key, value) {
  config[key] = value;
  saveConfig().catch(err =>
    console.error('[SETTINGS] Background save failed:', err.message)
  );
}

/**
 * Generate next App Order ID in YYYYMM-NNN format.
 * Counter stored in APP_CONFIG under key 'orderCounters'.
 * Like a sequential work order numbering system — each month resets the sequence.
 */
export async function generateOrderId() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Load counter from Airtable
  let counters = {};
  try {
    if (TABLES.APP_CONFIG) {
      const rows = await db.list(TABLES.APP_CONFIG, {
        filterByFormula: "{Key} = 'orderCounters'",
        maxRecords: 1,
      });
      if (rows.length > 0) {
        counters = JSON.parse(rows[0].Value || '{}');
        const current = (counters[monthKey] || 0) + 1;
        counters[monthKey] = current;
        await db.update(TABLES.APP_CONFIG, rows[0].id, {
          Value: JSON.stringify(counters),
        });
        return `${monthKey}-${String(current).padStart(3, '0')}`;
      }
    }
  } catch (err) {
    console.error('[ORDER-ID] Counter error:', err.message);
  }

  // Fallback: create counter row or use timestamp-based ID
  try {
    if (TABLES.APP_CONFIG) {
      counters[monthKey] = 1;
      await db.create(TABLES.APP_CONFIG, {
        Key: 'orderCounters',
        Value: JSON.stringify(counters),
      });
      return `${monthKey}-001`;
    }
  } catch (err) {
    console.error('[ORDER-ID] Counter create error:', err.message);
  }

  // Last resort fallback
  return `${monthKey}-${String(Date.now() % 1000).padStart(3, '0')}`;
}

/**
 * Check if the "Available Today" category should be visible on the storefront.
 * Two conditions must be met:
 * 1. Current local time (in configured timezone) is before the cutoff
 * 2. At least one product qualifies (passed as argument — caller checks stock/lead time)
 *
 * Like a factory shift schedule: after the last shift ends (cutoff),
 * the "same-day dispatch" service window closes automatically.
 */
export function isAvailableTodayCategoryActive(hasAvailableProducts = true) {
  const cutoff = config.availableTodayCutoff || '18:00';
  const tz = config.availableTodayTimezone || 'Europe/Warsaw';

  // Get current HH:MM in the configured timezone using native Intl API
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: tz,
  }).format(now);
  // timeStr = "14:30" style

  const beforeCutoff = timeStr < cutoff;
  return beforeCutoff && hasAvailableProducts;
}

/**
 * Returns the currently active seasonal category based on config rules.
 * Priority: manual override > auto-schedule by date > null (none active).
 */
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

export default router;
