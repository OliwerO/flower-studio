import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { resolveRoleByPin } from '../utils/driverPins.js';

const router = Router();

// 5 attempts per 15 minutes per IP — prevents brute-forcing 4-digit PINs.
//
// Overridable ONLY so the test harness can raise it: auth state is in-memory
// (see shared AuthContext — no localStorage, no session), so every UI E2E test
// has to log in through the numpad again. Five attempts means the sixth test in
// a suite is rejected, and once the window trips it rejects CORRECT PINs too —
// which is why `florist-order-creation.spec.js` sat skipped and unrunnable.
// `start-test-backend.js` sets this; production never does, so the default
// stands and the brute-force guard is unchanged there.
const MAX_PIN_ATTEMPTS = Number(process.env.AUTH_PIN_MAX_ATTEMPTS) || 5;

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: MAX_PIN_ATTEMPTS,
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

  // Single source of PIN→role resolution — same seam the auth middleware uses,
  // so the Backup-driver name is resolved identically here (no drift).
  const resolved = resolveRoleByPin(String(pin));
  if (!resolved) {
    return res.status(401).json({ error: 'Invalid PIN.' });
  }
  return res.json(
    resolved.role === 'driver'
      ? { role: 'driver', driverName: resolved.driverName }
      : { role: resolved.role }
  );
});

export default router;
