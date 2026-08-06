// tests/e2e/order-total-delivery-fee.spec.js
//
// UI spec for #644 — "Order total incorrectly includes driver payment fee in
// customer price".
//
// Owner's case: the customer pays 1000 zł and delivery is FREE for her, but
// the courier is still paid 35 zł. She cleared the customer fee and entered
// the courier's 35 in the Delivery Cost field; the total stayed 1035 zł and
// never came back down.
//
// Three layers had to line up for that number to be right, and each of them
// passed its own tests while the chain was broken:
//   1. `GET /orders/:id` read the order's stale `Delivery Fee` copy before
//      the delivery record's live one (backend integration test).
//   2. The order screens did the same read client-side (shared unit test).
//   3. The screens kept displaying the server's previous `Final Price` after
//      patching the fee, so nothing moved until a reload — invisible to both
//      test layers above, and the reason this spec exists.
//
// It also pins the thing the issue title claims: Delivery Cost is what the
// STUDIO pays the courier (ADR-0019) and must never move the customer total.
//
// SAFETY: runs against the pglite harness on :3002 — see
// stock-order-line-form.spec.js's header for the harness's production-DB
// guarantees.

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';
import { seedDeliveryOrder } from './helpers/seed.js';

test.describe('Order total vs delivery fee (#644)', () => {
  test('clearing the customer fee drops it from the total, and the courier cost never enters it', async ({ page }) => {
    // 1000 zł bouquet + the 35 zł delivery fee the wizard pre-fills.
    const seeded = await seedDeliveryOrder({
      deliveryType: 'Delivery',
      address: 'ul. Testowa 5, Kraków',
      fee: 35,
      priceOverride: 1000,
    });

    await login(page, '1111');

    // The canonical fixture seeds other orders, so scope every assertion to
    // THIS card (`data-order-id` on the OrderCard root).
    const card = page.locator(`[data-order-id="${seeded.order.id}"]`);
    const total = card.getByTestId('order-total');

    // Expand it — clicking the App Order ID badge bubbles to the card's
    // toggle (the customer-name button next to it navigates away instead).
    await card.getByText(`#${seeded.order['App Order ID']}`, { exact: true }).click();
    await expect(total).toHaveText('1035 zł');

    // What she pays the courier — a studio COST. The total must not budge.
    await card.getByTestId('delivery-cost-input').fill('35');
    await expect(total).toHaveText('1035 zł');

    // Delivery is free for this customer.
    await card.getByTestId('delivery-fee-input').fill('');
    await expect(total).toHaveText('1000 zł');

    // ...and it stays 1000 after a genuine reload — the order's own stale
    // `Delivery Fee` column is what used to resurrect the 35 here.
    // (Reload lands on /login: auth is a React reducer with no persistence.)
    await page.reload();
    await login(page, '1111');
    const cardAgain = page.locator(`[data-order-id="${seeded.order.id}"]`);
    await cardAgain.getByText(`#${seeded.order['App Order ID']}`, { exact: true }).click();
    await expect(cardAgain.getByTestId('order-total')).toHaveText('1000 zł');
  });
});
