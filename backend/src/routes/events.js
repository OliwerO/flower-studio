// SSE events route — long-lived HTTP connection that pushes real-time events.
// Like a radio channel: clients tune in, and when something happens (new order),
// they hear it immediately without having to ask repeatedly.

import { Router } from 'express';
import { addClient, removeClient } from '../services/notifications.js';
import { safeEqual } from '../utils/auth.js';

const router = Router();

// PIN validation for SSE — EventSource doesn't support custom headers,
// so we accept the PIN as a query parameter: /api/events?pin=XXXX
const PINS = {
  owner:   process.env.PIN_OWNER,
  florist: process.env.PIN_FLORIST,
};
const DRIVER_PINS = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PIN_DRIVER_'))
  .map(([, value]) => value);

function isValidPin(pin) {
  if (!pin) return false;
  const allPins = [...Object.values(PINS), ...DRIVER_PINS].filter(Boolean);
  return allPins.some(p => safeEqual(p, pin));
}

router.get('/', (req, res) => {
  if (!isValidPin(req.query.pin)) {
    return res.status(401).json({ error: 'Valid PIN required as ?pin= query parameter.' });
  }
  // SSE headers — tell the browser this is a persistent event stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // CORS — needed for cross-origin EventSource from frontend dev servers
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connection confirmation
  res.write('data: {"type":"connected"}\n\n');

  // Register this client for broadcasts
  addClient(res);

  // Clean up when client disconnects (browser tab closed, network drop, etc.)
  req.on('close', () => {
    removeClient(res);
  });
});

export default router;
