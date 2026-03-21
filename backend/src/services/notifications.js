// SSE notification service — broadcasts events to all connected clients.
// Think of it as a factory PA system: when something happens (new Wix order),
// every connected terminal (florist app, dashboard) hears the announcement.

const clients = new Set();

// Connection limits — prevent memory exhaustion from runaway reconnections.
// Expected max: 1 owner + 4 florists + 2 drivers = 7 clients.
// Headroom for page reloads / stale connections that haven't closed yet.
const MAX_CLIENTS = 50;

/**
 * Register a new SSE client (Express response object).
 * The response stays open — we write events to it over time.
 * Returns false if connection limit reached.
 */
export function addClient(res) {
  if (clients.size >= MAX_CLIENTS) {
    console.error(`[SSE] Connection limit reached (${MAX_CLIENTS}), rejecting new client`);
    return false;
  }
  clients.add(res);
  console.log(`[SSE] Client connected (${clients.size} total)`);
  return true;
}

/**
 * Remove a disconnected client.
 */
export function removeClient(res) {
  clients.delete(res);
  console.log(`[SSE] Client disconnected (${clients.size} remaining)`);
}

/**
 * Broadcast an event to ALL connected clients.
 * @param {object} event — e.g. { type: 'new_order', orderId: 'rec...', customerName: 'Anna', source: 'Wix' }
 */
export function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch (err) {
      // Client probably disconnected — clean up
      console.error('[SSE] Failed to write to client, removing:', err.message);
      clients.delete(client);
    }
  }
  console.log(`[SSE] Broadcast to ${clients.size} clients:`, event.type);
}

// Heartbeat — keeps connections alive through proxies/load balancers
// that kill idle connections after ~60s. Sends a comment every 30s.
setInterval(() => {
  for (const client of clients) {
    try {
      client.write(': heartbeat\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 30000);
