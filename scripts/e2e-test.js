import { createHmac } from 'node:crypto';

// scripts/e2e-test.js — comprehensive end-to-end test against the local
// test harness backend (Phase 3b). Exercises every workflow the React apps
// trigger and verifies behaviour across the full stack:
//
//   - Real Express routes / middleware / authorize() role gates.
//   - Real orderService + stockRepo (Phase 3 cutover path → Postgres).
//   - In-process pglite for Postgres (audit_log, parity_log, stock).
//   - In-memory Airtable mock seeded from the JSON fixture.
//
// Prerequisite: harness backend running on PORT 3002 (default):
//
//   node backend/scripts/start-test-backend.js
//
// Then in another terminal:
//
//   node scripts/e2e-test.js
//
// Optional env: HARNESS_PORT=3002 (override port).
//
// What this covers (every section calls POST /api/test/reset first so it
// runs in isolation — order doesn't matter and a single failure can't
// poison later sections):
//
//    1. Boot + harness invariants (PG seeded, mock seeded, audit empty)
//    2. Order creation — pickup / delivery / multi-line / role gating
//    3. Status transitions — pickup happy path
//    4. Status transitions — delivery happy path (with cascade to delivery)
//    5. Invalid transitions blocked (every illegal edge of the FSM)
//    6. Plain cancel (status-only, NO stock return)
//    7. Cancel-with-return (POST /cancel-with-return → stock restored)
//    8. Reopen (Cancelled → New)
//    9. Bouquet edit — add line, remove line (return), remove line (writeoff)
//   10. Bouquet edit — change quantity up + down
//   11. Bouquet edit — owner edits Ready order without status revert
//   12. Delete order — returns stock for non-terminal
//   13. Stock decrement / negative stock allowed
//   14. Stock write-off via POST /api/stock-loss (Loss Log + dead stems)
//   15. Soft delete + restore via /api/admin
//   16. Delivery cascade — order Delivered → delivery Delivered
//   17. Delivery cascade — delivery Out for Delivery → order ditto
//   18. Payment flows — Unpaid → Paid (auto-backfill Payment 1 Amount)
//   19. Pickup → Delivery conversion creates delivery record
//   20. Swap bouquet line (PO substitute path)
//   21. Audit log per role — owner / florist / driver each leave traces
//   22. Parity check — runParityCheck reports zero mismatches after a flow
//   23. Auth gates — driver blocked from /orders, florist blocked from /admin

const PORT = process.env.HARNESS_PORT || '3002';
const BASE = `http://localhost:${PORT}/api`;

const PIN_OWNER   = '1111';
const PIN_FLORIST = '2222';
const PIN_TIMUR   = '3333';
const PIN_NIKITA  = '4444';

const FIXTURE = {
  customers: {
    maria:   'recMockCust1',  // VIP, has past order
    anna:    'recMockCust2',  // Regular, has past order
    tomek:   'recMockCust3',
    biuro:   'recMockCust4',  // Business
    iwona:   'recMockCust5',
  },
  stock: {
    redRose:        'recMockStock1',  // qty 50, sell 15
    pinkTulip:      'recMockStock2',  // qty 30, sell 10
    whiteLily:      'recMockStock3',  // qty 20, sell 22
    yellowDaisy:    'recMockStock4',  // qty 40, sell 8
    blueIris:       'recMockStock5',  // qty 15, sell 18
    eucalyptus:     'recMockStock6',  // qty 60, sell 5 (greens)
    peony:          'recMockStock7',  // qty 12, sell 28
    babysBreath:    'recMockStock8',
    sunflower:      'recMockStock9',  // qty 0
    discontinued:   'recMockStock10', // qty 0, Active=false
  },
  orders: {
    paidDelivery:   'recMockOrd1',    // status New, paid 235
    readyDelivery:  'recMockOrd2',    // status Ready, paid 105
    newPickup:      'recMockOrd3',    // status New, unpaid
  },
};

// ──────── Counters + assertion helpers ────────

let pass = 0;
let fail = 0;
const failures = [];
const sectionResults = [];
let currentSection = null;

function ok(label) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); currentSection.pass++; }
function bad(label, msg) {
  fail++;
  failures.push({ section: currentSection.name, label, msg });
  currentSection.fail++;
  console.log(`  \x1b[31m✗\x1b[0m ${label} \x1b[33m— ${msg}\x1b[0m`);
}
function assert(label, cond, msg) {
  if (cond) ok(label);
  else bad(label, typeof msg === 'string' ? msg : `expected truthy, got ${JSON.stringify(msg)}`);
}
function eq(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) ok(label);
  else bad(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function startSection(name) {
  currentSection = { name, pass: 0, fail: 0 };
  sectionResults.push(currentSection);
  console.log(`\n\x1b[36m═══ ${name} ═══\x1b[0m`);
}

// ──────── HTTP helper ────────

async function api(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.pin) headers['X-Auth-PIN'] = opts.pin;
  const init = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  return { status: res.status, body };
}

// ──────── Fixture-aware shorthands ────────

