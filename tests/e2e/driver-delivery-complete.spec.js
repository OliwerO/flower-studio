// Driver completes a delivery — status cascade order ↔ delivery.
//
// What this validates:
//   - PATCH /api/deliveries/:id { Status: 'Out for Delivery' } cascades
//     to the linked order's Status (deliveries.js cascade rule).
//   - Subsequent PATCH { Status: 'Delivered' } cascades the order to
//     'Delivered' as well.
//   - Driver PIN (PIN_DRIVER_TIMUR=3333) is captured as actorRole='driver'
//     with actorPinLabel='Timur' on every audit row.

import { test, expect } from './helpers/test-base.js';

const TIMUR_PIN = '3333';
const OWNER_PIN = '1111';

test.describe('Driver delivery flow (API layer)', () => {
  test('marking a delivery Out for Delivery cascades to its order', async ({ backendApi }) => {
    test.skip(true, 'TODO(harness-pr-3): the cascade routes need the order/delivery to live in PG. Phase 4 ORDER_BACKEND=postgres flips this on; until then the deliveries route writes to Airtable mock and the cascade target is the mock order, not PG.');

    const initialState = await backendApi.state();
    const delivery = initialState.airtable.tblMockDeliveries.find(
      d => d['Assigned Driver'] === 'Timur'
    );
    expect(delivery).toBeDefined();

    // Out for Delivery
    const startRes = await backendApi.fetch(`/api/deliveries/${delivery.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': TIMUR_PIN },
      body: JSON.stringify({ Status: 'Out for Delivery' }),
    });
    expect(startRes.ok).toBe(true);

    // Check linked order status cascaded
    const linkedOrderId = delivery['Linked Order'][0];
    const orderRes = await backendApi.fetch(`/api/orders/${linkedOrderId}`, {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    });
    const order = await orderRes.json();
    expect(order.Status).toBe('Out for Delivery');

    // Mark Delivered
    const doneRes = await backendApi.fetch(`/api/deliveries/${delivery.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': TIMUR_PIN },
      body: JSON.stringify({ Status: 'Delivered', deliveryResult: 'Success' }),
    });
    expect(doneRes.ok).toBe(true);

    // Order cascaded to Delivered
    const finalOrder = await (await backendApi.fetch(`/api/orders/${linkedOrderId}`, {
      headers: { 'X-Auth-PIN': OWNER_PIN },
    })).json();
    expect(finalOrder.Status).toBe('Delivered');

    // Audit log: every row written by the driver carries actorRole='driver',
    // actorPinLabel='Timur'.
    const audits = await backendApi.audit();
    const driverRows = audits.filter(a => a.actorRole === 'driver');
    expect(driverRows.length).toBeGreaterThan(0);
    expect(driverRows.every(a => a.actorPinLabel === 'Timur')).toBe(true);
  });
});

test.describe.skip('Driver delivery flow (UI flow)', () => {
  // TODO(harness-pr-2): un-skip once these data-testids exist:
  //   - DeliveryListPage:    data-testid="delivery-card-{deliveryId}"
  //   - DeliverySheet:       data-testid="delivery-start", "delivery-complete"
  //   - DeliveryResultPicker:data-testid="delivery-result-{success|not-home|...}"
});
