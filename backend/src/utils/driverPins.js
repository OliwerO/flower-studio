// PIN resolution — the single source of truth for mapping a PIN to a role.
// Shared by the auth middleware, the /auth/verify route, the SSE handshake, and
// the Telegram registration bot. Each PIN_DRIVER_<NAME> env var maps to a
// capitalised driver name; the Backup PIN resolves to the owner-set backup name
// when present. Owner/Florist PINs come from PIN_OWNER / PIN_FLORIST.
import { getBackupDriverName } from '../services/driverState.js';
import { safeEqual } from './auth.js';

export function listDriverPins() {
  return Object.entries(process.env)
    .filter(([key]) => key.startsWith('PIN_DRIVER_'))
    .map(([key, value]) => ({
      pin: value,
      name: key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
            + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase(),
    }));
}

export function resolveDriverByPin(pin) {
  if (!pin) return null;
  const driver = listDriverPins().find(d => safeEqual(d.pin, pin));
  if (!driver) return null;
  return driver.name === 'Backup'
    ? (getBackupDriverName() || driver.name)
    : driver.name;
}

// Florists share a single PIN_FLORIST (no per-florist identity). Resolves to the
// reserved key 'florist' used by the registration loop + notify seam.
export function resolveFloristByPin(pin) {
  if (!pin) return null;
  return safeEqual(process.env.PIN_FLORIST, pin) ? 'florist' : null;
}

// Resolve any PIN to a role descriptor: { role, driverName? } | null. Owner wins
// over Florist on a PIN collision (preserves the legacy owner-first precedence).
// The single seam the auth middleware + /auth/verify route both consume, so the
// Backup-name resolution can never drift between them again.
export function resolveRoleByPin(pin) {
  if (!pin) return null;
  if (safeEqual(process.env.PIN_OWNER, pin)) return { role: 'owner' };
  if (resolveFloristByPin(pin)) return { role: 'florist' };
  const driverName = resolveDriverByPin(pin);
  if (driverName) return { role: 'driver', driverName };
  return null;
}

// Truthy iff the PIN belongs to any known role. Used by the SSE route, which
// only needs a yes/no (EventSource can't send the X-Auth-PIN header, so the PIN
// arrives as a query param).
export function isValidPin(pin) {
  return resolveRoleByPin(pin) !== null;
}
