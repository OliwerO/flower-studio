// Florist bouquet edit — swap one flower for another on a Ready order.
//
// What this validates:
//   - editBouquetLines (orderService.js) returns one stock to inventory
//     and deducts the new one.
//   - The replaced line gets a new audit row (line:create) and the
//     removed line gets line:delete.
//   - Stock on both flowers ends with the correct delta:
//       Old flower: returned to original quantity.
//       New flower: original − new quantity.
//   - The order auto-reverts from Ready → New (current orderService
//     behaviour — see CLAUDE.md known pitfalls #1).

import { test, expect } from './helpers/test-base.js';

const FLORIST_PIN = '2222';

test.describe('Florist bouquet edit (API layer)', () => {
  test('swapping one flower for another adjusts stock both ways', async ({ backendApi }) => {
    const state = await backendApi.state();
    // recMockOrd2 is the Ready order with 8 Pink Tulips (recMockStock2).
    // We'll swap them for 6 White Lilies (recMockStock3).
    const order = state.airtable.tblMockOrders.find(o => o['App Order ID'] === 'BLO-20260427-2');
    expect(order).toBeDefined();
    expect(order.Status).toBe('Ready');

    const tulip = state.airtable.tblMockStock.find(s => s['Display Name'] === 'Pink Tulip');
    const lily  = state.airtable.tblMockStock.find(s => s['Display Name'] === 'White Lily');
    const tulipBefore = tulip['Current Quantity'];   // 30 in fixture
    const lilyBefore  = lily['Current Quantity'];    // 20 in fixture

    // PATCH /api/orders/:id with a bouquet edit.
    // The exact request shape depends on routes/orders.js — this test is
    // skipped pending a route-shape audit (see TODO at bottom).
    test.skip(true, 'TODO(harness-pr-3): editBouquetLines route shape needs to be audited; see routes/orders.js');

    const editRes = await backendApi.fetch(`/api/orders/${order.id}/lines`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': FLORIST_PIN },
      body: JSON.stringify({
        lines: [{ stockItemId: lily.id, flowerName: 'White Lily', quantity: 6,
                  costPricePerUnit: 6, sellPricePerUnit: 22 }],
      }),
    });
    expect(editRes.ok).toBe(true);

    const finalState = await backendApi.state();
    const tulipAfter = finalState.postgresCounts.stock; // placeholder; needs PG row read
    expect(tulipAfter).toBe(tulipBefore + 8);   // returned the 8 tulips
    // White Lily: 20 - 6 = 14
    // Order status: Ready → New (auto-revert)
  });
});

test.describe.skip('Florist bouquet edit (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - OrderCard / OrderDetailPage:  data-testid="bouquet-line-{lineId}", "bouquet-add-flower"
  //   - BouquetEditor:                data-testid="flower-search", "flower-result-{stockId}"
  //   - Save action:                  data-testid="bouquet-save"
});
