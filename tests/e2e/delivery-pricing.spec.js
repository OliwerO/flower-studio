// tests/e2e/delivery-pricing.spec.js
//
// UI spec: the shared Delivery Cost / Fee / Margin form (DeliveryPricingFields),
// mounted in the florist app's OrderCard. Drives the real components in a real
// browser against the pglite harness — catches wiring failures (a prop never
// passed, the quote endpoint never called, the mount-time-overwrite bug class
// fixed in Task 12) that green component tests happily miss.
//
// SAFETY: everything runs against the pglite harness on :3002 — see
// stock-order-line-form.spec.js's header comment for the harness's
// production-DB guarantees.
//
// Real distance is deterministic here — see distanceService.js's
// HARNESS_STUB_DISTANCE_KM (set by start-test-backend.js only): 3km lands in
// configService's default first Distance Band (upToKm: 5, price: 35 zł), so
// the assertions below are exact, not just "did something appear".

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';
import { seedOrder } from './helpers/seed.js';

test.describe('Delivery pricing', () => {
  test('entering an address shows the quoted cost, and a fee above it shows a positive margin', async ({ page }) => {
    const order = await seedOrder({ deliveryType: 'Delivery', address: '' });

    await login(page, '1111');

    // Expand the seeded order's card — clicking its App Order ID badge
    // bubbles up to the card's onClick={toggle} (the customer-name button
    // right next to it stopPropagation()s and navigates away instead, so
    // don't click that).
    await page.getByText(`#${order.order['App Order ID']}`, { exact: true }).click();

    const addressInput = page.getByTestId('delivery-address-input');
    await expect(addressInput).toBeVisible();
    await addressInput.fill('ul. Testowa 5, Kraków');
    await addressInput.press('Tab'); // blur — commits via patchDelivery's onBlur handler

    const costInput = page.getByTestId('delivery-cost-input');
    await expect(costInput).toHaveValue('35');

    const feeInput = page.getByTestId('delivery-fee-input');
    await feeInput.fill('80');

    const margin = page.getByTestId('delivery-margin');
    await expect(margin).toBeVisible();
    await expect(margin).toContainText('45');
  });
});
