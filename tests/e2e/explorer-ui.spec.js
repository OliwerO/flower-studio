// E2E spec: the owner drives the Explorer tab (ADR-0010, PRD #485) end-to-end
// through the dashboard UI against the local-PG harness.
//
// Covers the load-bearing UX: open the tab → grid renders → switch entity →
// drill a related entity (seeded single-hop query) → save a named view →
// CSV export is available. Read-only throughout — Explorer never mutates data.
//
// Runs against the dashboard on :5175 (which auto-auths from VITE_OWNER_PIN)
// proxied to the harness backend on :3002. `reuseExistingServer` in
// playwright.config.js reuses already-running servers; CI boots them fresh.
// NOTE: the dashboard webServer must run with VITE_OWNER_PIN=1111 for the
// auto-auth to succeed (see playwright.config.js dashboard entry).

import { test, expect } from '@playwright/test';

test.describe('Explorer — owner linked-record grid', () => {
  test.use({ baseURL: 'http://localhost:5175' });

  test('open → grid → switch entity → drill → save view → CSV', async ({ page }) => {
    await page.goto('/');

    // Open the Explorer tab (Russian pill label).
    await page.getByRole('button', { name: 'Обозреватель', exact: true }).click();

    const tab = page.getByTestId('explorer-tab');
    await expect(tab).toBeVisible();
    await expect(tab.getByText('Обозреватель данных')).toBeVisible();

    // Default entity is Orders; the harness fixture seeds a few orders.
    const grid = page.getByTestId('explorer-grid');
    await expect(grid).toBeVisible();
    await expect(page.getByTestId('explorer-row').first()).toBeVisible();
    const orderRows = await page.getByTestId('explorer-row').count();
    expect(orderRows).toBeGreaterThan(0);

    // Entity picker reflects the current entity.
    await expect(page.getByTestId('explorer-entity')).toHaveValue('orders');

    // Column labels follow the dashboard language toggle (descriptor ships RU + EN).
    await expect(grid).toContainText('Дата заказа'); // RU by default
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(grid).toContainText('Order date'); // now English

    // Switch to Customers → grid re-queries.
    await page.getByTestId('explorer-entity').selectOption('customers');
    await expect(page.getByTestId('explorer-entity')).toHaveValue('customers');
    await expect(page.getByTestId('explorer-row').first()).toBeVisible();

    // Drill: from a customer row, follow "→ Orders" (a seeded single-hop query).
    await page.getByTestId('explorer-row').first().getByTestId('explorer-drill-orders').click();
    await expect(page.getByTestId('explorer-entity')).toHaveValue('orders');
    // Breadcrumb back control appears after a drill (label is language-dependent).
    await expect(page.getByRole('button', { name: /Back|Назад/ })).toBeVisible();

    // Reset to a clean Orders view before saving.
    await page.getByTestId('explorer-entity').selectOption('orders');

    // Save a named view.
    await page.getByTestId('explorer-save-view').click();
    const viewName = 'E2E saved view';
    await page.getByTestId('explorer-save-name').fill(viewName);
    await page.getByTestId('explorer-save-confirm').click();

    // The saved view appears in the Saved-views dropdown.
    await page.getByTestId('explorer-views-toggle').click();
    await expect(page.getByRole('button', { name: viewName })).toBeVisible();

    // CSV export is available while rows are loaded.
    await expect(page.getByTestId('explorer-csv')).toBeEnabled();
  });
});
