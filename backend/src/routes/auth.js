import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

const router = Router();

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

// Build driver PINs dynamically — same logic as middleware.
// PIN_DRIVER_TIMUR=1234 → { pin: '1234', name: 'Timur' }
const DRIVER_PINS = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([key, value]) => ({
    pin:  value,
    name: key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
          + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase(),
  }));

// 5 attempts per 15 minutes per IP — prevents brute-forcing 4-digit PINs
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many PIN attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/verify — checks a PIN and returns the role (+ driverName for drivers)
router.post('/verify', pinLimiter, (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN required.' });
  }

  const pinStr = String(pin);

  // Check owner/florist PINs (constant-time comparison)
  const role = Object.keys(PINS).find((r) => safeEqual(PINS[r], pinStr));
  if (role) {
    return res.json({ role });
  }

  // Check individual driver PINs
  const driver = DRIVER_PINS.find(d => safeEqual(d.pin, pinStr));
  if (driver) {
    return res.json({ role: 'driver', driverName: driver.name });
  }

  return res.status(401).json({ error: 'Invalid PIN.' });
});

export default router;