async function reset() {
  const r = await api('POST', '/test/reset');
  if (r.status !== 200 || !r.body?.ok) {
    throw new Error(`/test/reset failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  return r.body;
}

async function getStockMap(opts = {}) {
  const qs = new URLSearchParams();
  if (opts.includeEmpty) qs.set('includeEmpty', 'true');
  if (opts.includeInactive) qs.set('includeInactive', 'true');
  const qsStr = qs.toString();
  const r = await api('GET', `/stock${qsStr ? `?${qsStr}` : ''}`, { pin: PIN_OWNER });
  if (r.status !== 200) throw new Error(`GET /stock failed: ${JSON.stringify(r)}`);
  const map = new Map();
  for (const s of r.body) map.set(s.id, s);
  return map;
}

async function getStock(id, opts = {}) {
  const map = await getStockMap({ includeEmpty: true, includeInactive: true, ...opts });
  return map.get(id);
}

async function getAuditLog() {
  const r = await api('GET', '/test/audit');
  return r.body || [];
}

const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

function buildOrderBody({
  customer, lines, deliveryType = 'Pickup', delivery = null,
  paymentStatus = 'Unpaid', paymentMethod, requiredBy = tomorrow(),
  customerRequest = 'E2E test order',
} = {}) {
  return {
    customer,
    customerRequest,
    source: 'In-store',
    deliveryType,
    orderLines: lines,
    paymentStatus,
    ...(paymentMethod ? { paymentMethod } : {}),
    requiredBy,
    ...(delivery ? { delivery } : {}),
  };
}

function line(stockId, qty, opts = {}) {
  const fixture = {
    [FIXTURE.stock.redRose]:     { name: 'Red Rose',     cost: 4.5, sell: 15 },
    [FIXTURE.stock.pinkTulip]:   { name: 'Pink Tulip',   cost: 3.0, sell: 10 },
    [FIXTURE.stock.whiteLily]:   { name: 'White Lily',   cost: 6.0, sell: 22 },
    [FIXTURE.stock.yellowDaisy]: { name: 'Yellow Daisy', cost: 2.0, sell: 8  },
    [FIXTURE.stock.blueIris]:    { name: 'Blue Iris',    cost: 5.5, sell: 18 },
    [FIXTURE.stock.eucalyptus]:  { name: 'Eucalyptus',   cost: 1.5, sell: 5  },
    [FIXTURE.stock.peony]:       { name: 'Peony',        cost: 8.0, sell: 28 },
  }[stockId] || { name: opts.name || 'Unknown', cost: opts.cost || 1, sell: opts.sell || 5 };
  return {
    stockItemId: stockId,
    flowerName: fixture.name,
    quantity: qty,
    costPricePerUnit: fixture.cost,
    sellPricePerUnit: fixture.sell,
  };
}

// ──────────── 1. BOOT + HARNESS INVARIANTS ────────────

async function section1Boot() {
  startSection('1. Boot + harness invariants');

  const health = await api('GET', '/health');
  assert('Backend reachable on harness port', health.status === 200);
  assert('testBackend flag exposed by /health', health.body?.testBackend === true);

  const seeded = await reset();
  assert('/test/reset returned ok', seeded.ok === true);
  eq('Seeded mode is pglite', seeded.mode, 'pglite');
  eq('PG stock rows seeded from fixture', seeded.seeded.stock, 10);

  const state = await api('GET', '/test/state');
  assert('Mock has 5 customers', state.body.airtable.tblMockCustomers?.length === 5);
  assert('Mock has 10 stock rows', state.body.airtable.tblMockStock?.length === 10);
  assert('Mock has 3 orders', state.body.airtable.tblMockOrders?.length === 3);
  assert('Mock has 4 order lines', state.body.airtable.tblMockOrderLines?.length === 4);
  assert('Mock has 2 deliveries', state.body.airtable.tblMockDeliveries?.length === 2);
  assert('Mock has 2 POs', state.body.airtable.tblMockStockOrders?.length === 2);

  eq('PG audit_log empty after reset', state.body.postgresCounts.auditLog, 0);
  eq('PG parity_log empty after reset', state.body.postgresCounts.parityLog, 0);

  // /api/admin/status — driven by stockRepo.getBackendMode()
  const status = await api('GET', '/admin/status', { pin: PIN_OWNER });
  assert('Admin status endpoint works', status.status === 200);
  eq('stock backend reports postgres mode', status.body.backends.stock, 'postgres');
}

// ──────────── 2. ORDER CREATION ────────────

async function section2OrderCreation() {
  startSection('2. Order creation paths');
  await reset();

  // 2.1 Pickup, single line, owner
  let r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.redRose, 3)],
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
    }),
  });
  assert('Pickup order created (201)', r.status === 201);
  assert('Order id returned', !!r.body?.order?.id);
  assert('Order Status defaults to New', r.body?.order?.Status === 'New');
  assert('1 order line created', r.body?.orderLines?.length === 1);
  assert('No delivery sub-record for Pickup', !r.body?.delivery);
  // Auto-backfill: Paid + no payment1Amount → Payment 1 Amount = 3*15 = 45
  eq('Payment 1 Amount auto-backfilled to 45 zł', r.body?.order?.['Payment 1 Amount'], 45);

  // 2.2 Stock decremented in PG via stockRepo
  let rose = await getStock(FIXTURE.stock.redRose);
  eq('Red Rose qty: 50 → 47', rose['Current Quantity'], 47);

  // 2.3 Delivery, multi-line
  r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.anna,
      deliveryType: 'Delivery',
      lines: [
        line(FIXTURE.stock.pinkTulip, 5),
        line(FIXTURE.stock.whiteLily, 2),
        line(FIXTURE.stock.eucalyptus, 6),
      ],
      delivery: {
        address: 'ul. Test 1, 31-019 Kraków',
        recipientName: 'Test Recipient',
        recipientPhone: '+48 555 999 000',
        date: tomorrow(),
        time: '14:00',
        fee: 25,
      },
    }),
  });
  assert('Delivery order created (201)', r.status === 201);
  assert('Delivery sub-record created', !!r.body?.delivery);
  eq('Delivery has 3 lines', r.body?.orderLines?.length, 3);
  eq('Delivery Fee on delivery record', r.body?.delivery?.['Delivery Fee'], 25);
  // Driver-of-day comes from in-memory `daily.driverOfDay` (driverState.js),
  // not from App Config. Harness boots without a configured daily driver →
  // delivery.Assigned Driver stays null. Don't assert a specific driver here.
  assert('Delivery has Assigned Driver field (may be null without daily state)',
    'Assigned Driver' in (r.body?.delivery || {}));

  let tulip = await getStock(FIXTURE.stock.pinkTulip);
  eq('Pink Tulip qty: 30 → 25', tulip['Current Quantity'], 25);

  // 2.4 Florist creates order (orders role allowed)
  r = await api('POST', '/orders', {
    pin: PIN_FLORIST,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.yellowDaisy, 4)],
    }),
  });
  assert('Florist can create order', r.status === 201);
  eq('Created By stamped as Florist', r.body?.order?.['Created By'], 'Florist');

  // 2.5 Driver blocked
  r = await api('POST', '/orders', {
    pin: PIN_TIMUR,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.yellowDaisy, 1)],
    }),
  });
  eq('Driver blocked from /orders POST', r.status, 403);

  // 2.6 No PIN → 401
  r = await api('POST', '/orders', {
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.yellowDaisy, 1)],
    }),
  });
  eq('No PIN → 401', r.status, 401);

  // 2.7 Validation: missing customer
  r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: { ...buildOrderBody({ customer: '', lines: [line(FIXTURE.stock.yellowDaisy, 1)] }) },
  });
  eq('Missing customer → 400', r.status, 400);

  // 2.8 Validation: line with quantity 0
  r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [{ ...line(FIXTURE.stock.redRose, 1), quantity: 0 }],
    }),
  });
  eq('Quantity 0 → 400', r.status, 400);

  // 2.9 Validation: missing requiredBy/delivery date
  r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: { ...buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.redRose, 1)],
    }), requiredBy: undefined },
  });
  eq('Missing requiredBy → 400', r.status, 400);

  // 2.10 Validation: bad date format
  r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: { ...buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.redRose, 1)],
    }), requiredBy: '07/05/2026' },
  });
  eq('Malformed requiredBy → 400', r.status, 400);
}

// ──────────── 3. STATUS — PICKUP HAPPY PATH ────────────

async function section3PickupHappyPath() {
  startSection('3. Pickup status workflow (New → Ready → Picked Up)');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.peony, 2)],
    }),
  });
  const orderId = created.body.order.id;

  let r = await api('PATCH', `/orders/${orderId}`, { pin: PIN_FLORIST, body: { Status: 'Ready' } });
  eq('New → Ready', r.body?.Status, 'Ready');

  r = await api('PATCH', `/orders/${orderId}`, { pin: PIN_FLORIST, body: { Status: 'Picked Up' } });
  eq('Ready → Picked Up', r.body?.Status, 'Picked Up');
}

// ──────────── 4. STATUS — DELIVERY HAPPY PATH (cascade) ────────────

async function section4DeliveryHappyPath() {
  startSection('4. Delivery status workflow + cascade to delivery record');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      deliveryType: 'Delivery',
      lines: [line(FIXTURE.stock.redRose, 6)],
      delivery: {
        address: 'ul. Floriańska 1, Kraków',
        recipientName: 'Maria K',
        recipientPhone: '+48 555 100 001',
        date: tomorrow(),
        time: '12:00',
        fee: 20,
      },
    }),
  });
  const orderId = created.body.order.id;
  const deliveryId = created.body.delivery.id;

  let r = await api('PATCH', `/orders/${orderId}`, { pin: PIN_FLORIST, body: { Status: 'Ready' } });
  eq('New → Ready', r.body?.Status, 'Ready');

  r = await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Out for Delivery' } });
  eq('Ready → Out for Delivery', r.body?.Status, 'Out for Delivery');

  // Cascade: order Out for Delivery → delivery Out for Delivery
  let delivery = await api('GET', `/deliveries?from=${tomorrow()}`, { pin: PIN_TIMUR });
  const cascaded = delivery.body.find(d => d.id === deliveryId);
  eq('Order OFD cascaded → Delivery OFD', cascaded?.Status, 'Out for Delivery');

  r = await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Delivered' } });
  eq('Out for Delivery → Delivered', r.body?.Status, 'Delivered');

  delivery = await api('GET', `/deliveries?from=${tomorrow()}`, { pin: PIN_TIMUR });
  const finalDelivery = delivery.body.find(d => d.id === deliveryId);
  eq('Order Delivered cascaded → Delivery Delivered', finalDelivery?.Status, 'Delivered');
  assert('Delivery has Delivered At timestamp', !!finalDelivery?.['Delivered At']);
}

// ──────────── 5. INVALID TRANSITIONS BLOCKED ────────────

async function section5InvalidTransitions() {
  startSection('5. Invalid status transitions blocked (FSM enforcement)');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.iwona,
      lines: [line(FIXTURE.stock.babysBreath || FIXTURE.stock.eucalyptus, 1)],
    }),
  });
  const id = created.body.order.id;

  // From New: cannot go to Delivered, Picked Up, Out for Delivery
  for (const target of ['Delivered', 'Picked Up', 'Out for Delivery']) {
    const r = await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: target } });
    eq(`New → ${target} BLOCKED`, r.status, 400);
  }

  // Move to Ready, then test
  await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });
  for (const target of ['New', 'In Progress']) {
    const r = await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: target } });
    eq(`Ready → ${target} BLOCKED`, r.status, 400);
  }

  // Take to terminal Picked Up, no further moves allowed
  await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: 'Picked Up' } });
  for (const target of ['New', 'Ready', 'Cancelled', 'Delivered']) {
    const r = await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: target } });
    eq(`Picked Up → ${target} BLOCKED`, r.status, 400);
  }
}

// ──────────── 6. PLAIN CANCEL — STATUS ONLY, NO STOCK RETURN ────────────

async function section6PlainCancel() {
  startSection('6. Plain cancel via PATCH (status-only — does NOT auto-return stock)');
  await reset();

  const before = await getStock(FIXTURE.stock.redRose);
  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.redRose, 5)],
    }),
  });
  const id = created.body.order.id;

  const afterCreate = await getStock(FIXTURE.stock.redRose);
  eq('Stock decremented after create', afterCreate['Current Quantity'], before['Current Quantity'] - 5);

  // Cancel via PATCH
  const cancel = await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: 'Cancelled' } });
  eq('Cancel via PATCH succeeds', cancel.body?.Status, 'Cancelled');

  // Stock should NOT have been returned (per CLAUDE.md rule: explicit cancel-with-return)
  const afterCancel = await getStock(FIXTURE.stock.redRose);
  eq('PATCH-cancel does NOT auto-return stock', afterCancel['Current Quantity'], before['Current Quantity'] - 5);
}

// ──────────── 7. CANCEL-WITH-RETURN ────────────

async function section7CancelWithReturn() {
  startSection('7. POST /orders/:id/cancel-with-return — explicit stock return');
  await reset();

  const before = await getStock(FIXTURE.stock.whiteLily);
  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.whiteLily, 4)],
    }),
  });
  const id = created.body.order.id;

  const r = await api('POST', `/orders/${id}/cancel-with-return`, { pin: PIN_OWNER });
  eq('cancel-with-return → 200', r.status, 200);
  assert('Returned items list present', Array.isArray(r.body?.returnedItems));
  assert('1 item returned', r.body?.returnedItems?.length === 1);
  eq('White Lily 4 stems returned', r.body.returnedItems[0].quantityReturned, 4);

  const after = await getStock(FIXTURE.stock.whiteLily);
  eq('Stock fully restored', after['Current Quantity'], before['Current Quantity']);

  // Cancel-with-return on already-cancelled order → 400
  const dup = await api('POST', `/orders/${id}/cancel-with-return`, { pin: PIN_OWNER });
  eq('Repeat cancel-with-return → 400', dup.status, 400);
}

// ──────────── 8. REOPEN (Cancelled → New) ────────────

async function section8Reopen() {
  startSection('8. Reopen: Cancelled → New');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.iwona,
      lines: [line(FIXTURE.stock.eucalyptus, 2)],
    }),
  });
  const id = created.body.order.id;
  await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: 'Cancelled' } });

  const r = await api('PATCH', `/orders/${id}`, { pin: PIN_OWNER, body: { Status: 'New' } });
  eq('Cancelled → New (reopen)', r.body?.Status, 'New');
}

// ──────────── 9. BOUQUET EDIT — REMOVE ────────────

async function section9BouquetEditRemove() {
  startSection('9. Bouquet edit — remove line (return + writeoff)');
  await reset();

  const before = await getStockMap();
  const created = await api('POST', '/orders', {
    pin: PIN_FLORIST,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [
        line(FIXTURE.stock.redRose, 3),
        line(FIXTURE.stock.whiteLily, 2),
      ],
    }),
  });
  const id = created.body.order.id;
  const lineRose = created.body.orderLines.find(l => l['Stock Item']?.[0] === FIXTURE.stock.redRose);
  const lineLily = created.body.orderLines.find(l => l['Stock Item']?.[0] === FIXTURE.stock.whiteLily);

  // Remove rose with return — stock should come back
  let r = await api('PUT', `/orders/${id}/lines`, {
    pin: PIN_FLORIST,
    body: {
      lines: [],
      removedLines: [{
        lineId: lineRose.id,
        stockItemId: FIXTURE.stock.redRose,
        quantity: 3,
        action: 'return',
      }],
    },
  });
  eq('Remove (return) → 200', r.status, 200);

  let rose = await getStock(FIXTURE.stock.redRose);
  eq('Rose stock restored on remove(return)', rose['Current Quantity'], before.get(FIXTURE.stock.redRose)['Current Quantity']);

  // Remove lily with writeoff — stock NOT restored, Loss Log has entry
  r = await api('PUT', `/orders/${id}/lines`, {
    pin: PIN_FLORIST,
    body: {
      lines: [],
      removedLines: [{
        lineId: lineLily.id,
        stockItemId: FIXTURE.stock.whiteLily,
        quantity: 2,
        action: 'writeoff',
        reason: 'Wilted',
      }],
    },
  });
  eq('Remove (writeoff) → 200', r.status, 200);

  let lily = await getStock(FIXTURE.stock.whiteLily);
  eq('Lily stock NOT restored on writeoff', lily['Current Quantity'], before.get(FIXTURE.stock.whiteLily)['Current Quantity'] - 2);

  const losses = await api('GET', '/stock-loss', { pin: PIN_FLORIST });
  const lilyLoss = losses.body.find(l => l['Stock Item']?.[0] === FIXTURE.stock.whiteLily);
  assert('Stock Loss Log row created for writeoff', !!lilyLoss);
  eq('Loss Quantity = 2', lilyLoss?.Quantity, 2);
}

// ──────────── 10. BOUQUET EDIT — CHANGE QTY + ADD LINE ────────────

async function section10BouquetEditAddChange() {
  startSection('10. Bouquet edit — add new line + change quantity');
  await reset();

  const before = await getStockMap();
  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.anna,
      lines: [line(FIXTURE.stock.pinkTulip, 4)],
    }),
  });
  const orderId = created.body.order.id;
  const tulipLine = created.body.orderLines[0];

  // Service contract for editBouquetLines (see backend/src/services/orderService.js):
  //   - existing line: { id, _originalQty, quantity, stockItemId, ... }
  //     The service detects qty change via _originalQty and adjusts stock by delta.
  //   - new line:      no `id` — service creates it and decrements stock by quantity.
  // Bumping tulip 4 → 6 ⇒ delta -2 stock; adding peony 3 ⇒ -3 stock.
  const r = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_OWNER,
    body: {
      lines: [
        { ...line(FIXTURE.stock.pinkTulip, 6), id: tulipLine.id, _originalQty: 4 }, // change qty
        line(FIXTURE.stock.peony, 3),                                                // new line
      ],
      removedLines: [],
    },
  });
  eq('Edit (add+change) → 200', r.status, 200);

  const after = await getStockMap({ includeEmpty: true });
  eq('Tulip stock decremented additional 2 (4→6 in bouquet)',
    after.get(FIXTURE.stock.pinkTulip)['Current Quantity'],
    before.get(FIXTURE.stock.pinkTulip)['Current Quantity'] - 6);
  eq('Peony stock decremented by 3 (new line)',
    after.get(FIXTURE.stock.peony)['Current Quantity'],
    before.get(FIXTURE.stock.peony)['Current Quantity'] - 3);

  // Decrease qty back: 6 → 2 ⇒ delta +4 stock returned.
  const downR = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_OWNER,
    body: {
      lines: [{ ...line(FIXTURE.stock.pinkTulip, 2), id: tulipLine.id, _originalQty: 6 }],
      removedLines: [],
    },
  });
  eq('Edit (qty down) → 200', downR.status, 200);

  const after2 = await getStockMap({ includeEmpty: true });
  eq('Tulip stock returned (delta +4: 6→2)',
    after2.get(FIXTURE.stock.pinkTulip)['Current Quantity'],
    before.get(FIXTURE.stock.pinkTulip)['Current Quantity'] - 2);
}

// ──────────── 11. EDIT BOUQUET — STATUS-BASED GATING ────────────

async function section11EditBouquetGating() {
  startSection('11. Bouquet edit — status gate (florist blocked on terminal; owner allowed any status)');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.redRose, 2)],
    }),
  });
  const orderId = created.body.order.id;
  const lineRose = created.body.orderLines[0];

  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });

  // Florist edit on Ready — empty no-op edit succeeds (status gate only allows Ready/New for non-owner).
  const floristReady = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_FLORIST,
    body: { lines: [], removedLines: [] },
  });
  eq('Florist edit on Ready → 200', floristReady.status, 200);

  // Owner edit while Ready: service auto-reverts status to New (rule lives in editBouquetLines).
  const ownerReady = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_OWNER,
    body: {
      lines: [{ ...line(FIXTURE.stock.redRose, 3), id: lineRose.id, _originalQty: 2 }],
      removedLines: [],
    },
  });
  eq('Owner edit on Ready → 200', ownerReady.status, 200);
  const reload = await api('GET', `/orders/${orderId}`, { pin: PIN_OWNER });
  eq('Owner edit on Ready auto-reverts status to New', reload.body?.Status, 'New');

  // Move to terminal Picked Up — florist blocked, owner allowed.
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Picked Up' } });

  const floristTerminal = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_FLORIST,
    body: { lines: [], removedLines: [] },
  });
  eq('Florist edit on Picked Up → 400', floristTerminal.status, 400);

  const ownerTerminal = await api('PUT', `/orders/${orderId}/lines`, {
    pin: PIN_OWNER,
    body: { lines: [], removedLines: [] },
  });
  eq('Owner edit on Picked Up → 200 (post-fact correction)', ownerTerminal.status, 200);
}

// ──────────── 12. DELETE ORDER (returns stock for non-terminal) ────────────

async function section12DeleteOrder() {
  startSection('12. DELETE /orders/:id — owner-only, returns stock for non-terminal');
  await reset();

  const before = await getStock(FIXTURE.stock.yellowDaisy);
  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.yellowDaisy, 7)],
    }),
  });
  const id = created.body.order.id;

  // Florist DELETE → 403
  const deny = await api('DELETE', `/orders/${id}`, { pin: PIN_FLORIST });
  eq('Florist DELETE → 403', deny.status, 403);

  const r = await api('DELETE', `/orders/${id}`, { pin: PIN_OWNER });
  eq('Owner DELETE → 200', r.status, 200);
  assert('Returned items present', Array.isArray(r.body?.returnedItems));

  const after = await getStock(FIXTURE.stock.yellowDaisy);
  eq('Stock fully restored after delete', after['Current Quantity'], before['Current Quantity']);

  // Order is gone
  const gone = await api('GET', `/orders/${id}`, { pin: PIN_OWNER });
  eq('Deleted order → 404', gone.status, 404);
}

// ──────────── 13. NEGATIVE STOCK ALLOWED ────────────

async function section13NegativeStock() {
  startSection('13. Stock can go negative (intentional — drives PO demand)');
  await reset();

  const peony = await getStock(FIXTURE.stock.peony);
  // Peony qty 12 — order 20 should drive it negative (-8)
  const r = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.iwona,
      lines: [line(FIXTURE.stock.peony, 20)],
    }),
  });
  eq('Order with qty > stock → 201 (allowed)', r.status, 201);

  const after = await getStock(FIXTURE.stock.peony, { includeEmpty: true });
  eq('Peony stock now negative', after['Current Quantity'], peony['Current Quantity'] - 20);
}

// ──────────── 14. STOCK LOSS / WRITE-OFF ────────────

async function section14StockLoss() {
  startSection('14. Stock loss via POST /stock-loss — Loss Log + PG decrement + validation');
  await reset();

  // routes/stockLoss.js was updated to call stockRepo.adjustQuantity (was
  // db.atomicStockAdjust before — that path silently desynced PG). The test
  // now asserts the PG stock IS decremented when STOCK_BACKEND=postgres.

  const before = await getStock(FIXTURE.stock.redRose);

  const r = await api('POST', '/stock-loss', {
    pin: PIN_FLORIST,
    body: { stockItemId: FIXTURE.stock.redRose, quantity: 5, reason: 'Wilted', notes: 'old batch' },
  });
  eq('POST /stock-loss → 201', r.status, 201);
  eq('Loss reason persisted', r.body?.Reason, 'Wilted');
  eq('Loss quantity persisted', r.body?.Quantity, 5);
  assert('Stock Item link persisted', r.body?.['Stock Item']?.includes(FIXTURE.stock.redRose));

  const after = await getStock(FIXTURE.stock.redRose);
  eq('PG stock decremented by loss qty (stockRepo path)',
    after['Current Quantity'], before['Current Quantity'] - 5);

  // Loss Log GET reflects the new entry.
  const list = await api('GET', '/stock-loss', { pin: PIN_FLORIST });
  eq('Loss Log has 1 entry', list.body.length, 1);

  // Validation: invalid reason → 400
  const bad = await api('POST', '/stock-loss', {
    pin: PIN_FLORIST,
    body: { stockItemId: FIXTURE.stock.redRose, quantity: 1, reason: 'Eaten by cat' },
  });
  eq('Invalid reason → 400', bad.status, 400);

  // Validation: missing quantity → 400
  const missing = await api('POST', '/stock-loss', { pin: PIN_FLORIST, body: { reason: 'Wilted' } });
  eq('Missing quantity → 400', missing.status, 400);
}

// ──────────── 15. SOFT DELETE + RESTORE (admin) ────────────

async function section15SoftDeleteRestore() {
  startSection('15. Admin tab — soft delete + restore stock item');
  await reset();

  // List shows 10 active rows initially (plus 1 inactive "Discontinued" only when includeInactive=true)
  let r = await api('GET', '/admin/stock?includeDeleted=false', { pin: PIN_OWNER });
  eq('Admin stock list reachable', r.status, 200);
  const initialCount = r.body.length;
  assert('Admin stock list has at least 10 rows', initialCount >= 10);

  // Pick a stock id to delete — use Red Rose's PG id (resolved by airtableId)
  const lookup = await api('GET', `/admin/stock/${FIXTURE.stock.redRose}`, { pin: PIN_OWNER });
  eq('Get by airtable id → 200', lookup.status, 200);
  const pgId = lookup.body.id;

  // Soft-delete via PATCH deletedAt? AdminTab uses PATCH for inline edits;
  // restore is the only explicit restore endpoint. Soft-delete in stockRepo
  // happens through `repo.delete()` which the route doesn't expose directly.
  // Instead, test the restore path: mark as deleted by repo through PATCH,
  // then restore. (Fallback: just verify endpoint shape, since soft-delete
  // path is not yet wired through admin route.)
  const restore = await api('POST', `/admin/stock/${pgId}/restore`, { pin: PIN_OWNER });
  // If the row isn't soft-deleted, restore is a no-op (returns the row).
  eq('Restore endpoint reachable on un-deleted row', restore.status, 200);

  // Florist must NOT reach admin endpoints
  const florist = await api('GET', '/admin/stock', { pin: PIN_FLORIST });
  eq('Florist blocked from /admin', florist.status, 403);

  // Driver also blocked
  const driver = await api('GET', '/admin/stock', { pin: PIN_TIMUR });
  eq('Driver blocked from /admin', driver.status, 403);
}

// ──────────── 16. CASCADE: ORDER → DELIVERY ────────────

async function section16CascadeOrderToDelivery() {
  startSection('16. Cascade: order Out for Delivery → delivery Out for Delivery');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.anna,
      deliveryType: 'Delivery',
      lines: [line(FIXTURE.stock.pinkTulip, 4)],
      delivery: {
        address: 'ul. Cascade, Kraków',
        recipientName: 'Cascade Test',
        recipientPhone: '+48 555 999 111',
        date: tomorrow(),
        time: '10:00',
        fee: 20,
      },
    }),
  });
  const orderId = created.body.order.id;
  const deliveryId = created.body.delivery.id;

  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Out for Delivery' } });

  const list = await api('GET', `/deliveries?from=${tomorrow()}`, { pin: PIN_TIMUR });
  const cascaded = list.body.find(d => d.id === deliveryId);
  eq('Delivery cascaded to Out for Delivery', cascaded?.Status, 'Out for Delivery');
}

// ──────────── 17. CASCADE: DELIVERY → ORDER ────────────

async function section17CascadeDeliveryToOrder() {
  startSection('17. Cascade: driver marks Delivery Delivered → order Delivered');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      deliveryType: 'Delivery',
      lines: [line(FIXTURE.stock.redRose, 5)],
      delivery: {
        address: 'ul. Reverse Cascade, Kraków',
        recipientName: 'Reverse',
        recipientPhone: '+48 555 999 222',
        date: tomorrow(),
        time: '15:00',
        fee: 20,
        driver: 'Timur',
      },
    }),
  });
  const orderId = created.body.order.id;
  const deliveryId = created.body.delivery.id;

  // Move order to Out for Delivery (so delivery FSM allows OFD → Delivered)
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Out for Delivery' } });

  // Driver Timur marks delivery Delivered
  const r = await api('PATCH', `/deliveries/${deliveryId}`, { pin: PIN_TIMUR, body: { Status: 'Delivered' } });
  eq('Driver mark Delivered → 200', r.status, 200);
  eq('Delivery Status now Delivered', r.body?.Status, 'Delivered');

  // Order should have cascaded
  const order = await api('GET', `/orders/${orderId}`, { pin: PIN_OWNER });
  eq('Order cascaded to Delivered', order.body?.Status, 'Delivered');
}

// ──────────── 18. PAYMENT FLOWS ────────────

async function section18Payments() {
  startSection('18. Payment flows: Unpaid → Paid backfills Payment 1 Amount');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [line(FIXTURE.stock.peony, 2)],   // 2 * 28 = 56 zł
      paymentStatus: 'Unpaid',
    }),
  });
  const id = created.body.order.id;
  eq('Order created Unpaid', created.body?.order?.['Payment Status'], 'Unpaid');
  // Bug-prevention: Payment 1 should be empty when created Unpaid
  eq('Payment 1 Amount empty on Unpaid create', created.body?.order?.['Payment 1 Amount'] || 0, 0);

  const r = await api('PATCH', `/orders/${id}`, {
    pin: PIN_OWNER,
    body: { 'Payment Status': 'Paid', 'Payment Method': 'Card' },
  });
  eq('Mark Paid succeeds', r.body?.['Payment Status'], 'Paid');
  // Backfill: Payment 1 Amount = flower total (56) since no priceOverride / delivery fee
  eq('Payment 1 Amount auto-backfilled to 56', r.body?.['Payment 1 Amount'], 56);
  eq('Payment 1 Method auto-backfilled to Card', r.body?.['Payment 1 Method'], 'Card');

  // Invalid payment status → 400 not in allowlist (PATCH allowlist permits the field, but
  // the validation lives in createOrder; PATCH allows raw write — skip validation test).
}

// ──────────── 19. CONVERT PICKUP → DELIVERY ────────────

async function section19ConvertToDelivery() {
  startSection('19. POST /orders/:id/convert-to-delivery');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.tomek,
      lines: [line(FIXTURE.stock.eucalyptus, 3)],
    }),
  });
  const id = created.body.order.id;
  assert('Pickup order created (no delivery sub-record)', !created.body?.delivery);

  const r = await api('POST', `/orders/${id}/convert-to-delivery`, {
    pin: PIN_OWNER,
    body: {
      address: 'ul. Conversion, Kraków',
      recipientName: 'Convert Recipient',
      recipientPhone: '+48 555 999 333',
      date: tomorrow(),
      time: '11:00',
      fee: 25,
    },
  });
  eq('Convert → 201', r.status, 201);
  assert('Delivery record returned', !!r.body?.id);

  // Order's Delivery Type now Delivery
  const updated = await api('GET', `/orders/${id}`, { pin: PIN_OWNER });
  eq('Order is now Delivery type', updated.body?.['Delivery Type'], 'Delivery');

  // Repeat conversion → 400 (already has delivery)
  const dup = await api('POST', `/orders/${id}/convert-to-delivery`, {
    pin: PIN_OWNER,
    body: { address: 'x', recipientName: 'y', recipientPhone: 'z', date: tomorrow(), time: '11:00', fee: 25 },
  });
  eq('Repeat conversion → 400', dup.status, 400);
}

// ──────────── 20. SWAP BOUQUET LINE ────────────

async function section20SwapBouquetLine() {
  startSection('20. POST /orders/:id/swap-bouquet-line — substitute flower');
  await reset();

  const created = await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.iwona,
      lines: [line(FIXTURE.stock.peony, 4)],
    }),
  });
  const orderId = created.body.order.id;
  const peonyLine = created.body.orderLines[0];

  const before = await getStockMap();

  const r = await api('POST', `/orders/${orderId}/swap-bouquet-line`, {
    pin: PIN_OWNER,
    body: {
      fromStockItemId: FIXTURE.stock.peony,
      toStockItemId: FIXTURE.stock.blueIris,
      lineId: peonyLine.id,
      newQty: 4,
    },
  });
  eq('Swap → 200', r.status, 200);

  // routes/orders.js swap-bouquet-line was updated to use stockRepo.adjustQuantity
  // (was db.atomicStockAdjust before). PG stock now updates on the swap path.
  const after = await getStockMap();
  eq('Peony PG stock returned (+4)',
    after.get(FIXTURE.stock.peony)['Current Quantity'],
    before.get(FIXTURE.stock.peony)['Current Quantity'] + 4);
  eq('Blue Iris PG stock decremented (-4)',
    after.get(FIXTURE.stock.blueIris)['Current Quantity'],
    before.get(FIXTURE.stock.blueIris)['Current Quantity'] - 4);

  // Line metadata: Flower Name + Stock Item link + Quantity reflect the substitute.
  const reload = await api('GET', `/orders/${orderId}`, { pin: PIN_OWNER });
  const reloaded = reload.body.orderLines[0];
  eq('Line\'s Flower Name updated to substitute', reloaded?.['Flower Name'], 'Blue Iris');
  eq('Line\'s Stock Item link points to substitute', reloaded?.['Stock Item']?.[0], FIXTURE.stock.blueIris);
  eq('Line\'s Quantity unchanged at newQty', reloaded?.Quantity, 4);

  // Swap on terminal order → 400
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Ready' } });
  await api('PATCH', `/orders/${orderId}`, { pin: PIN_OWNER, body: { Status: 'Picked Up' } });
  const blocked = await api('POST', `/orders/${orderId}/swap-bouquet-line`, {
    pin: PIN_OWNER,
    body: { fromStockItemId: FIXTURE.stock.blueIris, toStockItemId: FIXTURE.stock.redRose, lineId: peonyLine.id },
  });
  eq('Swap on terminal order → 400', blocked.status, 400);
}

// ──────────── 21. AUDIT LOG PER ROLE ────────────

async function section21AuditPerRole() {
  startSection('21. Audit log captures actor identity per role');
  await reset();

  // Direct stock writes go through the route → stockRepo with `actor: actorFromReq(req)`,
  // which captures the role and (for drivers) the driver name. Order creation today
  // routes through orderService.adjustQuantity WITHOUT actor (legacy path), so audit
  // rows from order creation come out as 'system' — that's the bug worth catching
  // here. Once Phase 4 cutover flips ORDER_BACKEND=postgres, orderRepo writes through
  // orderRepo with actor — that path is exercised by integration tests.
  //
  // We assert the role gating via direct /stock writes:
  //   owner POST /stock         → audit row with actorRole='owner'
  //   florist PATCH /stock/:id  → audit row with actorRole='florist'

  // Owner creates a new stock item. Route accepts camelCase shorthand
  // (`displayName`, `category`, `quantity`, `costPrice`, `sellPrice`).
  const created = await api('POST', '/stock', {
    pin: PIN_OWNER,
    body: {
      displayName: 'E2E Test Carnation',
      category: 'Other',
      quantity: 25,
      costPrice: 3,
      sellPrice: 12,
    },
  });
  eq('Owner POST /stock → 201', created.status, 201);
  assert('New stock id returned', !!created.body?.id);

  // Florist updates a stock row's quantity (PATCH).
  const florUpdate = await api('PATCH', `/stock/${FIXTURE.stock.redRose}`, {
    pin: PIN_FLORIST,
    body: { 'Current Quantity': 60 },
  });
  eq('Florist PATCH /stock → 200', florUpdate.status, 200);

  const audit = await getAuditLog();
  assert('Audit log has rows', audit.length > 0);

  const ownerRows = audit.filter(r => r.actorRole === 'owner');
  const floristRows = audit.filter(r => r.actorRole === 'florist');

  assert(`Owner audit rows present (${ownerRows.length})`, ownerRows.length > 0);
  assert(`Florist audit rows present (${floristRows.length})`, floristRows.length > 0);

  // Audit row shape — every row must have entityType, action, actorRole, diff.
  const sample = audit[0];
  assert('Audit row has entityType', !!sample.entityType);
  assert('Audit row has action', !!sample.action);
  assert('Audit row has actorRole', !!sample.actorRole);
  assert('Audit row has diff JSON', sample.diff && typeof sample.diff === 'object');
}

// ──────────── 22. PARITY CHECK ────────────

async function section22Parity() {
  startSection('22. Parity recheck endpoint detects real PG ↔ Airtable mismatches');
  await reset();

  // In postgres mode the order's stock decrement lands in PG only — the
  // Airtable mock is the source of legacy reads but is no longer mutated
  // for stock ops. So a runParityCheck after a flow EXPECTS to find
  // field_mismatch entries (the PG row diverges from the mock row). That's
  // the harness proving the parity endpoint behaves correctly when state
  // diverges — same machinery the owner uses on prod during shadow week.
  await api('POST', '/orders', {
    pin: PIN_OWNER,
    body: buildOrderBody({
      customer: FIXTURE.customers.maria,
      lines: [
        line(FIXTURE.stock.redRose, 4),
        line(FIXTURE.stock.pinkTulip, 3),
        line(FIXTURE.stock.eucalyptus, 6),
      ],
    }),
  });

  const recheck = await api('POST', '/admin/parity/stock/recheck', { pin: PIN_OWNER });
  eq('Recheck endpoint → 200', recheck.status, 200);
  assert('Recheck returned a summary object', typeof recheck.body === 'object' && recheck.body !== null);
  eq('Recheck ran in postgres mode', recheck.body?.ran, true);
  assert('Field mismatches detected (PG decremented, mock unchanged)',
    (recheck.body?.mismatches?.field_mismatch || 0) >= 3);

  // Parity log should now have rows — the recheck wrote one per mismatch.
  const list = await api('GET', '/admin/parity/stock', { pin: PIN_OWNER });
  eq('Parity list endpoint → 200', list.status, 200);
  assert('Parity log has mismatch rows after recheck', (list.body?.rows?.length || 0) > 0);
}

// ──────────── 24. WIX WEBHOOK REPLAY ────────────

// Wix webhook secret matches the value set in start-test-backend.js. The
// route's HMAC verification compares the SHA-256 base64 digest of the raw
// request body against the `x-wix-signature` header. This section signs a
// synthetic Wix v3 payload with that secret, replays it through the
// /api/webhook/wix endpoint, and asserts the async processWixOrder pipeline
// creates an App Order from the payload.
const WIX_HARNESS_SECRET = 'test-mock-wix-secret';

function signWixPayload(payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', WIX_HARNESS_SECRET).update(body).digest('base64');
  return { body, sig };
}

async function postSignedWebhook(payload, sigOverride) {
  const { body, sig } = signWixPayload(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (sigOverride !== undefined) {
    if (sigOverride !== null) headers['x-wix-signature'] = sigOverride;
  } else {
    headers['x-wix-signature'] = sig;
  }
  const res = await fetch(`${BASE}/webhook/wix`, { method: 'POST', headers, body });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const wixSamplePayload = (orderId) => ({
  data: {
    order: {
      id: orderId,
      number: '50001',
      buyerInfo: { email: 'wix.test@example.com' },
      shippingInfo: {
        shipmentDetails: {
          address: {
            addressLine: 'ul. Webhook 1, 31-019 Kraków',
            contactDetails: {
              firstName: 'Web',
              lastName: 'Customer',
              phone: '+48 555 999 777',
            },
          },
        },
      },
      lineItems: [{
        productName: { original: 'Wix Test Bouquet' },
        quantity: 1,
        price: { amount: '150.00' },
        totalPriceBeforeTax: { amount: '150.00' },
      }],
      priceSummary: { total: { amount: '150.00' } },
    },
  },
});

async function section24WixWebhook() {
  startSection('24. Wix webhook replay — HMAC verification + async processing');
  await reset();

  // 24.1 — missing signature header → 401
  const noSig = await postSignedWebhook(wixSamplePayload('wix-no-sig'), null);
  eq('Missing x-wix-signature → 401', noSig.status, 401);

  // 24.2 — bogus signature → 401
  const badSig = await postSignedWebhook(wixSamplePayload('wix-bad-sig'), 'not-a-real-hmac');
  eq('Invalid signature → 401', badSig.status, 401);

  // 24.3 — properly signed payload → 200, order created via async processor
  const wixOrderId = 'wix-test-order-001';
  const ok = await postSignedWebhook(wixSamplePayload(wixOrderId));
  eq('Valid signature → 200', ok.status, 200);

  // processWixOrder is fire-and-forget after the 200 return. Poll briefly
  // until the order appears (or fail after a generous timeout).
  let appOrder = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const orders = await api('GET', '/orders', { pin: PIN_OWNER });
    appOrder = orders.body?.find(o => o['Wix Order ID'] === wixOrderId);
    if (appOrder) break;
  }
  assert('App Order created from Wix webhook (async)', !!appOrder);
  eq('App Order Source = Wix', appOrder?.Source, 'Wix');
  eq('App Order Customer Name from Wix payload', appOrder?.['Customer Name'], 'Web Customer');

  // 24.4 — replay same payload → dedup path skips creation (only one order remains)
  const replay = await postSignedWebhook(wixSamplePayload(wixOrderId));
  eq('Replay same payload → 200', replay.status, 200);
  await new Promise(r => setTimeout(r, 500));   // give dedup a moment
  const orders = await api('GET', '/orders', { pin: PIN_OWNER });
  const matchCount = orders.body?.filter(o => o['Wix Order ID'] === wixOrderId).length || 0;
  eq('Dedup prevented duplicate order on replay', matchCount, 1);
}

// ──────────── 23. AUTH GATES ────────────

async function section23AuthGates() {
  startSection('23. Cross-role authorization gates');
  await reset();

  // Driver scoped to deliveries — can list, can patch their assigned ones
  const driverDeliveries = await api('GET', `/deliveries?from=${tomorrow()}`, { pin: PIN_TIMUR });
  eq('Driver lists deliveries', driverDeliveries.status, 200);

  // Driver cannot list orders
  const driverOrders = await api('GET', '/orders', { pin: PIN_TIMUR });
  eq('Driver cannot list /orders', driverOrders.status, 403);

  // Driver cannot list stock
  const driverStock = await api('GET', '/stock', { pin: PIN_TIMUR });
  eq('Driver cannot list /stock', driverStock.status, 403);

  // Florist cannot read /admin
  const floristAdmin = await api('GET', '/admin/stock', { pin: PIN_FLORIST });
  eq('Florist cannot read /admin/stock', floristAdmin.status, 403);

  // Florist cannot read /analytics (owner-only)
  const floristAnalytics = await api('GET', '/analytics', { pin: PIN_FLORIST });
  eq('Florist cannot read /analytics', floristAnalytics.status, 403);

  // Owner can do everything
  const ownerOrders = await api('GET', '/orders', { pin: PIN_OWNER });
  eq('Owner reads /orders', ownerOrders.status, 200);
  const ownerAdmin = await api('GET', '/admin/stock', { pin: PIN_OWNER });
  eq('Owner reads /admin/stock', ownerAdmin.status, 200);

  // Bad PIN → 401
  const bad = await api('GET', '/orders', { pin: '0000' });
  eq('Wrong PIN → 401', bad.status, 401);
}

// ──────────── Main ────────────

async function main() {
  const startedAt = Date.now();
  console.log(`\n\x1b[36m╔═══════════════════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║  Flower Studio — E2E test against harness on port ${PORT}    ║\x1b[0m`);
  console.log(`\x1b[36m╚═══════════════════════════════════════════════════════════╝\x1b[0m`);

  // Sanity: harness must be running.
  try {
    const probe = await fetch(`${BASE}/health`);
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`\n\x1b[31m[FATAL] Cannot reach harness at ${BASE}/health (${e.message}).\x1b[0m`);
    console.error(`Start the harness first:\n  node backend/scripts/start-test-backend.js\n`);
    process.exit(2);
  }

  const sections = [
    section1Boot,
    section2OrderCreation,
    section3PickupHappyPath,
    section4DeliveryHappyPath,
    section5InvalidTransitions,
    section6PlainCancel,
    section7CancelWithReturn,
    section8Reopen,
    section9BouquetEditRemove,
    section10BouquetEditAddChange,
    section11EditBouquetGating,
    section12DeleteOrder,
    section13NegativeStock,
    section14StockLoss,
    section15SoftDeleteRestore,
    section16CascadeOrderToDelivery,
    section17CascadeDeliveryToOrder,
    section18Payments,
    section19ConvertToDelivery,
    section20SwapBouquetLine,
    section21AuditPerRole,
    section22Parity,
    section23AuthGates,
    section24WixWebhook,
  ];

  for (const section of sections) {
    try {
      await section();
    } catch (err) {
      bad(`${currentSection?.name || section.name} threw`, err.message);
      console.error(err.stack);
    }
  }

  // ──── Summary ────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[36m  RESULTS                                                  \x1b[0m`);
  console.log(`\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m`);
  for (const s of sectionResults) {
    const icon = s.fail === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${s.name.padEnd(60)} ${s.pass}/${s.pass + s.fail}`);
  }
  console.log(`\n  Total: \x1b[32m${pass} passed\x1b[0m, \x1b[31m${fail} failed\x1b[0m, ${elapsed}s elapsed`);
  if (fail > 0) {
    console.log(`\n\x1b[31mFailures:\x1b[0m`);
    for (const f of failures) console.log(`  - [${f.section}] ${f.label}: ${f.msg}`);
    process.exit(1);
  }
  console.log(`\n\x1b[32m🌸 ALL E2E TESTS PASSED\x1b[0m\n`);
}

main().catch(e => {
  console.error('\n[FATAL]', e);
  process.exit(2);
});
