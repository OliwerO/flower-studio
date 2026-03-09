// Settings routes — lightweight in-memory store for daily operational settings.
// Like a shift whiteboard: quick settings that reset when the factory restarts.
// No database needed — these are ephemeral daily preferences, not permanent config.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';

const router = Router();

// In-memory settings store — auto-resets at midnight (daily shift board pattern).
const settings = {
  driverOfDay: null, // e.g. "Timur"
  _lastSetDate: null, // tracks which day the setting was made
};

// Build driver names from env vars (same pattern as auth.js)
const driverNames = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([key]) =>
    key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
    + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase()
  );

// Auto-clear driver-of-day when the date changes.
// Like wiping the shift board clean each morning — yesterday's assignment doesn't carry over.
function autoClearIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (settings._lastSetDate && settings._lastSetDate !== today) {
    settings.driverOfDay = null;
    settings._lastSetDate = null;
  }
}

// GET /api/settings — read all settings + available driver names (any role)
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  res.json({ driverOfDay: settings.driverOfDay, drivers: driverNames });
});

// PUT /api/settings/driver-of-day — owner sets today's default driver.
// When set, new deliveries auto-assign to this driver instead of being unassigned.
router.put('/driver-of-day', authorize('admin'), (req, res) => {
  const { driverName } = req.body;
  settings.driverOfDay = driverName || null;
  settings._lastSetDate = driverName ? new Date().toISOString().split('T')[0] : null;
  res.json({ driverOfDay: settings.driverOfDay });
});

// Export the getter so other modules (like order creation) can read it
export function getDriverOfDay() {
  autoClearIfNewDay();
  return settings.driverOfDay;
}

export default router;
