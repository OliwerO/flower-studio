// Florist order creation — happy path + edge cases.
//
// What this validates end-to-end:
//   1. Florist PIN auth works.
//   2. POST /api/orders creates an order + lines + (delivery if applicable),
//      decrements PG stock, writes audit rows.
//   3. Validation errors fire for missing/invalid inputs (customer,
//      requiredBy, quantity, paymentStatus).
//   4. Auth boundary: no PIN → 401.
//   5. The auto-reset fixture wipes audit rows between specs.
//
// Known gap (NOT a test failure — documented expectation):
//   stockRepo.adjustQuantity calls inside orderService.js do NOT thread
//   the request actor through. Every audit row written during order
//   creation is currently actorRole='system'. The Phase 4 PR added
//   `actor` to the orderRepo paths but order-creation's stock leg still
//   lands on the legacy code path here. Tracked in BACKLOG as
//   "harness-finding: actor threading in orderService".

import { test, expect } from './helpers/test-base.js';

const FLORIST_PIN = '2222';
const OWNER_PIN = '1111';

// Reusable valid order body — mutate per-test as needed.
function validOrder(overrides = {}) {
  return {
    customer: 'recMockCust1',
    deliveryType: 'Pickup',
    requiredBy: '2026-04-30',
    orderLines: [{
      stockItemId: 'recMockStock1',  // Red Rose
      flowerName: 'Red Rose',
      quantity: 12,
      costPricePerUnit: 4.5,
      sellPricePerUnit: 15,
    }],
    paymentStatus: 'Unpaid',
    source: 'In-store',
    ...overrides,
  };
}

test.describe('Florist order creation (happy path)', () => {
  test('creates a pickup order, decrements PG stock, writes audit row', async ({ backendApi }) => {
    const initialState = await backendApi.state();
    expect(initialState.postgresCounts.stock).toBe(10);
    expect(initialState.postgresCounts.auditLog).toBe(0);

    const createRes = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder()),
    });
    expect(createRes.status).toBe(201);
    const orderBody = await createRes.json();
    expect(orderBody.order).toBeDefined();
    expect(orderBody.order.Status).toBe('New');
    expect(orderBody.orderLines).toHaveLength(1);

    // Stock decremented in PG (STOCK_BACKEND=postgres path).
    const stockRows = await (await backendApi.fetch('/api/stock', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    const redRoseAfter = stockRows.find(s => s['Display Name'] === 'Red Rose');
    expect(redRoseAfter['Current Quantity']).toBe(38); // 50 - 12

    // Audit log captured the stock adjustment.
    // NOTE: actorRole is currently 'system' because orderService doesn't
    // thread `actor` through to stockRepo.adjustQuantity. See file header.
    const auditRows = await backendApi.audit();
    const stockAudits = auditRows.filter(r => r.entityType === 'stock' && r.action === 'update');
    expect(stockAudits.length).toBeGreaterThan(0);
    const lastAdjust = stockAudits[stockAudits.length - 1];
    expect(lastAdjust.diff.before['Current Quantity']).toBe(50);
    expect(lastAdjust.diff.after['Current Quantity']).toBe(38);
    // TODO(orderService-actor-threading): change to 'florist' once orderService
    // passes `actor: actorFromReq(req)` to stockRepo.adjustQuantity.
    expect(lastAdjust.actorRole).toBe('system');
  });
});

test.describe('Florist order creation (edge cases)', () => {
  test('rejects unauthenticated requests with 401', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validOrder()),
    });
    expect(res.status).toBe(401);
  });

  test('400 when customer is missing', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder({ customer: undefined })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/customer/i);
  });

  test('400 when requiredBy is missing', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder({ requiredBy: undefined })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/requiredBy/i);
  });

  test('400 when a line has zero or negative quantity', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder({
        orderLines: [{ stockItemId: 'recMockStock1', flowerName: 'Red Rose', quantity: 0 }],
      })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/quantity/i);
  });

  test('400 when paymentStatus is invalid', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder({ paymentStatus: 'Sometime' })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/paymentStatus/i);
  });

  test('reset between specs zeros the audit log', async ({ backendApi }) => {
    const audits = await backendApi.audit();
    expect(audits).toHaveLength(0);
    const state = await backendApi.state();
    expect(state.postgresCounts.auditLog).toBe(0);
    expect(state.postgresCounts.stock).toBe(10);
  });

  test('Stock Deferred line does NOT decrement stock', async ({ backendApi }) => {
    const initialQty = await getStockQty(backendApi, 'Red Rose');
    expect(initialQty).toBe(50);

    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify(validOrder({
        orderLines: [{
          stockItemId: 'recMockStock1', flowerName: 'Red Rose',
          quantity: 12, stockDeferred: true,
          costPricePerUnit: 4.5, sellPricePerUnit: 15,
        }],
      })),
    });
    expect(res.status).toBe(201);

    // Deferred lines hold the stock for later — qty stays at 50.
    const finalQty = await getStockQty(backendApi, 'Red Rose');
    expect(finalQty).toBe(50);
  });
});

test.describe.skip('Florist order creation (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - LoginPage.jsx:               data-testid="pin-digit-{0..9}", "pin-submit"
  //   - NewOrderPage step 1:         data-testid="customer-search-input", "customer-result-{recId}"
  //   - NewOrderPage step 2 picker:  data-testid="bouquet-flower-{stockId}", "bouquet-qty-{stockId}"
  //   - NewOrderPage step 4 review:  data-testid="order-submit"
  //   - OrderListPage:               data-testid="order-card-{recId}"
});

// ── Helpers ──
async function getStockQty(backendApi, displayName) {
  const rows = await (await backendApi.fetch('/api/stock?includeEmpty=true', {
    headers: { 'X-Auth-PIN': OWNER_PIN },
  })).json();
  const row = rows.find(s => s['Display Name'] === displayName);
  return row ? row['Current Quantity'] : null;
}
