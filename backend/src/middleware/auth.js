// PIN auth middleware — like a badge reader at a facility gate.
// Each role gets a PIN that grants access to its section of the API.
// Sends role downstream via req.role so routes can check permissions.
//
// Drivers get individual PINs: PIN_DRIVER_TIMUR, PIN_DRIVER_NIKITA, etc.
// The badge reader now knows *which* driver scanned in (req.driverName).

import { safeEqual } from '../utils/auth.js';
import { resolveDriverByPin } from '../utils/driverPins.js';

const PINS = {
  owner:   process.env.PIN_OWNER,
  florist: process.env.PIN_FLORIST,
};

// Route access per role
const ROLE_ACCESS = {
  owner:   ['orders', 'customers', 'stock', 'deliveries', 'dashboard', 'analytics', 'stock-purchases', 'stock-orders', 'auth', 'admin', 'premade-bouquets', 'feedback'],
  florist: ['orders', 'customers', 'stock', 'stock-purchases', 'stock-orders', 'deliveries', 'premade-bouquets', 'feedback'],
  driver:  ['deliveries', 'stock-orders', 'auth', 'feedback'],
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
  const driverName = resolveDriverByPin(pin);
  if (driverName) {
    req.role = 'driver';
    req.driverName = driverName;
    return next();
  }

  return res.status(401).json({ error: 'Invalid PIN.' });
}

// Route guard — checks that the role has access to the resource.
// Usage: router.use(authorize('stock'))
// Optional roles array restricts to specific roles: authorize('stock-orders', ['owner'])
export function authorize(resource, roles) {
  return (req, res, next) => {
    if (!ROLE_ACCESS[req.role]?.includes(resource)) {
      return res.status(403).json({
        error: `Role "${req.role}" does not have access to /${resource}.`,
      });
    }
    if (roles && !roles.includes(req.role)) {
      return res.status(403).json({
        error: `Role "${req.role}" is not allowed to perform this action.`,
      });
    }
    next();
  };
}
