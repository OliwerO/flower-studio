// UI spec: the shared Stock Order line form (`PoLineForm`).
//
// This is the click-through the unit and integration tests cannot do — it
// drives the real React components in a real browser against the harness
// backend, so it catches wiring failures (a prop never passed, a testid
// renamed, a form that renders but never re-resolves) that green component
// tests happily miss.
//
// SAFETY: everything runs against the pglite harness on :3002.
// `start-test-backend.js` force-sets DATABASE_URL=pglite:memory before any
// import and refuses to boot under NODE_ENV=production, so these specs cannot
// reach the production database. Each test seeds exactly the Varieties it
// needs via `helpers/seed.js`; `helpers/test-base.js` resets the harness to the
// canonical fixture beforehand, so tests never inherit each other's data.
//
// Run:  npx playwright test stock-order-line-form
// (Playwright boots the harness + Vite servers itself — see playwright.config.js.)

import { test, expect } from './helpers/test-base.js';
import { login, gotoPurchaseOrders } from './helpers/login.js';
import { seedPeonySizes, seedStockOrder, sendStockOrder, startShopping, harnessApi } from './helpers/seed.js';

test.describe('Stock Order line form', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  /** Open the new-Stock-Order form and return the first line's scope. */
  async function openNewOrderForm(page) {
    await login(page, '1111');
    await gotoPurchaseOrders(page);
    await page.getByRole('button', { name: /Новый заказ поставщику|New Purchase Order/i }).first().click();
    const line = page.locator('[data-testid="po-line-form"]').first();
    await expect(line).toBeVisible();
    return line;
  }

  /** Type into the flower search and pick a suggestion by its display name. */
  async function pickFlower(line, page, query, displayName) {
    await line.locator('[data-testid="stock-search-input"]').fill(query);
    await page.getByRole('button', { name: displayName, exact: false }).first().click();
  }

  test('picking a flower fills the Variety block instead of hiding it', async ({ page }) => {
    // The bug this feature exists to fix: the block was gated on !stockItemId,
    // so choosing a flower hid its own identity.
    await seedPeonySizes();
    const line = await openNewOrderForm(page);

    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    await expect(line.locator('[data-testid="nv-type"]')).toHaveValue('Peony');
    await expect(line.locator('[data-testid="nv-colour"]')).toHaveValue('Pink');
    await expect(line.locator('[data-testid="nv-size"]')).toHaveValue('60');
    await expect(line.locator('[data-testid="nv-cultivar"]')).toHaveValue('Sarah B.');
    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/карточки склада|stock card/i);

    // The card's commercial fields come along with it.
    await expect(line.locator('[data-testid="po-cost"]')).toHaveValue('4.5');
    await expect(line.locator('[data-testid="po-lot"]')).toHaveValue('10');
  });

  test('changing Size to one you already stock re-links rather than inventing a Variety', async ({ page }) => {
    // ADR-0014. "Same flower, different length" is a re-pick, not a new Variety
    // — treating it as new is how stock fragments (#319).
    await seedPeonySizes();
    const line = await openNewOrderForm(page);
    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    await line.locator('[data-testid="nv-size"]').fill('70');

    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/карточки склада|stock card/i);
    await expect(line.locator('[data-testid="stock-search-input"]')).toHaveValue('Peony Pink 70cm');
    await expect(line.locator('[data-testid="po-cost"]')).toHaveValue('5.2');
  });

  test('changing Colour to something you do not stock detaches the line', async ({ page }) => {
    // The #558 guard. Evaluation ignores Variety attrs on a LINKED line, so a
    // line showing White while still linked to the Pink card would receive
    // White stems into Pink. Detaching is what keeps that impossible.
    await seedPeonySizes();
    const line = await openNewOrderForm(page);
    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    await line.locator('[data-testid="nv-colour"]').fill('White');

    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/новый сорт|new variety/i);
    await expect(line.locator('[data-testid="nv-colour"]')).toHaveValue('White');

    // The name must follow the Variety, not linger from the card we just left.
    // Evaluation names a brand-new Variety from this field, so a stale
    // "Peony Pink 60cm" would create a WHITE peony card under a pink name.
    await expect(line.locator('[data-testid="stock-search-input"]'))
      .toHaveValue('Peony White 60cm Sarah B.');
  });

  test('Packages is shown, derived from stems, and editable in both directions', async ({ page }) => {
    await seedPeonySizes();
    const line = await openNewOrderForm(page);
    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    await line.locator('[data-testid="po-qty"]').fill('40');
    await expect(line.locator('[data-testid="po-packages"]')).toHaveValue('4');

    // Editing Packages drives stems…
    await line.locator('[data-testid="po-packages"]').fill('6');
    await expect(line.locator('[data-testid="po-qty"]')).toHaveValue('60');

    // …and a stem count that is not a whole number of packages reports the
    // fraction rather than quietly rounding the owner's number.
    await line.locator('[data-testid="po-qty"]').fill('35');
    await expect(line.locator('[data-testid="po-packages"]')).toHaveValue('3.5');
  });

  test('a line added to a Sent order gets the same form, not a reduced one', async ({ page }) => {
    // The complaint that started this work: each surface showed a different
    // subset of fields.
    const { p60 } = await seedPeonySizes();
    const po = await seedStockOrder([
      { stockItemId: p60.id, flowerName: 'Peony Pink 60cm', quantity: 20, costPrice: 4.5 },
    ]);
    await sendStockOrder(po.id);

    await login(page, '1111');
    await gotoPurchaseOrders(page);
    await page.getByText(po['Stock Order ID']).first().click();
    await page.getByRole('button', { name: /Add line|Добавить позицию/i }).first().click();

    const addForm = page.locator('[data-testid="po-line-form"]').last();
    for (const id of ['stock-search-input', 'nv-type', 'nv-colour', 'nv-size', 'nv-cultivar',
                      'po-qty', 'po-lot', 'po-packages', 'po-cost', 'po-sell']) {
      await expect(addForm.locator(`[data-testid="${id}"]`)).toBeVisible();
    }
  });
});

test.describe('Stock Order termination', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('a Shopping order can be cancelled and stops counting as incoming stock', async ({ page }) => {
    // ADR-0015 end to end, including the half the owner actually noticed:
    // cancelled work must disappear from pending arrivals.
    const { p60 } = await seedPeonySizes();
    const po = await seedStockOrder([
      { stockItemId: p60.id, flowerName: 'Peony Pink 60cm', quantity: 30, costPrice: 4.5 },
    ]);
    await sendStockOrder(po.id);
    await startShopping(po.id, po.lines[0].id);

    const before = await harnessApi('/api/stock/pending-po', { method: 'GET' });
    expect(before[p60.id]?.ordered).toBe(30);

    await login(page, '1111');
    await gotoPurchaseOrders(page);
    await page.getByText(po['Stock Order ID']).first().click();

    page.once('dialog', d => d.accept());   // the "tell the driver" confirm
    await page.getByRole('button', { name: /^(Cancel|Отменить)$/i }).first().click();

    await expect.poll(async () => {
      const detail = await harnessApi(`/api/stock-orders/${po.id}`, { method: 'GET' });
      return detail.Status;
    }).toBe('Cancelled');

    const after = await harnessApi('/api/stock/pending-po', { method: 'GET' });
    expect(after[p60.id]).toBeUndefined();
  });
});
