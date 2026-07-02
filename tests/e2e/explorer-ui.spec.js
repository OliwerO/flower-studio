// E2E spec: the owner drives the unified Explorer (ADR-0010/0011, PRD #485/#496)
// end-to-end through the dashboard UI against the local-PG harness.
//
// The grid is one path-based surface (0 hops = plain; "+ add related" extends it
// into a flat multi-hop report). Covers: open → grid → EN relabel → switch entity
// → column picker → save view → CSV; and the path builder → add a related hop →
// hop-prefixed columns + fan-out warning.
//
// Runs against the dashboard on :5175 (auto-auths from VITE_OWNER_PIN) proxied to
// the harness backend on :3002. reuseExistingServer reuses running servers.

import { test, expect } from '@playwright/test';

test.describe('Explorer — unified linked-record grid', () => {
  test.use({ baseURL: 'http://localhost:5175' });

  test('open → grid → EN relabel → switch entity → column picker → save view → CSV', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Обозреватель', exact: true }).click();

    const tab = page.getByTestId('explorer-tab');
    await expect(tab).toBeVisible();

    const grid = page.getByTestId('explorer-grid');
    await expect(grid).toBeVisible();
    await expect(page.getByTestId('explorer-entity')).toHaveValue('orders');

    // Column labels follow the language toggle (descriptor ships RU + EN).
    await expect(grid).toContainText('Дата заказа');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(grid).toContainText('Order date');

    // Column picker: Orders opens with the curated primary columns; adding one grows the set.
    const colsToggle = page.getByTestId('explorer-columns-toggle');
    await expect(colsToggle).toContainText('(3)'); // orderDate · status · price
    await colsToggle.click();
    await page.getByTestId('explorer-col-orders.id').check();
    await expect(colsToggle).toContainText('(4)');
    await colsToggle.click(); // close the picker

    // Switch to Customers → grid re-queries.
    await page.getByTestId('explorer-entity').selectOption('customers');
    await expect(page.getByTestId('explorer-entity')).toHaveValue('customers');
    await expect(page.getByTestId('explorer-row').first()).toBeVisible();

    // Save a named view + CSV available.
    await page.getByTestId('explorer-save-view').click();
    await page.getByTestId('explorer-save-name').fill('E2E view');
    await page.getByTestId('explorer-save-confirm').click();
    await page.getByTestId('explorer-views-toggle').click();
    await expect(page.getByRole('button', { name: 'E2E view' }).first()).toBeVisible();
    await expect(page.getByTestId('explorer-csv')).toBeEnabled();
  });

  test('path builder: add a related hop → hop-prefixed columns + fan-out warning', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Обозреватель', exact: true }).click();
    await expect(page.getByTestId('explorer-tab')).toBeVisible();
    await expect(page.getByTestId('explorer-entity')).toHaveValue('orders');

    // The path builder is always present (no separate mode toggle).
    await expect(page.getByTestId('explorer-chain-builder')).toBeVisible();

    // Add the "lines" hop (orders → order_lines, one-to-many).
    await page.getByTestId('explorer-chain-add').click();
    await page.getByTestId('explorer-chain-hop-lines').click();

    // Columns become hop-prefixed ("Entity · Field") and a fan-out warning shows.
    await expect(page.getByTestId('explorer-grid')).toContainText('·');
    await expect(page.getByTestId('explorer-fanout-warning')).toBeVisible();

    // Removing the hop returns to a plain grid (warning gone).
    await page.getByTestId('explorer-chain-remove').click();
    await expect(page.getByTestId('explorer-fanout-warning')).toHaveCount(0);
  });
});
