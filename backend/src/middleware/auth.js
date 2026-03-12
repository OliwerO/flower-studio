// PIN auth middleware — like a badge reader at a facility gate.
// Each role gets a PIN that grants access to its section of the API.
// Sends role downstream via req.role so routes can check permissions.
//
// Drivers get individual PINs: PIN_DRIVER_TIMUR, PIN_DRIVER_NIKITA, etc.
// The badge reader now knows *which* driver scanned in (req.driverName).

import crypto from 'node:crypto';
import { getBackupDriverName } from '../services/driverState.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const PINS = {
  owner:   process.env.PIN_OWNER,
  florist: process.env.PIN_FLORIST,
};

// Build driver PINs dynamically from env vars matching PIN_DRIVER_*
// Each env var like PIN_DRIVER_TIMUR=1234 maps to { pin: '1234', name: 'Timur' }
const DRIVER_PINS = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([key, value]) => ({
    pin:  value,
    name: key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
          + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase(),
  }));

// Route access per role
const ROLE_ACCESS = {
  owner:   ['orders', 'customers', 'stock', 'deliveries', 'dashboard', 'analytics', 'stock-purchases', 'auth', 'admin'],
  florist: ['orders', 'customers', 'stock', 'stock-purchases', 'deliveries'],
  driver:  ['deliveries', 'auth'],
};

export function authenticate(req, res, next) {
  const pin = req.headers['x-auth-pin'];

  if (!pin) {
    return res.status(401).json({ error: 'PIN required. Send X-Auth-PIN header.' });
  }

  // Check owner/florist PINs first (constant-time comparison prevents timing attacks)
  const role = Object.keys(PINS).find((r) => safeEqual(PINS[r], pin));
  if (role) {
    req.role = role;
    return next();
  }

  // Check driver PINs — each driver has their own badge
  const driver = DRIVER_PINS.find(d => safeEqual(d.pin, pin));
  if (driver) {
    req.role = 'driver';
    // If this is the backup PIN and the owner set a name for today, use that instead
    req.driverName = driver.name === 'Backup'
      ? (getBackupDriverName() || driver.name)
      : driver.name;
    return next();
  }

  return res.status(401).json({ error: 'Invalid PIN.' });
}

// Route guard — checks that the role has access to the resource.
// Usage: router.use(authorize('stock'))
export function authorize(resource) {
  return (req, res, next) => {
    if (!ROLE_ACCESS[req.role]?.includes(resource)) {
      return res.status(403).json({
        error: `Role "${req.role}" does not have access to /${resource}.`,
      });
    }
    next();
  };
}
