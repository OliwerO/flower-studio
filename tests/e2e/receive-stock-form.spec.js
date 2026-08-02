// UI spec: the florist "Receive stock" form (#604).
//
// This is the screen used most often and under the most time pressure, and its
// whole identity check used to be "the name is not empty" — Type was optional
// and silently fell back to whatever was typed as the name, so `Pink Peonies`
// produced a flower whose Type is `Pink Peonies`. Prod carries five such cards.
//
// SAFETY: everything runs against the pglite harness on :3002.
// `start-test-backend.js` force-sets DATABASE_URL=pglite:memory before any
// import and refuses to boot under NODE_ENV=production, so these specs cannot
// reach the production database.
//
// Run:  npx playwright test receive-stock-form

import { test, expect } from './helpers/test-base.js';
import { login } from './helpers/login.js';
import { seedPeonySizes } from './helpers/seed.js';

test.describe('Receive stock form', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  /** Open Stock → Receive stock the way a person does (never page.goto). */
  async function openReceiveForm(page) {
    await login(page, '1111');
    await page.getByRole('button', { name: /Склад|Stock/i }).first().click();
    await page.waitForURL(/\/stock$/);
    await page.getByRole('button', { name: /Приёмка|Receive/i }).first().click();
    await expect(page.getByTestId('receive-search')).toBeVisible();
  }

  /** Set a Variety attribute deliberately — the fields are pickers now (#610). */
  async function setVariety(page, field, value) {
    const input = page.locator(`[data-testid="nv-${field}"]`);
    await input.fill(value);
    const create = page.locator(`[data-testid="nv-${field}-create"]`);
    const isNew = await create.waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
    if (isNew) await create.click();
    else await input.blur();
  }

  test('the flower list can be searched instead of scrolled', async ({ page }) => {
    await seedPeonySizes();
    await openReceiveForm(page);

    // Everything she owns is listed by default.
    await expect(page.getByRole('button', { name: /Peony Pink 60cm/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hydrangea Blue 70cm/ })).toBeVisible();

    await page.getByTestId('receive-search').fill('hydr');
    await expect(page.getByRole('button', { name: /Hydrangea Blue 70cm/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Peony Pink 60cm/ })).toHaveCount(0);
  });

  test('a new flower cannot be received without a Type', async ({ page }) => {
    // The name-as-Type fallback is what produced cards typed `Pink Peonies`.
    await seedPeonySizes();
    await openReceiveForm(page);

    await page.getByRole('button', { name: /Новая позиция|New item/i }).first().click();
    await expect(page.getByTestId('vrn-badge')).toContainText(/не выбран|not selected/i);
    await expect(page.getByTestId('vrn-hint')).toBeVisible();
  });

  test('an existing flower is named back to her, with no create prompt', async ({ page }) => {
    await seedPeonySizes();
    await openReceiveForm(page);
    await page.getByRole('button', { name: /Новая позиция|New item/i }).first().click();

    await setVariety(page, 'type', 'Peony');
    await setVariety(page, 'colour', 'Pink');
    await setVariety(page, 'size', '60');
    await setVariety(page, 'cultivar', 'Sarah B.');

    await expect(page.getByTestId('vrn-badge')).toContainText(/карточки склада|stock card/i);
    await expect(page.getByTestId('vrn-resolved')).toHaveText('Peony Pink 60cm');
    await expect(page.getByTestId('vrn-confirm')).toHaveCount(0);
  });

  test('a genuinely new flower asks first, and names what it will create', async ({ page }) => {
    await seedPeonySizes();
    await openReceiveForm(page);
    await page.getByRole('button', { name: /Новая позиция|New item/i }).first().click();

    await setVariety(page, 'type', 'Ranunculus');
    await setVariety(page, 'colour', 'Peach');

    await expect(page.getByTestId('vrn-badge')).toContainText(/Новый сорт|New variety/i);
    await expect(page.getByTestId('vrn-prompt')).toContainText('Ranunculus Peach');

    await page.getByTestId('vrn-confirm').click();
    await expect(page.getByTestId('vrn-confirmed')).toContainText('Ranunculus Peach');
  });

  test('changing the flower after confirming puts the question back', async ({ page }) => {
    // A stale confirmation is how the wrong flower gets created silently.
    await seedPeonySizes();
    await openReceiveForm(page);
    await page.getByRole('button', { name: /Новая позиция|New item/i }).first().click();

    await setVariety(page, 'type', 'Ranunculus');
    await setVariety(page, 'colour', 'Peach');
    await page.getByTestId('vrn-confirm').click();
    await expect(page.getByTestId('vrn-confirmed')).toBeVisible();

    await setVariety(page, 'colour', 'Coral');
    await expect(page.getByTestId('vrn-confirmed')).toHaveCount(0);
    await expect(page.getByTestId('vrn-prompt')).toContainText('Ranunculus Coral');
  });
});
