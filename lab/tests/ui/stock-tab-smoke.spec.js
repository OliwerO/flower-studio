import { test, expect } from '@playwright/test';

// Smoke test: dashboard loads, stock tab renders rows from the seeded baseline.
// The dashboard auto-authenticates via VITE_OWNER_PIN — no login screen.
// Catches Vite build errors, import collapses, white-screen-on-load.
// Doesn't assert specific row content (scenario-dependent).

test('dashboard stock tab renders seeded stock items', async ({ page }) => {
  await page.goto('/');

  // Dashboard is auto-authenticated (VITE_OWNER_PIN). Wait for the page to
  // be fully hydrated by checking the nav header is visible.
  await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

  // Click the Stock tab. The dashboard renders plain <button> elements in
  // the nav (not ARIA tabs). Tab labels are 'Stock' (EN) or 'Склад' (RU).
  await page.getByRole('button', { name: /^(Stock|Склад)$/ }).click();

  // Wait for at least one stock row — baseline has 30+ items.
  // Rows carry data-testid="stock-row" (added to StockTab.jsx StockRow component).
  const rows = page.locator('[data-testid="stock-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(5);
});
