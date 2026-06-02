# Florist New-Order Telegram Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a new Order is created (any path), send a Russian-language Telegram ping to the shared florist phone, which registers once via `/start <PIN_FLORIST>` on the existing alerts bot.

**Architecture:** Mirrors the shipped Driver Assignment Notification (ADR-0009, PR #369). Reuses the single alerts bot (`TELEGRAM_BOT_TOKEN`) and its inbound `/start` registration loop (`driverBot.js`), the `sendToChat`/`escapeHtml` helpers, and the `SUPPORTED_LANGS`/lang model. Florists share ONE `PIN_FLORIST` and ONE phone, so storage is a singleton in `system_meta` (no migration, no new table) rather than the per-name `driver_telegram_chats` table.

**Tech Stack:** Node/Express, Drizzle (Postgres), Telegram Bot API, Vitest, pglite (tests).

---

## PRD (design capture)

### Problem
Florists don't reliably learn that a new order arrived — especially Wix/Flowwow orders that appear without anyone typing them. The owner wanted a Telegram ping like the one drivers now get on assignment.

### Solution
The shared florist phone sends `/start 2580` to the alerts bot once. From then on, every new Order (manual, Wix, Flowwow, AI-intake, premade conversion) produces a targeted Russian-language Telegram message to that phone with order #, date/time, type, customer, and request.

### Key decisions (locked with owner 2026-06-02)
- **One shared alerts bot.** Telegram routes by `chat_id`, not by bot — the owner never receives florist/driver targeted pings on a shared bot. No need for separate bots.
- **One shared florist phone, group model, one language.** No per-florist identity (they share `PIN_FLORIST`). Language is a single group setting (ru default, owner-settable, en/pl supported).
- **All creation paths.** Hook co-located with the existing `notifyNewOrder` calls — exactly `orderService.createOrder` + `wix.js` (intake/Flowwow/AI/premade all funnel through `createOrder`).
- **Singleton storage in `system_meta`.** Keys `florist_chat_id` + `florist_notify_lang`. No migration; zero risk to the regression-locked `driver_telegram_chats` table. (Promote to a `florist_telegram_chats` table only if multi-phone is ever needed — noted as follow-up.)
- **New `/start`-registered Russian ping**, distinct from the legacy English `broadcastAlert` (which the owner keeps for her own `TELEGRAM_CHAT_IDS` visibility).

### Modules
| Module | Responsibility |
|---|---|
| `floristTelegramRepo.js` (new) | get/set florist chat_id + lang, backed by `system_meta` kv |
| `driverPins.js` (`resolveFloristByPin`) | resolve `PIN_FLORIST` → `'florist'` |
| `driverBot.js` (extend loop) | `/start <PIN_FLORIST>` → store florist chat_id + confirm in lang |
| `floristNotifyService.js` (new) | `notifyFloristNewOrder()` — compose + send Russian ping, never throws |
| `orderService.js` + `wix.js` | fire `notifyFloristNewOrder` at creation (×2 sites) |
| `routes/settings.js` (`PUT /florist-language`) | owner sets the group language |

### Testing
Test external behavior only, mocking Telegram (`sendToChat`) and the repo. Prior art: `driverNotifyService.test.js`, `driverBot.test.js`, `driverPins.test.js`, `settings.driver-language.integration.test.js`, `driverTelegramRepo.integration.test.js`. Integration tests use the pglite harness; run backend with `--no-file-parallelism` (pglite flakes under parallel load).

### Out of scope
- Per-florist identity / multi-phone (singleton now).
- Florist app UI for language (set via endpoint, like drivers).
- Retiring/changing the legacy `broadcastAlert` new-order path.
- The driver half (already shipped, #369).

---

## Task 1: floristTelegramRepo (system_meta kv)

**Files:**
- Create: `backend/src/repos/floristTelegramRepo.js`
- Test: `backend/src/__tests__/floristTelegramRepo.integration.test.js`

Backed by `system_meta` (`backend/src/db/schema.js` → `systemMeta`, columns `key` PK / `value`). Keys: `florist_chat_id`, `florist_notify_lang`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/__tests__/floristTelegramRepo.integration.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js'; // match existing helper used by driverTelegramRepo.integration.test.js
import {
  getFloristChatId, setFloristChatId, getFloristLang, setFloristLang,
} from '../repos/floristTelegramRepo.js';

describe('floristTelegramRepo', () => {
  beforeEach(async () => { await setupPgHarness(); });
  afterEach(async () => { await teardownPgHarness(); });

  it('returns null chat id and default ru lang before registration', async () => {
    expect(await getFloristChatId()).toBeNull();
    expect(await getFloristLang()).toBe('ru');
  });

  it('stores and reads back the florist chat id', async () => {
    await setFloristChatId('555');
    expect(await getFloristChatId()).toBe('555');
  });

  it('setFloristChatId preserves a previously set lang', async () => {
    await setFloristLang('en');
    await setFloristChatId('555');
    expect(await getFloristLang()).toBe('en');
    expect(await getFloristChatId()).toBe('555');
  });

  it('setFloristLang works before any chat id is registered', async () => {
    await setFloristLang('pl');
    expect(await getFloristLang()).toBe('pl');
    expect(await getFloristChatId()).toBeNull();
  });
});
```

> NOTE: open `backend/src/__tests__/driverTelegramRepo.integration.test.js` first and copy its EXACT harness import/setup (helper name + path may differ from the placeholder above).

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && npx vitest run src/__tests__/floristTelegramRepo.integration.test.js --no-file-parallelism`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// backend/src/repos/floristTelegramRepo.js
// Singleton Telegram registration for the shared florist phone. Florists share
// one PIN and one phone, so there is exactly one chat id and one group language
// — stored as system_meta kv, no dedicated table (cf. driver_telegram_chats,
// which is per-driver-name). Promote to a table only if multi-phone is needed.
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemMeta } from '../db/schema.js';

const CHAT_KEY = 'florist_chat_id';
const LANG_KEY = 'florist_notify_lang';

async function getMeta(key) {
  const [row] = await db.select({ value: systemMeta.value })
    .from(systemMeta).where(eq(systemMeta.key, key));
  return row?.value ?? null;
}

async function setMeta(key, value) {
  await db.insert(systemMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemMeta.key, set: { value } });
}

