// SSE events route — long-lived HTTP connection that pushes real-time events.
// Like a radio channel: clients tune in, and when something happens (new order),
// they hear it immediately without having to ask repeatedly.

import { Router } from 'express';
import { addClient, removeClient } from '../services/notifications.js';
import { isValidPin } from '../utils/driverPins.js';

const router = Router();

// PIN validation for SSE — EventSource doesn't support custom headers, so we
// accept the PIN as a query parameter (/api/events?pin=XXXX) and validate it
// against the same PIN→role seam the auth middleware uses.

router.get('/', (req, res) => {
  if (!isValidPin(req.query.pin)) {
    return res.status(401).json({ error: 'Valid PIN required as ?pin= query parameter.' });
  }
  // Check connection limit before opening the stream
  const accepted = addClient(res);
  if (!accepted) {
    return res.status(503).json({ error: 'Too many SSE connections. Try again later.' });
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

  // Clean up when client disconnects (browser tab closed, network drop, etc.)
  req.on('close', () => {
    removeClient(res);
  });
});

export default router;
