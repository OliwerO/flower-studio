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

  /**
   * Set a Variety attribute the way a person does (#610).
   *
   * The 4-tuple fields are `ValueCombobox`es now, so typing alone commits
   * nothing — an unknown value takes a deliberate click on the create row, and
   * a known one is snapped to its stored casing when the field closes. A spec
   * that just `fill()`s is testing a control that no longer exists.
   */
  async function setVariety(line, field, value) {
    const input = line.locator(`[data-testid="nv-${field}"]`);
    await input.fill(value);
    const create = line.locator(`[data-testid="nv-${field}-create"]`);
    const isNew = await create.waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
    if (isNew) await create.click();
    else await input.blur();
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

    await setVariety(line, 'size', '70');

    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/карточки склада|stock card/i);
    await expect(line.locator('[data-testid="stock-search-input"]')).toHaveValue('Peony Pink 70cm');
    await expect(line.locator('[data-testid="po-cost"]')).toHaveValue('5.2');
  });

  test('changing Colour to something you do not stock asks before creating it', async ({ page }) => {
    // ADR-0016. Silently minting a Variety from a typo is what fragmented stock
    // (#562), so a no-match edit is not applied until the owner confirms — and
    // cancelling puts the previous flower back.
    await seedPeonySizes();
    const line = await openNewOrderForm(page);
    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    await setVariety(line, 'colour', 'White');
    await expect(line.locator('[data-testid="po-new-variety-prompt"]')).toBeVisible();

    // Cancel restores the flower we came from — no half-applied identity.
    await line.locator('[data-testid="po-new-variety-cancel"]').click();
    await expect(line.locator('[data-testid="po-new-variety-prompt"]')).toBeHidden();
    await expect(line.locator('[data-testid="nv-colour"]')).toHaveValue('Pink');

    // Confirming is the only path that creates one.
    await setVariety(line, 'colour', 'White');
    await line.locator('[data-testid="po-new-variety-confirm"]').click();
    await expect(line.locator('[data-testid="nv-colour"]')).toHaveValue('White');
    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/новый сорт|new variety/i);

    // The name must follow the Variety, not linger from the card we left —
    // evaluation names a new Variety from this field.
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

  test('a Variety attribute is picked from a list, and a near-miss cannot invent one', async ({ page }) => {
    // #610. The owner met four plain-looking boxes, typed `DA` for Dahlia, and
    // free-text is how `dahlia` lands beside `Dahlia` — two cards, one flower,
    // neither showing the true count. So: the list opens and shows what she
    // already uses, a differently-cased match snaps to the stored spelling, and
    // a value that matches nothing is not committed by typing alone.
    await seedPeonySizes();
    const line = await openNewOrderForm(page);
    await pickFlower(line, page, 'Peony Pink 60', 'Peony Pink 60cm');

    // The list is real and shows the Colours already in stock.
    await line.locator('[data-testid="nv-colour-toggle"]').click();
    await expect(line.locator('[data-testid="nv-colour-option"]', { hasText: /^Pink$/ })).toBeVisible();

    // A differently-cased match snaps to the stored casing — never a rival value.
    const colour = line.locator('[data-testid="nv-colour"]');
    await colour.fill('pink');
    await colour.blur();
    await expect(colour).toHaveValue('Pink');

    // A typo commits nothing: leaving the field puts the real value back, and
    // the line is still linked to the flower she picked.
    await colour.fill('Pnk');
    await colour.blur();
    await expect(colour).toHaveValue('Pink');
    await expect(line.locator('[data-testid="po-new-variety-prompt"]')).toBeHidden();
    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/карточки склада|stock card/i);
  });
});

test.describe('A PO line resolves, never invents (#607)', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  async function openNewOrderForm(page) {
    await login(page, '1111');
    await gotoPurchaseOrders(page);
    await page.getByRole('button', { name: /Новый заказ поставщику|New Purchase Order/i }).first().click();
    const line = page.locator('[data-testid="po-line-form"]').first();
    await expect(line).toBeVisible();
    return line;
  }

  async function setVariety(line, field, value) {
    const input = line.locator(`[data-testid="nv-${field}"]`);
    await input.fill(value);
    const create = line.locator(`[data-testid="nv-${field}-create"]`);
    const isNew = await create.waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
    if (isNew) await create.click();
    else await input.blur();
  }

  const poIds = async () => (await harnessApi('/api/stock-orders', { method: 'GET' })).map(o => o.id);

  /** Save the form and return the order that appeared — the fixture has its own. */
  async function saveAndGetNewOrder(page, before) {
    await page.getByRole('button', { name: /^(Сохранить|Save)$/i }).first().click();
    let created;
    await expect.poll(async () => {
      created = (await poIds()).find(id => !before.includes(id));
      return !!created;
    }).toBe(true);
    return { id: created };
  }

  test('a flower she does not stock is refused until she confirms it', async ({ page }) => {
    // The whole point of the slice, exercised the only way that proves the
    // wiring: the confirm has to reach the server as `newVariety`, and the
    // server has to refuse the PO without it. A component test sees the button;
    // an integration test sees the field; neither sees them joined up.
    await seedPeonySizes();
    const before = await poIds();
    const line = await openNewOrderForm(page);

    await setVariety(line, 'type', 'Peony');
    await setVariety(line, 'colour', 'Coral');
    await line.locator('[data-testid="po-qty"]').fill('10');

    await expect(line.locator('[data-testid="po-new-variety-notice"]')).toBeVisible();

    await line.locator('[data-testid="po-new-variety-notice-confirm"]').click();
    await expect(line.locator('[data-testid="po-new-variety-confirmed"]')).toBeVisible();

    const po = await saveAndGetNewOrder(page, before);
    const detail = await harnessApi(`/api/stock-orders/${po.id}`, { method: 'GET' });
    expect(detail.lines[0]['New Variety']).toBe(true);
    expect(detail.lines[0]['Stock Item']).toEqual([]);

    // And nothing was created in stock — a PO line is an intent to buy.
    const stock = await harnessApi('/api/stock?includeEmpty=true', { method: 'GET' });
    expect(stock.some(s => s.Colour === 'Coral')).toBe(false);
  });

  test('an identity that matches a flower she has links silently, with no question', async ({ page }) => {
    const { p60 } = await seedPeonySizes();
    const before = await poIds();
    const line = await openNewOrderForm(page);

    await setVariety(line, 'type', 'Peony');
    await setVariety(line, 'colour', 'Pink');
    await setVariety(line, 'size', '60');
    await setVariety(line, 'cultivar', 'Sarah B.');
    await line.locator('[data-testid="po-qty"]').fill('10');

    await expect(line.locator('[data-testid="po-new-variety-notice"]')).toBeHidden();
    await expect(line.locator('[data-testid="po-variety-badge"]')).toHaveText(/карточки склада|stock card/i);

    const po = await saveAndGetNewOrder(page, before);
    const detail = await harnessApi(`/api/stock-orders/${po.id}`, { method: 'GET' });
    expect(detail.lines[0]['Stock Item']).toEqual([p60.id]);
    expect(detail.lines[0]['New Variety']).toBe(false);
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
