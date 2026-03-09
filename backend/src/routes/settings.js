// Settings routes — in-memory store for operational config + daily settings.
// Like a shift whiteboard + factory config binder: daily preferences reset,
// but operational configs persist until the server restarts.
// Defaults match current hardcoded values so nothing breaks if never changed.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';

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
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  res.json({
    driverOfDay: daily.driverOfDay,
    drivers:     driverNames,
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

export default router;
