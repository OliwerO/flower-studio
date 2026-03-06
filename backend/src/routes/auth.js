import { Router } from 'express';

const router = Router();

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

// POST /api/auth/verify — checks a PIN and returns the role (+ driverName for drivers)
// Used by frontend apps on login screen to confirm PIN before storing it
router.post('/verify', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN required.' });
  }

  // Check owner/florist PINs
  const role = Object.keys(PINS).find((r) => PINS[r] === String(pin));
  if (role) {
    return res.json({ role });
  }

  // Check individual driver PINs
  const driver = DRIVER_PINS.find(d => d.pin === String(pin));
  if (driver) {
    return res.json({ role: 'driver', driverName: driver.name });
  }

  return res.status(401).json({ error: 'Invalid PIN.' });
});

export default router;
