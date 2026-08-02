// UI spec: the shared "add a flower to a bouquet" form (`BouquetFlowerForm`).
//
// This replays the owner's own 2026-07-30 bug: she typed `DA` into a flower
// search while looking for Dahlia, tapped "+ Add new", and got a flower both
// NAMED and TYPED `DA` sitting beside the Dahlia she already owned. The rule
// the form exists to enforce is one sentence — **the typed search string is a
// seed for the form, never an identity** — and it is not a rule any unit test
// can prove, because the failure lived in what each host passed to the form.
// Five hosts, five chances to re-introduce it.
//
// Covered here (#609):
//   - the raw query never lands in Type, and submit stays disabled until the
//     flower is classified;
//   - classifying onto a flower she already has RESOLVES (emerald badge, the
//     card's own name, no new stock row);
//   - a genuinely new tuple takes an explicit confirm — Cancel writes nothing;
//   - re-opening the picker with a different query RE-SEEDS the form. That is
//     the `key={<seed>}` contract, and without it the host commits the
//     PREVIOUS flower while every label says the new one (#558's class). Review
//     caught this on four of the five hosts before they shipped; nothing but a
//     click-through can catch it after.
//   - both a `dense` host (florist OrderCard, 4-tuple behind a disclosure) and
//     a non-dense one (dashboard OrderDetailPanel, fields always visible).
//
// SAFETY: everything runs against the pglite harness on :3002.
// `start-test-backend.js` force-sets DATABASE_URL=pglite:memory before any
// import and refuses to boot under NODE_ENV=production, so these specs cannot
// reach the production database.
//
// Run:  npx playwright test bouquet-flower-form

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';
import { seedVariety, seedOrder, listStock, harnessApi } from './helpers/seed.js';

/**
 * The flower the owner was actually looking for.
 *
 * Seeded at qty 0 on purpose: `hasAvailableStockMatch` gates the "+ Add new"
 * affordance on availability, so an out-of-stock flower is exactly the case
 * where the owner reaches the form — and exactly the case where minting a
 * duplicate is easiest.
 */
function seedDahlia() {
  return seedVariety({
    displayName: 'Dahlia Coral', typeName: 'Dahlia', colour: 'Coral',
    quantity: 0, costPrice: 4, sellPrice: 12,
  });
}

/**
 * Set a Variety attribute the way a person does (#610).
 *
 * The 4-tuple fields are `ValueCombobox`es, so typing alone commits nothing —
 * an unknown value takes a deliberate click on the create row, and a known one
 * snaps to its stored casing when the field closes.
 */
async function setVariety(scope, field, value) {
  const input = scope.locator(`[data-testid="nv-${field}"]`);
  await input.fill(value);
  const create = scope.locator(`[data-testid="nv-${field}-create"]`);
  const isNew = await create.waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
  if (isNew) await create.click();
  else await input.blur();
}

