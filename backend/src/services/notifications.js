// SSE notification service — broadcasts events to all connected clients.
// Think of it as a factory PA system: when something happens (new Wix order),
// every connected terminal (florist app, dashboard) hears the announcement.

const clients = new Set();

/**
 * Register a new SSE client (Express response object).
 * The response stays open — we write events to it over time.
 */
export function addClient(res) {
  clients.add(res);
  console.log(`[SSE] Client connected (${clients.size} total)`);
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
