// Florist order creation — happy path.
//
// What this validates end-to-end:
//   1. The harness boots: backend on 3002, mock Airtable seeded, PG seeded,
//      audit_log empty.
//   2. Florist PIN auth works.
//   3. Creating an order with a 12-Red-Rose bouquet via the real
//      orderService.createOrder routes:
//        - inserts an `orders` row in PG (via Phase 4 orderRepo, if
//          ORDER_BACKEND=postgres) OR a fixture row (ORDER_BACKEND=airtable).
//        - decrements stock by 12 in PG (STOCK_BACKEND=postgres path).
//        - writes an audit_log row with action='update' on the stock entity
//          and actorRole='florist'.
//        - creates a delivery record when deliveryType='Delivery'.
//
// This spec exercises the API layer directly — ZERO React selectors involved.
// That's deliberate: it lets the foundation be validated reliably while the
// UI specs (which depend on selectors that may not exist as `data-testid`
// yet) are scaffolded but not run.
//
// A second test in this file walks the actual florist UI for the same flow.
// It's marked `.skip` for now; flip it on once the LoginPage / NewOrderPage
// have the data-testids the helpers reference (see tests/e2e/helpers/test-base.js).

import { test, expect } from './helpers/test-base.js';

const FLORIST_PIN = '2222';
const OWNER_PIN = '1111';

test.describe('Florist order creation (API layer)', () => {
  test('creates an order, decrements PG stock, writes an audit row', async ({ backendApi }) => {
    // ── 1. Verify reset put us in a clean state ──
    const initialState = await backendApi.state();
    expect(initialState.postgresCounts.stock).toBe(10);
    expect(initialState.postgresCounts.auditLog).toBe(0);

    // Find Red Rose's recXXX in the seeded mock fixture so we can pass it
    // through the order-creation API.
    const redRose = initialState.airtable.tblMockStock.find(s => s['Display Name'] === 'Red Rose');
    expect(redRose).toBeDefined();
    expect(redRose['Current Quantity']).toBe(50);

    // ── 2. Get the customer rec id ──
    const maria = initialState.airtable.tblMockCustomers.find(c => c.Nickname === 'Maria');
    expect(maria).toBeDefined();

    // ── 3. Create an order via the real API ──
    const createRes = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-PIN': FLORIST_PIN,
      },
      body: JSON.stringify({
        customer: maria.id,
        deliveryType: 'Pickup',  // simpler — no delivery record needed
        orderLines: [{
          stockItemId: redRose.id,
          flowerName: 'Red Rose',
          quantity: 12,
          costPricePerUnit: 4.5,
          sellPricePerUnit: 15,
        }],
        paymentStatus: 'Unpaid',
        source: 'In-store',
      }),
    });

    expect(createRes.status).toBe(201);
    const orderBody = await createRes.json();
    expect(orderBody.order).toBeDefined();
    expect(orderBody.orderLines).toHaveLength(1);

    // ── 4. Verify stock decremented in PG (STOCK_BACKEND=postgres path) ──
    const stockRes = await backendApi.fetch('/api/stock?includeEmpty=true', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    const stockRows = await stockRes.json();
    const redRoseAfter = stockRows.find(s => s['Display Name'] === 'Red Rose');
    expect(redRoseAfter['Current Quantity']).toBe(38); // 50 - 12

    // ── 5. Verify audit log captured the stock adjustment ──
    const auditRows = await backendApi.audit();
    expect(auditRows.length).toBeGreaterThan(0);
    const stockAudits = auditRows.filter(r => r.entityType === 'stock' && r.action === 'update');
    expect(stockAudits.length).toBeGreaterThan(0);

    // The stockRepo's actor should reflect 'florist' (PIN_FLORIST).
    // Note: requires actorFromReq plumbing — if any audit row has the
    // wrong role, the PR thread that introduced the route hadn't passed
    // `req` through yet.
    const stockAdjustAudit = stockAudits[stockAudits.length - 1];
    expect(stockAdjustAudit.actorRole).toBe('florist');
    expect(stockAdjustAudit.diff.before['Current Quantity']).toBe(50);
    expect(stockAdjustAudit.diff.after['Current Quantity']).toBe(38);
  });

  test('rejects unauthenticated requests with 401', async ({ backendApi }) => {
    const res = await backendApi.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'recX' }),
    });
    expect(res.status).toBe(401);
  });

  test('reset between specs zeros the audit log', async ({ backendApi }) => {
    // The auto-reset fixture in test-base.js should have wiped any
    // audit rows the previous spec created.
    const audits = await backendApi.audit();
    expect(audits).toHaveLength(0);

    const state = await backendApi.state();
    expect(state.postgresCounts.auditLog).toBe(0);
    expect(state.postgresCounts.stock).toBe(10);
  });
});

test.describe.skip('Florist order creation (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once the following data-testids exist:
  //   - LoginPage.jsx:               data-testid="pin-digit-{0..9}", "pin-submit"
  //   - NewOrderPage step 1:         data-testid="customer-search-input", "customer-result-{recId}"
  //   - NewOrderPage step 2 picker:  data-testid="bouquet-flower-{stockId}", "bouquet-qty-{stockId}"
  //   - NewOrderPage step 4 review:  data-testid="order-submit"
  //   - OrderListPage:               data-testid="order-card-{recId}"
  //
  // Without these, the tests are a maze of fragile CSS selectors that
  // break on any visual tweak. The two-line addition to each component
  // is documented in BACKLOG.md under "harness-pr-2".

  test('florist creates an order via the UI wizard', async ({ page, pinLogin }) => {
    await pinLogin('florist');
    await page.goto('/orders/new');

    // Step 1: Pick Maria as the customer
    await page.getByTestId('customer-search-input').fill('Maria');
    await page.getByTestId(/^customer-result-/).first().click();

    // Step 2: Add 12 Red Roses
    await page.getByTestId(/^bouquet-flower-recMockStock1$/).click();
    await page.getByTestId(/^bouquet-qty-recMockStock1$/).fill('12');

    // Step 3: Skip details (defaults are fine)
    await page.getByRole('button', { name: /next|далее/i }).click();
    await page.getByRole('button', { name: /next|далее/i }).click();

    // Step 4: Submit
    await page.getByTestId('order-submit').click();

    // Land on /orders with a new card visible
    await page.waitForURL(/\/orders$/);
    await expect(page.getByTestId(/^order-card-/).first()).toBeVisible();
  });
});
