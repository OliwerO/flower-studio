// E2E spec: florist creates an order through the React UI, end-to-end
// through the harness backend, and verifies stock decrements + the audit
// log captures the actor.
//
// STATUS: SCAFFOLDED — currently `test.describe.skip`. To activate:
//   1. Add data-testid attributes to the florist components below
//      (search for the `[data-testid="..."]` selectors in this file).
//   2. Remove the `.skip` from the describe block.
//   3. Run `npx playwright test florist-order-creation`.
//
// Required data-testid attributes (per design doc):
//   apps/florist/src/pages/LoginPage.jsx        → pin-digit-0..9, pin-submit
//   apps/florist/src/pages/OrderListPage.jsx    → new-order-button
//   apps/florist/src/pages/NewOrderPage.jsx     → step-customer, step-bouquet, step-details, step-review, submit-order
//   apps/florist/src/components/Step1Customer.jsx → customer-search, customer-row
//   apps/florist/src/components/BouquetEditor.jsx → flower-search, add-flower-{stockId}, qty-{stockId}
//
// Why this is the design-doc happy-path: covers the full create-order flow
// through three nested components (login, list, wizard) and exercises the
// backend orderRepo + stockRepo path the cutover depends on.

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';

test.describe.skip('florist — create new order (happy path)', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('owner creates a Pickup order with one Red Rose, stock decrements', async ({ page }) => {
    // 1. Log in as owner.
    await login(page, '1111');

    // 2. Hit "New Order" from the order list.
    await page.click('[data-testid="new-order-button"]');
    await expect(page).toHaveURL(/\/orders\/new/);

    // 3. Step 1 — pick existing customer "Maria Kowalska" from the seeded fixture.
    await page.fill('[data-testid="customer-search"]', 'Maria');
    await page.click('[data-testid="customer-row"]:has-text("Maria Kowalska")');

    // 4. Step 2 — bouquet builder. Pick Red Rose, quantity 3.
    await page.fill('[data-testid="flower-search"]', 'Red Rose');
    await page.click('[data-testid="add-flower-recMockStock1"]');
    await page.fill('[data-testid="qty-recMockStock1"]', '3');

    // 5. Step 3 — details (date is required; harness uses tomorrow).
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
    await page.fill('[data-testid="required-by"]', tomorrow);

    // 6. Step 4 — submit.
    await page.click('[data-testid="submit-order"]');
    await expect(page.locator('[data-testid="order-created-toast"]')).toBeVisible();

    // 7. Verify backend state: PG stock decremented from 50 to 47 + audit row written.
    const stockRes = await fetch('http://localhost:3002/api/stock', { headers: { 'X-Auth-PIN': '1111' } });
    const stock = await stockRes.json();
    const rose = stock.find(s => s.id === 'recMockStock1');
    expect(rose['Current Quantity']).toBe(47);

    const auditRes = await fetch('http://localhost:3002/api/test/audit');
    const audit = await auditRes.json();
    const ownerStockUpdates = audit.filter(r =>
      r.entityType === 'stock' && r.action === 'update' && r.actorRole === 'owner',
    );
    expect(ownerStockUpdates.length).toBeGreaterThan(0);
  });
});
