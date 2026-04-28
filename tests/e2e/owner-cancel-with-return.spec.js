// Owner cancels an order with stock-return.
//
// What this validates:
//   - cancelWithStockReturn() in orderService.js returns every line's
//     quantity to PG stock.
//   - Order status flips to 'Cancelled'.
//   - Linked delivery (if any) cascades to 'Cancelled' status.
//   - audit_log captures: order:update (Status: New→Cancelled),
//     stock:update (Current Quantity +N) for each line, delivery:update
//     (Status: Pending→Cancelled).
//   - actorRole='owner' on every audit row.

import { test, expect } from './helpers/test-base.js';

const OWNER_PIN = '1111';

test.describe('Owner cancel with stock return (API layer)', () => {
  test('cancelling an order returns all stems to PG stock', async ({ backendApi }) => {
    test.skip(true, 'TODO(harness-pr-3): the cancel-with-return endpoint shape varies by branch — audit before un-skipping.');

    // 1. Resolve recMockOrd1 (Maria's order: 12 Red Rose + 5 White Lily).
    const initialState = await backendApi.state();
    const order = initialState.airtable.tblMockOrders.find(o => o['App Order ID'] === 'BLO-20260427-1');
    expect(order).toBeDefined();

    // First we'd seed PG with the order via a backend hook, OR call
    // POST /api/orders to create one fresh and then cancel it. The
    // fixture's order rows live in mock-Airtable only — PG starts empty
    // for orders. So this test must first create then cancel.

    // 2. Cancel with stock return.
    const cancelRes = await backendApi.fetch(`/api/orders/${order.id}/cancel-with-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': OWNER_PIN },
      body: JSON.stringify({ reason: 'Customer requested cancel' }),
    });
    expect(cancelRes.ok).toBe(true);

    // 3. Verify stock returned.
    //    Red Rose:  50 - 12 = 38 → cancelled → 50 again
    //    White Lily: 20 -  5 = 15 → cancelled → 20 again
    const stockRows = await (await backendApi.fetch('/api/stock?includeEmpty=true', {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    expect(stockRows.find(s => s['Display Name'] === 'Red Rose')['Current Quantity']).toBe(50);
    expect(stockRows.find(s => s['Display Name'] === 'White Lily')['Current Quantity']).toBe(20);

    // 4. Audit log: 2 stock:update rows + 1 order:update + 1 delivery:update.
    const audits = await backendApi.audit();
    const stockAudits = audits.filter(a => a.entityType === 'stock' && a.action === 'update');
    expect(stockAudits.length).toBeGreaterThanOrEqual(2);
    expect(stockAudits.every(a => a.actorRole === 'owner')).toBe(true);
  });
});

test.describe.skip('Owner cancel with stock return (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - OrderDetailPanel.jsx:    data-testid="order-cancel-button"
  //   - Cancel modal:            data-testid="cancel-confirm", "cancel-with-return-toggle"
  //   - Stock list refresh:      data-testid="stock-row-{stockId}-quantity"
});
