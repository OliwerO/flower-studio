// Shared helper: log in via PIN entry on the LoginPage.
//
// All three React apps (florist :5173, delivery :5174, dashboard :5175)
// route to /login on first hit and gate every other page behind a successful
// PIN auth. The harness's known PINs (from start-test-backend.js):
//   1111  = owner
//   2222  = florist
//   3333  = driver Timur
//   4444  = driver Nikita
//
// Usage in a spec:
//   await login(page, '1111');                   // owner on whichever app baseURL points at
//   await login(page, '2222', { app: 'florist' });
//
// LoginPage uses a numpad — the helper clicks one digit at a time, then presses
// the submit button, which only appears once four digits are entered. It
// prefers data-testid selectors and falls back to button text, so it works
// whether or not the components carry testids.

const PIN_DIGIT_SELECTOR = (digit) =>
  `[data-testid="pin-digit-${digit}"], button:has-text("${digit}")`;

const SUBMIT_SELECTOR =
  '[data-testid="pin-submit"], button:has-text("Войти"), button:has-text("Log in")';

export async function login(page, pin, opts = {}) {
  const url = opts.url || '/login';
  await page.goto(url);

  for (const digit of pin) {
    // `.first()` matters — a text selector for "1" also matches "11", "12"…
    await page.locator(PIN_DIGIT_SELECTOR(digit)).first().click();
  }

  // Some builds auto-submit on the fourth digit; the florist app reveals a
  // button instead. Click it when present, don't fail when it isn't.
  const submit = page.locator(SUBMIT_SELECTOR).first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  }

  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 10_000 });
}

/**
 * Navigate to the Purchase Orders screen the way a person would.
 *
 * IMPORTANT: never `page.goto()` after logging in. Auth lives in a React
 * reducer with no localStorage or cookie (see shared `AuthContext`), so a URL
 * navigation remounts the app, drops the session, and bounces you back to
 * /login. Every post-login step in a UI spec has to be an in-app click.
 *
 * Route: /orders (post-login landing) → Stock tab → the "Purchase Orders" tile.
 */
export async function gotoPurchaseOrders(page) {
  await page.getByRole('button', { name: /Склад|Stock/i }).first().click();
  await page.waitForURL(/\/stock$/);
  await page.getByText(/Заказы поставщикам|Purchase Orders/i).first().click();
  await page.waitForURL(/\/purchase-orders/);
}