test.describe('BouquetFlowerForm — florist order card (dense host)', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  /**
   * Open the bouquet editor on a seeded order and return the card's scope.
   *
   * Navigation is all clicks: auth lives in a React reducer with no
   * localStorage or cookie, so a `page.goto()` after login remounts the app
   * and bounces back to /login.
   */
  async function openBouquetEditor(page, orderId) {
    await login(page, '1111');
    const card = page.locator(`[data-testid="order-card"][data-order-id="${orderId}"]`);
    await expect(card).toBeVisible();
    await card.click();                                   // expand
    await card.locator('[data-testid="edit-bouquet"]').click();
    return card;
  }

  /** Type a query into the picker and take the "+ Add new" branch. */
  async function openNewFlowerForm(card, query) {
    await card.locator('[data-testid="add-flower-button"]').click();
    await card.locator('[data-testid="flower-search"]').fill(query);
    await card.locator('[data-testid="add-new-flower"]').click();
    const form = card.locator('[data-testid="bouquet-flower-form"]');
    await expect(form).toBeVisible();
    return form;
  }

  test('the typed query seeds the form but never becomes the Type', async ({ page }) => {
    // The owner's exact sequence. `Da` matches no Type she owns, so the form
    // must refuse to guess one — and refuse to submit until she says.
    await seedDahlia();
    const order = await seedOrder();
    const card = await openBouquetEditor(page, order.id);
    const form = await openNewFlowerForm(card, 'Da');

    await expect(form.locator('[data-testid="nv-type"]')).toHaveValue('');
    await expect(form.locator('[data-testid="nv-colour"]')).toHaveValue('');
    await expect(form.locator('[data-testid="bff-submit"]')).toBeDisabled();
    await expect(form.locator('[data-testid="bff-variety-badge"]')).toHaveText(/не выбран|not selected/i);

    // Dense host: the 4-tuple is behind a disclosure that auto-opens exactly
    // when the seed could not classify the query — which is now.
    await expect(form.locator('[data-testid="bff-refine-toggle"]')).toBeVisible();
    await expect(form.locator('[data-testid="new-variety-fields"]')).toBeVisible();
  });

  test('classifying onto a flower she already has resolves instead of creating', async ({ page }) => {
    const dahlia = await seedDahlia();
    const before = await listStock();
    const order = await seedOrder();
    const card = await openBouquetEditor(page, order.id);
    const form = await openNewFlowerForm(card, 'Da');

    await setVariety(form, 'type', 'Dahlia');
    await setVariety(form, 'colour', 'Coral');

    // The name follows the matched CARD, not the search box.
    await expect(form.locator('[data-testid="bff-variety-badge"]')).toHaveText(/карточки склада|stock card/i);
    await expect(form.locator('[data-testid="bff-resolved-name"]')).toHaveText('Dahlia Coral');

    // Straight through — no confirm, because there is nothing new to confirm.
    await form.locator('[data-testid="bff-submit"]').click();
    await expect(form).toBeHidden();

    const after = await listStock();
    expect(after.length).toBe(before.length);

    // And the saved line binds to the seeded card, not to a namesake.
    await card.locator('[data-testid="save-bouquet"]').click();
    await expect(card.locator('[data-testid="save-bouquet"]')).toBeHidden();
    const detail = await harnessApi(`/api/orders/${order.id}`, { method: 'GET' });
    const added = detail.orderLines.find(l => l['Flower Name'] === 'Dahlia Coral');
    expect(added).toBeTruthy();
    expect(added['Stock Item']?.[0]).toBe(dahlia.id);
  });

  test('a genuinely new Variety takes an explicit confirm, and Cancel writes nothing', async ({ page }) => {
    await seedDahlia();
    const before = await listStock();
    const order = await seedOrder();
    const card = await openBouquetEditor(page, order.id);
    const form = await openNewFlowerForm(card, 'Da');

    await setVariety(form, 'type', 'Dahlia');
    await setVariety(form, 'colour', 'Lilac');
    await expect(form.locator('[data-testid="bff-variety-badge"]')).toHaveText(/новый сорт|new variety/i);
    await expect(form.locator('[data-testid="bff-resolved-name"]')).toHaveText('Dahlia Lilac');

    // Submitting only ASKS.
    await form.locator('[data-testid="bff-submit"]').click();
    await expect(form.locator('[data-testid="bff-new-variety-prompt"]')).toBeVisible();

    // Backing out leaves the catalogue exactly as it was.
    await form.locator('[data-testid="bff-new-variety-cancel"]').click();
    await expect(form.locator('[data-testid="bff-new-variety-prompt"]')).toBeHidden();
    expect((await listStock()).length).toBe(before.length);

    // Confirming creates exactly one card, carrying its classification —
    // an attr-less row is invisible in the grouped Stock view (pitfall #9).
    await form.locator('[data-testid="bff-submit"]').click();
    await form.locator('[data-testid="bff-new-variety-confirm"]').click();
    await expect(form).toBeHidden();

    const after = await listStock();
    expect(after.length).toBe(before.length + 1);
    const created = after.find(s => s['Display Name'] === 'Dahlia Lilac');
    expect(created).toBeTruthy();
    expect(created.Type).toBe('Dahlia');
    expect(created.Colour).toBe('Lilac');
  });

  test('re-opening the picker with a different query re-seeds the form', async ({ page }) => {
    // The `key={<seed>}` contract. The form seeds ONCE in a useState
    // initializer, so a host that changes `seedQuery` without remounting shows
    // the new query's labels over the PREVIOUS flower's state — and commits
    // that. The picker stays reachable while the form is open on this host,
    // which is precisely what makes it reachable as a bug.
    await seedDahlia();
    await seedVariety({
      displayName: 'Tulip Pink', typeName: 'Tulip', colour: 'Pink',
      quantity: 0, costPrice: 2, sellPrice: 7,
    });
    const order = await seedOrder();
    const card = await openBouquetEditor(page, order.id);

    // `Dahlia` is a Type she owns, so the seed classifies it and the dense
    // host keeps the 4-tuple collapsed — the resolved name is what she reads,
    // and it is the label that would lie if the form failed to remount.
    const form = await openNewFlowerForm(card, 'Dahlia');
    await expect(form.locator('[data-testid="bff-resolved-name"]')).toHaveText('Dahlia');

    // Re-open the picker behind the form and pick a different flower.
    await openNewFlowerForm(card, 'Tulip');
    const reseeded = card.locator('[data-testid="bouquet-flower-form"]');
    await expect(reseeded.locator('[data-testid="bff-resolved-name"]')).toHaveText('Tulip');

    // …and the state under the label moved too, not just the label.
    await reseeded.locator('[data-testid="bff-refine-toggle"]').click();
    await expect(reseeded.locator('[data-testid="nv-type"]')).toHaveValue('Tulip');
  });
});

