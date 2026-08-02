// E2E spec: florist creates an order through the React UI, end-to-end
// through the harness backend, and verifies stock decrements + the audit
// log captures the actor.
//
// HISTORY: this file was scaffolded `test.describe.skip` against testids that
// were never added to the source, so it had never once run. #609 added the
// navigation testids it named (`new-order-button`, `customer-search`,
// `customer-row`, `flower-search`, `submit-order`, plus `wizard-next` and the
// DatePicker's own) and repaired the body around them. Two things it used to
// assume are gone:
//
//   - `recMockStock1` ("Red Rose") carries NO Variety attrs, so the Y-model
//     catalog groups it — with every other attr-less fixture row — into a
//     single unnamed group. It cannot be picked by name. This spec seeds its
//     own classified Variety instead, which is the pattern the newer specs
//     use anyway: seed exactly what the behaviour needs, don't widen the
//     shared fixture.
//   - Step 2 adds a flower through `VarietyAllocationPicker`, not a bare
//     quantity box. A single pre-chosen Variety opens straight at the
//     allocation form (CR-24), so the click path is row → amount → Add.
//
// SAFETY: runs against the pglite harness on :3002 (see the note in
// bouquet-flower-form.spec.js).
//
// Run:  npx playwright test florist-order-creation

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';
import { seedVariety, listStock } from './helpers/seed.js';

/** Tomorrow as YYYY-MM-DD in LOCAL time — the DatePicker builds its own day
 *  keys from local Y/M/D, so `toISOString()` would miss by a day east of UTC. */
function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

test.describe('florist — create new order (happy path)', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('owner creates a Pickup order with 3 Rose Red, stock decrements', async ({ page }) => {
    // A classified Variety, so the Y-model catalog can name it. 50 on the
    // shelf → 47 after a 3-stem order.
    const rose = await seedVariety({
      displayName: 'Rose Red 60cm', typeName: 'Rose', colour: 'Red', sizeCm: 60,
      quantity: 50, costPrice: 4.5, sellPrice: 15,
    });

    // 1. Log in as owner.
    await login(page, '1111');

    // 2. Hit "New Order" from the order list — the speed-dial FAB, then the
    //    manual option. Never `page.goto()` after login: auth is a React
    //    reducer with no localStorage, so a URL navigation bounces to /login.
    await page.locator('[data-testid="new-order-fab"]').click();
    await page.locator('[data-testid="new-order-button"]').click();
    await expect(page).toHaveURL(/\/orders\/new/);

    // 3. Step 1 — pick "Maria Kowalska" from the seeded fixture. The search is
    //    debounced and server-side, so wait for her row rather than the input.
    await page.locator('[data-testid="customer-search"]').fill('Maria');
    const maria = page.locator('[data-testid="customer-row"]', { hasText: 'Maria Kowalska' });
    await expect(maria).toBeVisible();
    await maria.click();
    // Picking her does NOT advance — Step 1 then offers the optional
    // key-person ("order for whom?") field and its own Continue.
    await page.locator('[data-testid="wizard-next"]').click();

    // 4. Step 2 — bouquet builder. Search, open the Variety, take 3 stems.
    await page.locator('[data-testid="flower-search"]').fill('Rose Red');
    const row = page.locator('[data-testid="flower-row"]', { hasText: 'Rose Red' });
    await expect(row).toBeVisible();
    await row.click();
    await page.locator('[data-testid="alloc-qty"]').fill('3');
    await page.locator('[data-testid="alloc-add"]').click();
    await page.locator('[data-testid="wizard-next"]').click();

    // 5. Step 3 — details. The date is required; the picker is a calendar
    //    dropdown, not a native date input.
    await page.locator('[data-testid="required-by"] [data-testid="date-picker-trigger"]').click();
    await page.locator(`[data-testid="date-picker-day-${tomorrowIso()}"]`).click();
    await page.locator('[data-testid="wizard-next"]').click();

    // 6. Step 4 — submit. Landing back on the list is the success signal.
    await page.locator('[data-testid="submit-order"]').click();
    await expect(page).toHaveURL(/\/orders$/, { timeout: 15_000 });

    // 7. Verify backend state: PG stock decremented 50 → 47.
    const stock = await listStock();
    const saved = stock.find(s => s.id === rose.id);
    expect(Number(saved['Current Quantity'])).toBe(47);

    // 8. …and the audit log captured WHO did it. Actor identity on stock
    //    movements is what makes the trace answerable months later.
    const auditRes = await fetch('http://localhost:3002/api/test/audit');
    const audit = await auditRes.json();
    const ownerStockUpdates = audit.filter(r =>
      r.entityType === 'stock' && r.actorRole === 'owner',
    );
    expect(ownerStockUpdates.length).toBeGreaterThan(0);
  });
});
