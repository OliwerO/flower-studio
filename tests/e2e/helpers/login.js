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
// LoginPage uses a numpad — the helper clicks one digit at a time. When the
// React components add data-testid attributes for the digit buttons, this
// helper switches to those. Until then it falls back to button text.

const PIN_DIGIT_SELECTOR = (digit) =>
  `[data-testid="pin-digit-${digit}"], button:has-text("${digit}")`;

export async function login(page, pin, opts = {}) {
  const url = opts.url || '/login';
  await page.goto(url);
  for (const digit of pin) {
    await page.locator(PIN_DIGIT_SELECTOR(digit)).first().click();
  }
  // The login submission typically auto-fires when the 4th digit is entered.
  // If your LoginPage requires an explicit submit, add a click on the submit
  // button here (e.g. `await page.click('[data-testid="pin-submit"]')`).
  await page.waitForURL((url) => !url.pathname.includes('/login'));
}