test.describe('BouquetFlowerForm — dashboard order panel (non-dense host)', () => {
  test.use({ baseURL: 'http://localhost:5175' });

  /**
   * The dashboard auto-authenticates from VITE_OWNER_PIN (playwright.config.js)
   * — there is no login screen to click through, only the tab bar.
   */
  async function openBouquetEditor(page, orderId) {
    await page.goto('/');
    await page.locator('[data-testid="tab-orders"]').click();
    const row = page.locator(`[data-testid="order-row"][data-order-id="${orderId}"]`);
    await expect(row).toBeVisible();
    await row.click();                                    // expand → OrderDetailPanel
    const panel = page.locator('[data-testid="edit-bouquet"]');
    await expect(panel).toBeVisible();
    await panel.click();
    return page;
  }

  test('the same rule holds with the 4-tuple always visible', async ({ page }) => {
    const dahlia = await seedDahlia();
    const before = await listStock();
    const order = await seedOrder();
    await openBouquetEditor(page, order.id);

    await page.locator('[data-testid="add-flower-button"]').click();
    await page.locator('[data-testid="flower-search"]').fill('Da');
    await page.locator('[data-testid="add-new-flower"]').click();
    const form = page.locator('[data-testid="bouquet-flower-form"]');
    await expect(form).toBeVisible();

    // Non-dense: no disclosure — the fields are simply there.
    await expect(form.locator('[data-testid="bff-refine-toggle"]')).toHaveCount(0);
    await expect(form.locator('[data-testid="new-variety-fields"]')).toBeVisible();
    await expect(form.locator('[data-testid="nv-type"]')).toHaveValue('');
    await expect(form.locator('[data-testid="bff-submit"]')).toBeDisabled();

    await setVariety(form, 'type', 'Dahlia');
    await setVariety(form, 'colour', 'Coral');
    await expect(form.locator('[data-testid="bff-variety-badge"]')).toHaveText(/карточки склада|stock card/i);
    await expect(form.locator('[data-testid="bff-resolved-name"]')).toHaveText('Dahlia Coral');

    await form.locator('[data-testid="bff-submit"]').click();
    await expect(form).toBeHidden();
    expect((await listStock()).length).toBe(before.length);

    await page.locator('[data-testid="save-bouquet"]').click();
    await expect(page.locator('[data-testid="save-bouquet"]')).toBeHidden();
    const detail = await harnessApi(`/api/orders/${order.id}`, { method: 'GET' });
    const added = detail.orderLines.find(l => l['Flower Name'] === 'Dahlia Coral');
    expect(added).toBeTruthy();
    expect(added['Stock Item']?.[0]).toBe(dahlia.id);
  });
});