export async function getFloristChatId() {
  return getMeta(CHAT_KEY);
}

export async function setFloristChatId(chatId) {
  await setMeta(CHAT_KEY, chatId);
}

export async function getFloristLang() {
  return (await getMeta(LANG_KEY)) || 'ru';
}

export async function setFloristLang(lang) {
  await setMeta(LANG_KEY, lang);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && npx vitest run src/__tests__/floristTelegramRepo.integration.test.js --no-file-parallelism`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/floristTelegramRepo.js backend/src/__tests__/floristTelegramRepo.integration.test.js
git commit -m "feat(telegram): florist chat_id + lang singleton repo (system_meta kv)"
```

---

## Task 2: resolveFloristByPin

**Files:**
- Modify: `backend/src/utils/driverPins.js`
- Test: `backend/src/__tests__/driverPins.test.js` (extend existing)

- [ ] **Step 1: Write the failing test** (append to `driverPins.test.js`)

```js
import { resolveFloristByPin } from '../utils/driverPins.js';

describe('resolveFloristByPin', () => {
  const orig = process.env.PIN_FLORIST;
  beforeEach(() => { process.env.PIN_FLORIST = '2580'; });
  afterEach(() => { process.env.PIN_FLORIST = orig; });

  it('resolves the florist PIN to "florist"', () => {
    expect(resolveFloristByPin('2580')).toBe('florist');
  });
  it('returns null for a wrong PIN', () => {
    expect(resolveFloristByPin('0000')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(resolveFloristByPin('')).toBeNull();
    expect(resolveFloristByPin(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/__tests__/driverPins.test.js`
Expected: FAIL (`resolveFloristByPin` not exported).

- [ ] **Step 3: Implement** (add to `driverPins.js`; `safeEqual` is already imported)

```js
// Florists share a single PIN_FLORIST (no per-florist identity). Resolves to the
// reserved key 'florist' used by the registration loop + notify seam.
export function resolveFloristByPin(pin) {
  if (!pin) return null;
  return safeEqual(process.env.PIN_FLORIST, pin) ? 'florist' : null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/__tests__/driverPins.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/driverPins.js backend/src/__tests__/driverPins.test.js
git commit -m "feat(telegram): resolveFloristByPin for /start registration"
```

---

## Task 3: Florist registration in the alerts-bot loop

**Files:**
- Modify: `backend/src/services/driverBot.js`
- Test: `backend/src/__tests__/driverBot.test.js` (extend existing)

Extend `handleDriverUpdate`: on `/start <PIN>`, try driver resolution first (unchanged); if that misses, try `resolveFloristByPin`. On a florist match, `setFloristChatId(chatId)` and confirm in the stored florist lang. Keep the existing register-error guard (send error + return on write failure).

- [ ] **Step 1: Write the failing test** (extend `driverBot.test.js`, matching its existing mock style — mocks `telegram.js`, `driverTelegramRepo.js`, `driverPins.js`; ADD mocks for `floristTelegramRepo.js`)

```js
// florist branch
it('registers the florist phone on /start <PIN_FLORIST> and confirms', async () => {
  resolveDriverByPin.mockReturnValue(null);
  resolveFloristByPin.mockReturnValue('florist');
  getFloristLang.mockResolvedValue('ru');
  await handleDriverUpdate({ message: { chat: { id: 555 }, text: '/start 2580' } });
  expect(setFloristChatId).toHaveBeenCalledWith('555');
  expect(sendToChat).toHaveBeenCalledWith('555', expect.stringContaining('🌸'));
});

it('does not register florist when neither driver nor florist PIN matches', async () => {
  resolveDriverByPin.mockReturnValue(null);
  resolveFloristByPin.mockReturnValue(null);
  await handleDriverUpdate({ message: { chat: { id: 555 }, text: '/start nope' } });
  expect(setFloristChatId).not.toHaveBeenCalled();
  expect(sendToChat).toHaveBeenCalledWith('555', expect.stringContaining('PIN'));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/__tests__/driverBot.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** in `driverBot.js`

Add imports:
```js
import { resolveDriverByPin, resolveFloristByPin } from '../utils/driverPins.js';
import { setFloristChatId, getFloristLang } from '../repos/floristTelegramRepo.js';
```
Add a florist confirmation table near `REGISTERED`:
```js
const FLORIST_REGISTERED = {
  ru: '🌸 Готово! Вы будете получать уведомления о новых заказах.',
  en: "🌸 Done! You'll receive notifications about new orders.",
  pl: '🌸 Gotowe! Będziesz otrzymywać powiadomienia o nowych zamówieniach.',
};
```
In `handleDriverUpdate`, inside the `/start` branch, after the existing driver path fails to resolve (i.e. replace the current `else { sendToChat(BAD_PIN) }` tail), insert the florist attempt BEFORE falling back to BAD_PIN:
```js
const driverName = resolveDriverByPin(pin);
if (driverName) {
  /* ...existing driver registration unchanged... */
  return;
}
if (resolveFloristByPin(pin)) {
  try {
    await setFloristChatId(chatId);
  } catch (err) {
    console.error('[DRIVER_BOT] florist register error:', err.message);
    await sendToChat(chatId, REG_ERROR);
    return;
  }
  const lang = await getFloristLang().catch(() => 'ru');
  await sendToChat(chatId, FLORIST_REGISTERED[lang] || FLORIST_REGISTERED.ru);
  return;
}
await sendToChat(chatId, BAD_PIN);
return;
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/__tests__/driverBot.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverBot.js backend/src/__tests__/driverBot.test.js
git commit -m "feat(telegram): register shared florist phone via /start on alerts bot"
```

---

## Task 4: floristNotifyService.notifyFloristNewOrder

**Files:**
- Create: `backend/src/services/floristNotifyService.js`
- Test: `backend/src/__tests__/floristNotifyService.test.js`

Reads florist chat_id + lang; if no chat id, skip (log). Composes a Russian/lang message; escapes user fields; sends via `sendToChat`. NEVER throws into the caller (try/catch like `driverNotifyService`).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../repos/floristTelegramRepo.js');
vi.mock('../services/telegram.js', async (orig) => ({
  ...(await orig()),
  sendToChat: vi.fn(),
}));
import { getFloristChatId, getFloristLang } from '../repos/floristTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';
import { notifyFloristNewOrder } from '../services/floristNotifyService.js';

beforeEach(() => { vi.clearAllMocks(); });

it('skips when no florist phone is registered', async () => {
  getFloristChatId.mockResolvedValue(null);
  await notifyFloristNewOrder({ order: { 'App Order ID': '123' } });
  expect(sendToChat).not.toHaveBeenCalled();
});

it('sends a Russian message with order number to the registered phone', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  await notifyFloristNewOrder({
    order: { 'App Order ID': '123', 'Required By': '2026-06-03', 'Delivery Time': '12:00-14:00', 'Customer Request': 'Розы' },
    deliveryType: 'Delivery', source: 'Wix',
  });
  expect(sendToChat).toHaveBeenCalledTimes(1);
  const [chatId, text] = sendToChat.mock.calls[0];
  expect(chatId).toBe('555');
  expect(text).toContain('123');
  expect(text).toContain('Новый заказ');
});

it('escapes HTML in user-controlled fields', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  await notifyFloristNewOrder({ order: { 'App Order ID': '1', 'Customer Request': '<b>x</b>' } });
  expect(sendToChat.mock.calls[0][1]).toContain('&lt;b&gt;');
});

it('never throws when sendToChat rejects', async () => {
  getFloristChatId.mockResolvedValue('555');
  getFloristLang.mockResolvedValue('ru');
  sendToChat.mockRejectedValue(new Error('telegram down'));
  await expect(notifyFloristNewOrder({ order: { 'App Order ID': '1' } })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/__tests__/floristNotifyService.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// backend/src/services/floristNotifyService.js
// The seam every Order-creation path calls to notify the shared florist phone
// of a new Order via Telegram. Mirrors driverNotifyService: resolves the
// (singleton) florist chat + group language, skips if unregistered, composes a
// per-language message, and never throws into the caller (creation must succeed
// even if Telegram is down).
import { getFloristChatId, getFloristLang } from '../repos/floristTelegramRepo.js';
import { sendToChat, escapeHtml } from './telegram.js';
import { SUPPORTED_LANGS } from './driverNotifyService.js';

const pickLang = (lang) => (SUPPORTED_LANGS.includes(lang) ? lang : 'ru');

const M = {
  header:   { ru: '🌸 Новый заказ', en: '🌸 New order', pl: '🌸 Nowe zamówienie' },
  order:    { ru: 'Заказ',          en: 'Order',        pl: 'Zamówienie' },
  date:     { ru: 'Дата',           en: 'Date',         pl: 'Data' },
  type:     { ru: 'Тип',            en: 'Type',         pl: 'Typ' },
  request:  { ru: 'Запрос',         en: 'Request',      pl: 'Prośba' },
  source:   { ru: 'Источник',       en: 'Source',       pl: 'Źródło' },
  delivery: { ru: 'Доставка',       en: 'Delivery',     pl: 'Dostawa' },
  pickup:   { ru: 'Самовывоз',      en: 'Pickup',       pl: 'Odbiór' },
};

export async function notifyFloristNewOrder({ order, deliveryType, source } = {}) {
  try {
    if (!order) return;
    const chatId = await getFloristChatId();
    if (!chatId) {
      console.log('[FLORIST_NOTIFY] no florist phone registered — skipped');
      return;
    }
    const lang = pickLang(await getFloristLang());
    const orderNum = order['App Order ID'] || '';
    const date = order['Required By'] || '';
    const time = order['Delivery Time'] || '';
    const req = order['Customer Request'] || '';
    const isDelivery = deliveryType === 'Delivery';
    const typeLabel = isDelivery ? M.delivery[lang] : M.pickup[lang];
    const text = [
      M.header[lang],
      orderNum ? `${M.order[lang]}: ${escapeHtml(orderNum)}` : '',
      (date || time) ? `${M.date[lang]}: ${[escapeHtml(date), escapeHtml(time)].filter(Boolean).join(' ')}` : '',
      deliveryType ? `${M.type[lang]}: ${typeLabel}` : '',
      source ? `${M.source[lang]}: ${escapeHtml(source)}` : '',
      req ? `${M.request[lang]}: ${escapeHtml(req)}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(chatId, text);
  } catch (err) {
    console.error('[FLORIST_NOTIFY] new-order failed:', err.message);
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/__tests__/floristNotifyService.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/floristNotifyService.js backend/src/__tests__/floristNotifyService.test.js
git commit -m "feat(telegram): floristNotifyService — Russian new-order ping seam"
```

---

## Task 5: Wire notifyFloristNewOrder at both creation seams

**Files:**
- Modify: `backend/src/services/orderService.js` (the `notifyNewOrder` side-effect block, ~line 39)
- Modify: `backend/src/services/wix.js` (the `notifyNewOrder` block, ~line 430)
- Test: `backend/src/__tests__/orderService.test.js` (extend) — assert the seam is invoked on create

This is route/service wiring composing an existing service — no new logic; keep TDD light (one behavioral assertion that creation fires the florist seam, mocked).

- [ ] **Step 1: Write the failing test**

Add to `orderService.test.js` (mock `floristNotifyService.js` like other telegram mocks already in that file). Assert that after `createOrder(...)`, `notifyFloristNewOrder` was called once with an object whose `order` has the created `App Order ID`. Match the file's existing mock + harness setup conventions.

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/__tests__/orderService.test.js --no-file-parallelism`
Expected: FAIL (seam not wired / not mocked-called).

- [ ] **Step 3: Implement**

In `orderService.js`, import and call alongside `notifyNewOrder` (same fire-and-forget shape):
```js
import { notifyFloristNewOrder } from './floristNotifyService.js';
// ...in the new-order side-effect block, after notifyNewOrder(...):
notifyFloristNewOrder({ order, deliveryType, source: source || 'In-store' })
  .catch(err => console.error('[FLORIST_NOTIFY] error:', err.message));
```
In `wix.js`, after the `notifyNewOrder({ source: 'Wix', ... })` call:
```js
import { notifyFloristNewOrder } from './floristNotifyService.js';
// ...
notifyFloristNewOrder({ order, deliveryType: 'Delivery', source: 'Wix' })
  .catch(err => console.error('[FLORIST_NOTIFY] Wix error:', err.message));
```
> Verify the `order` variable in each scope carries `App Order ID` / `Required By` / `Delivery Time` / `Customer Request`. If wix's `order` lacks them, pass the fields explicitly from the wix scope instead.

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/__tests__/orderService.test.js --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderService.js backend/src/services/wix.js backend/src/__tests__/orderService.test.js
git commit -m "feat(telegram): fire florist new-order ping at both creation seams"
```

---

## Task 6: PUT /api/settings/florist-language

**Files:**
- Modify: `backend/src/routes/settings.js`
- Test: `backend/src/__tests__/settings.florist-language.integration.test.js`

Mirror the existing `PUT /driver-language` (owner-only via `authorize('admin')`, 400 on bad lang). No `driverName` — group setting.

- [ ] **Step 1: Write the failing test** (copy structure from `settings.driver-language.integration.test.js`: owner 200, bad lang 400, florist PIN 403)

```js
it('owner sets florist language', async () => {
  const r = await request(app).put('/api/settings/florist-language')
    .set('x-auth-pin', OWNER_PIN).send({ lang: 'en' });
  expect(r.status).toBe(200);
  expect(r.body.lang).toBe('en');
});
it('rejects an invalid lang with 400', async () => {
  const r = await request(app).put('/api/settings/florist-language')
    .set('x-auth-pin', OWNER_PIN).send({ lang: 'xx' });
  expect(r.status).toBe(400);
});
it('rejects a non-owner (florist PIN) with 403', async () => {
  const r = await request(app).put('/api/settings/florist-language')
    .set('x-auth-pin', FLORIST_PIN).send({ lang: 'en' });
  expect(r.status).toBe(403);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/__tests__/settings.florist-language.integration.test.js --no-file-parallelism`
Expected: FAIL (404 route missing).

- [ ] **Step 3: Implement** in `settings.js`

```js
import { setFloristLang } from '../repos/floristTelegramRepo.js';
// ── PUT /api/settings/florist-language ──
// Owner sets the Telegram notification language for the shared florist phone.
router.put('/florist-language', authorize('admin'), async (req, res, next) => {
  try {
    const { lang } = req.body;
    if (!SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({ error: `lang must be one of: ${SUPPORTED_LANGS.join(', ')}` });
    }
    await setFloristLang(lang);
    res.json({ lang });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/__tests__/settings.florist-language.integration.test.js --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/settings.js backend/src/__tests__/settings.florist-language.integration.test.js
git commit -m "feat(telegram): owner endpoint to set florist notification language"
```

---

## Task 7: E2E section + docs + summaries

**Files:**
- Modify: `scripts/e2e-test.js` (new section 28, HTTP contracts: `PUT /florist-language` 200/400/403; new-order create still 201)
- Modify: `backend/CLAUDE.md` (new repo/service/route/keys), `CHANGELOG.md`, `CONTEXT.md` (term: "Florist New-Order Notification"), `docs/adr/0009-...md` (append a short "Florist extension" note OR add a one-line cross-ref)
- Write: dev-summary; owner-summary (this has an owner-visible effect — the florist phone now gets pings)

- [ ] **Step 1:** Add e2e section 28 mirroring section 27's florist-language contracts. Run: `npm run harness &` then `npm run test:e2e`. Expected: all sections pass.
- [ ] **Step 2:** Update `backend/CLAUDE.md`: add `floristTelegramRepo.js`, `floristNotifyService.js`, `PUT /settings/florist-language`, the two `system_meta` keys, and the florist `/start` registration. Update `CHANGELOG.md`. Add the CONTEXT.md term.
- [ ] **Step 3:** Append a short "Florist extension" section to ADR-0009 (same alerts bot, singleton system_meta storage, group lang) — or a new ADR if the reviewer judges it a distinct decision.
- [ ] **Step 4:** Write `dev-summary` + `owner-summary` (owner: "your shared florist phone now buzzes on every new order — register once by sending /start 2580 to the alerts bot").
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(telegram): florist new-order notification — e2e section, CLAUDE/CHANGELOG/CONTEXT/ADR, summaries"
```

---

## Self-review checklist (controller, before dispatch)
- [ ] All 7 tasks ≤2 impl files each. ✓
- [ ] Vertical: each task delivers a testable behavior (storage / pin / registration / send / wiring / endpoint / verify+docs). ✓
- [ ] No migration → `driver_telegram_chats` regression lock untouched. ✓
- [ ] Reuses `sendToChat`, `escapeHtml`, `SUPPORTED_LANGS`; no duplication of the bot/poll loop. ✓
- [ ] pglite integration tests run `--no-file-parallelism`. ✓
- [ ] Known Pitfall #5 (no silent catch): every catch logs. ✓
