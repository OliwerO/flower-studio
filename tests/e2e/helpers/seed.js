// Targeted seeding for UI specs.
//
// `test-base.js` resets the harness to its canonical fixture before every test.
// That fixture is deliberately generic, so a spec that needs a specific shape —
// two Varieties differing only by Size, say — creates it here rather than
// bloating the shared fixture for everyone.
//
// Everything goes through the harness API on :3002, which is pglite in-process.
// `start-test-backend.js` force-sets DATABASE_URL=pglite:memory before any
// import and refuses to boot under NODE_ENV=production, so a spec cannot reach
// the production database even by accident.

const HARNESS = 'http://localhost:3002';
const OWNER_PIN = '1111';

async function api(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${HARNESS}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': OWNER_PIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Create a Stock Item carrying full Variety identity.
 *
 * NOTE the wire shape: POST /api/stock takes camelCase (`displayName`,
 * `typeName`, `sizeCm`), NOT the Airtable-style field names the GET responses
 * use. Mixing them up returns a 400 "displayName is required".
 */
export function seedVariety({
  displayName, typeName, colour = null, sizeCm = null, cultivar = null,
  quantity = 0, costPrice = 0, sellPrice = 0, lotSize = 0, supplier = '',
}) {
  return api('/api/stock', {
    body: {
      displayName, typeName, colour, sizeCm, cultivar,
      quantity, costPrice, sellPrice, lotSize, supplier, category: 'Other',
    },
  });
}

/**
 * Two Varieties that differ ONLY by Size, plus one unrelated Type.
 *
 * This is the shape the line form's re-resolution rule turns on (ADR-0014):
 * changing 60 → 70 must re-link to an existing card rather than invent a new
 * Variety, and changing Colour must detach because no such Variety exists.
 */
export async function seedPeonySizes() {
  const p60 = await seedVariety({
    displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink',
    sizeCm: 60, cultivar: 'Sarah B.', costPrice: 4.5, sellPrice: 14,
    lotSize: 10, supplier: 'Zielona',
  });
  const p70 = await seedVariety({
    displayName: 'Peony Pink 70cm', typeName: 'Peony', colour: 'Pink',
    sizeCm: 70, cultivar: 'Sarah B.', costPrice: 5.2, sellPrice: 16,
    lotSize: 10, supplier: 'Zielona',
  });
  const hydrangea = await seedVariety({
    displayName: 'Hydrangea Blue 70cm', typeName: 'Hydrangea', colour: 'Blue',
    sizeCm: 70, costPrice: 11, sellPrice: 32, lotSize: 5, supplier: 'FlorPol',
  });
  return { p60, p70, hydrangea };
}

/** Every Stock Item the owner can see, including empty + inactive rows. */
export function listStock() {
  return api('/api/stock?includeEmpty=true&includeInactive=true', { method: 'GET' });
}

/**
 * Create an order dated TODAY.
 *
 * The canonical fixture's three orders are dated 2026-04-28, which the
 * dashboard Orders tab filters out by default (its date range is
 * month-start → today). A spec that needs to open an order in BOTH apps has
 * to make its own, or it passes on the florist and finds an empty list on the
 * dashboard.
 */
export async function seedOrder({
  customer = 'recMockCust1', lines = [], deliveryType = 'Pickup',
  customerRequest = 'UI spec order',
} = {}) {
  const today = new Date();
  const requiredBy = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const created = await api('/api/orders', {
    body: {
      customer, customerRequest, source: 'In-store', deliveryType,
      orderLines: lines, paymentStatus: 'Unpaid', requiredBy,
    },
  });
  return created.order;
}

/** Create a Draft Stock Order and return it with its lines. */
export async function seedStockOrder(lines) {
  const created = await api('/api/stock-orders', { body: { lines } });
  const detail = await api(`/api/stock-orders/${created.id}`, { method: 'GET' });
  return detail;
}

/** Draft → Sent. */
export async function sendStockOrder(poId, driverName = 'Timur') {
  return api(`/api/stock-orders/${poId}/send`, { body: { driverName } });
}

/**
 * Sent → Shopping. There is no direct endpoint: the order flips when the driver
 * first touches a line's Driver Status, which is exactly why the delete/cancel
 * boundary sits there (ADR-0015).
 */
export async function startShopping(poId, lineId) {
  await api(`/api/stock-orders/${poId}/lines/${lineId}`, {
    method: 'PATCH',
    body: { 'Driver Status': 'Pending' },
  });
  return api(`/api/stock-orders/${poId}`, { method: 'GET' });
}

/**
 * Seed a minimal Delivery Order via the real API for the delivery-pricing
 * spec — no existing helper creates an Order (seed.js only covered Stock
 * Orders/stock items before this spec). Creates a throwaway customer first
 * (POST /api/orders requires an existing customer id).
 */
export async function seedOrder({ deliveryType = 'Delivery', address = '' } = {}) {
  const customer = await api('/api/customers', { body: { Name: 'E2E Delivery Pricing Customer' } });
  const body = {
    customer: customer.id,
    deliveryType,
    requiredBy: '2026-12-31',
    orderLines: [],
  };
  if (deliveryType === 'Delivery') {
    body.delivery = {
      address,
      recipientName: 'E2E Recipient',
      recipientPhone: '+48000000000',
      date: '2026-12-31',
      time: '',
      cardText: '',
    };
  }
  return api('/api/orders', { body });
}

export { api as harnessApi };
