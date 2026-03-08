// SSE events route — long-lived HTTP connection that pushes real-time events.
// Like a radio channel: clients tune in, and when something happens (new order),
// they hear it immediately without having to ask repeatedly.

import { Router } from 'express';
import { addClient, removeClient } from '../services/notifications.js';

const router = Router();

/**
 * GET /api/events — Server-Sent Events stream.
 * Client opens this connection once; it stays open and receives events.
 * No auth required — the stream is lightweight and carries no sensitive data
 * (just event type + order ID + customer name).
 */
router.get('/', (req, res) => {
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
