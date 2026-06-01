// Driver PIN resolution, shared by the auth middleware and the driver Telegram
// bot. Each PIN_DRIVER_<NAME> env var maps to a capitalised driver name; the
// Backup PIN resolves to the owner-set backup name when present.
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
