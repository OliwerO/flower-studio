import { Router } from 'express';

const router = Router();

const PINS = {
  owner:   process.env.PIN_OWNER,
  florist: process.env.PIN_FLORIST,
  driver:  process.env.PIN_DRIVER,
};

// POST /api/auth/verify — checks a PIN and returns the role
// Used by frontend apps on login screen to confirm PIN before storing it
router.post('/verify', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN required.' });
  }

  const role = Object.keys(PINS).find((r) => PINS[r] === String(pin));

  if (!role) {
    return res.status(401).json({ error: 'Invalid PIN.' });
  }

  res.json({ role });
});

export default router;
