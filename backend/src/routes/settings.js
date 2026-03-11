// Settings routes — in-memory store for operational config + daily settings.
// Like a shift whiteboard + factory config binder: daily preferences reset,
// but operational configs persist until the server restarts.
// Defaults match current hardcoded values so nothing breaks if never changed.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { getBackupDriverName, setBackupDriverName } from '../services/driverState.js';

const router = Router();

// ── Default configuration values ────────────────────────────
// These are the same values currently hardcoded across the codebase.
// The Settings tab lets the owner tweak them without touching code.
const config = {
  defaultDeliveryFee: 35,
  targetMarkup:       2.2,
  suppliers:          ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'],
  stockCategories:    ['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'],
  paymentMethods:     ['Cash', 'Card', 'Mbank', 'Monobank', 'Revolut', 'PayPal', 'Wix Online'],
  orderSources:       ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'],
  driverCostPerDelivery: 0, // TBD — per-delivery flat rate for driver cost
  extraDrivers: [], // drivers without app PINs (assignment-only, e.g. backup drivers)

  // ── Storefront categories (Wix integration) ──
  // Permanent categories are always shown in the store nav.
  // Seasonal categories rotate: only one active at a time.
  // "Available Today" is auto-generated (LT=0 + inStock).
  storefrontCategories: {
    permanent: ['All Bouquets', 'Bestsellers'],
    seasonal: [
      { name: "Valentine's Day", slug: 'valentines-day', from: '01-25', to: '02-15' },
      { name: "Women's Day",     slug: 'womens-day',     from: '02-25', to: '03-10' },
      { name: "Mother's Day",    slug: 'mothers-day',    from: '04-20', to: '05-26' },
      { name: 'Easter',          slug: 'easter',         from: '03-28', to: '04-15' },
      { name: 'Christmas',       slug: 'christmas',      from: '12-01', to: '12-26' },
    ],
    autoSchedule: true,       // auto-activate seasonal by date range
    manualOverride: null,     // slug of forced seasonal category (overrides auto)
  },

  // ── Delivery zones (Wix checkout + shipping SPI) ──
  deliveryZones: [
    { id: 1, name: 'Central Krakow', fee: 35, postcodes: ['30-0', '30-1', '31-0'] },
    { id: 2, name: 'Suburbs',        fee: 50, postcodes: ['32-0'] },
    { id: 3, name: 'Out of city',    fee: 80, postcodes: [] },
  ],
  freeDeliveryThreshold: 300,
  expressSurcharge: 20,
  deliveryTimeSlots: ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
};

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

// Auto-clear driver-of-day when the date changes.
function autoClearIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (daily._lastSetDate && daily._lastSetDate !== today) {
    daily.driverOfDay = null;
    daily._lastSetDate = null;
  }
}

// ── GET /api/settings — read all settings + config (any authenticated role) ──
// Merges PIN-based drivers (from env vars) with extra drivers (from config).
// Like a staffing roster: some employees have badge access (PINs), others are temps
// who can be assigned work but don't have building access.
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  const backupName = getBackupDriverName();
  // Replace "Backup" with today's freelancer name if set
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

// ── PUT /api/settings/driver-of-day — set today's default driver ──
router.put('/driver-of-day', authorize('admin'), (req, res) => {
  const { driverName } = req.body;
  daily.driverOfDay = driverName || null;
  daily._lastSetDate = driverName ? new Date().toISOString().split('T')[0] : null;
  res.json({ driverOfDay: daily.driverOfDay });
});

// ── PUT /api/settings/backup-driver — set today's freelancer name ──
// The backup PIN is a shared credential. This endpoint lets the owner
// label who's actually using it today (like writing a temp worker's name
// on a shared badge).
router.put('/backup-driver', authorize('admin'), (req, res) => {
  const { name } = req.body;
  setBackupDriverName(name);
  res.json({ backupDriverName: getBackupDriverName() });
});

// ── PUT /api/settings/config — update operational config (owner only) ──
// Accepts a partial object — only the keys provided will be updated.
// Like updating a factory parameter sheet: change one line, rest stays.
router.put('/config', authorize('admin'), (req, res) => {
  const allowed = Object.keys(config);
  const updates = req.body;

  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) {
      config[key] = updates[key];
    }
  }

  res.json({ config });
});

// ── GET /api/settings/lists — returns just the list configs (for dropdown population) ──
// Accessible by any authenticated role (florists need supplier/category lists).
router.get('/lists', authorize('orders'), (req, res) => {
  res.json({
    suppliers:      config.suppliers,
    categories:     config.stockCategories,
    paymentMethods: config.paymentMethods,
    orderSources:   config.orderSources,
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

/**
 * Returns the currently active seasonal category based on config rules.
 * Priority: manual override > auto-schedule by date > null (none active).
 */
export function getActiveSeasonalCategory() {
  const sc = config.storefrontCategories;

  // Manual override takes precedence
  if (sc.manualOverride) {
    const forced = sc.seasonal.find(s => s.slug === sc.manualOverride);
    if (forced) return { name: forced.name, slug: forced.slug };
  }

  // Auto-schedule: check which season we're in today
  if (sc.autoSchedule) {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const s of sc.seasonal) {
      if (mmdd >= s.from && mmdd <= s.to) {
        return { name: s.name, slug: s.slug };
      }
    }
  }

  return null;
}

export default router;
