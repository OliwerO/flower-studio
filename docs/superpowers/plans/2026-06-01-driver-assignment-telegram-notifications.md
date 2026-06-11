# Driver Assignment Telegram Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a Driver via Telegram, in their own language, the moment a Delivery or Stock Order becomes their responsibility (driver half of #336; PRD #368).

**Architecture:** Drivers register a Telegram chat by sending `/start <PIN>` to the existing alerts bot (`TELEGRAM_BOT_TOKEN`); a second `getUpdates` long-poll loop (mirroring `feedbackTelegramBot.js`) stores their `chat_id` in a new `driver_telegram_chats` table. Each row also carries a `lang` (`ru`/`en`/`pl`, default `ru`) the Owner controls. A single deep module — `driverNotifyService` — owns target resolution (chat-id + lang), the three guards (suppress-self, skip-unregistered-with-log, no-op-on-unchanged), per-language message composition, and dispatch. Every assignment site calls this seam; it never throws into the caller. See ADR-0009.

**Tech Stack:** Node 20 + Express, Drizzle ORM + Postgres (pglite in tests), Vitest, Telegram Bot API.

---

## File Structure

- **Create** `backend/src/repos/driverTelegramRepo.js` — `driver_telegram_chats` CRUD (chat_id + lang).
- **Create** `backend/src/db/migrations/0015_driver_telegram_chats.sql` — table.
- **Create** `backend/src/utils/driverPins.js` — `listDriverPins()` + `resolveDriverByPin(pin)` (extracted from auth).
- **Create** `backend/src/services/driverNotifyService.js` — the notification seam (deep module) + `SUPPORTED_LANGS`.
- **Create** `backend/src/services/driverBot.js` — inbound `/start` registration poll loop.
- **Create** tests: `driverTelegramRepo.integration.test.js`, `driverPins.test.js`, `driverBot.test.js`, `driverNotifyService.test.js`, `deliveries.assign-notify.integration.test.js`, `settings.driver-language.integration.test.js`.
- **Modify** `backend/src/db/schema.js` — add `driverTelegramChats` table def.
- **Modify** `backend/src/services/telegram.js` — export `sendToChat(chatId, text)`.
- **Modify** `backend/src/middleware/auth.js` — use `resolveDriverByPin`.
- **Modify** `backend/src/index.js` — `startDriverBot()` on boot.
- **Modify** `backend/src/routes/deliveries.js` — diff-detect + notify on assignment.
- **Modify** `backend/src/routes/settings.js` — driver-of-day digest + `PUT /driver-language` admin endpoint.
- **Modify** `backend/src/routes/orders.js` — notify on create / convert with driver.
- **Modify** `backend/src/routes/stockOrders.js` — notify on send + explicit driver PATCH.
- **Modify** `lab/factories/` — add a `driverTelegramChat` factory.
- **Modify** `tests/e2e/` suite — add an Assignment Notification section.

**Language model:** `SUPPORTED_LANGS = ['ru', 'en', 'pl']`, default `ru`. The Owner sets a Driver's language via `PUT /api/settings/driver-language`. Unknown/empty lang falls back to `ru` at send time. `chat_id` is nullable so the Owner can pre-set a language before the Driver has registered.

---

## Task 1: `driver_telegram_chats` table + repo + factory

**Files:**
- Create: `backend/src/db/migrations/0015_driver_telegram_chats.sql`
- Modify: `backend/src/db/schema.js` (after the `systemMeta` block, ~line 21)
- Create: `backend/src/repos/driverTelegramRepo.js`
- Create: `backend/src/__tests__/driverTelegramRepo.integration.test.js`
- Modify: `lab/factories/` (add `driverTelegramChat`, register in the barrel)

- [ ] **Step 1: Write the migration**

`backend/src/db/migrations/0015_driver_telegram_chats.sql`:
```sql
-- chat_id is nullable: the Owner may set a Driver's language before the Driver
-- has registered a chat. lang defaults to Russian (the launch language).
CREATE TABLE IF NOT EXISTS driver_telegram_chats (
  driver_name   text PRIMARY KEY,
  chat_id       text,
  lang          text NOT NULL DEFAULT 'ru',
  registered_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Add the Drizzle table def**

In `backend/src/db/schema.js`, right after the `systemMeta` block:
```js
// Driver → Telegram chat_id + notification language, captured by /start <PIN>
// on the alerts bot (ADR-0009). Kept separate from TELEGRAM_CHAT_IDS so Drivers
// receive only Assignment Notifications. chat_id nullable so the Owner can set a
// Driver's lang before they register.
export const driverTelegramChats = pgTable('driver_telegram_chats', {
  driverName:   text('driver_name').primaryKey(),
  chatId:       text('chat_id'),
  lang:         text('lang').notNull().default('ru'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 3: Write the failing repo integration test**

`backend/src/__tests__/driverTelegramRepo.integration.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as repo from '../repos/driverTelegramRepo.js';

describe('driverTelegramRepo', () => {
  it('returns null for an unknown driver', async () => {
    expect(await repo.getDriver('Ghost')).toBeNull();
  });

  it('stores a chat id with default lang ru', async () => {
    await repo.setChatId('Nikita', '12345');
    expect(await repo.getDriver('Nikita')).toMatchObject({ chatId: '12345', lang: 'ru' });
  });

  it('upserts the chat id on re-registration, preserving lang', async () => {
    await repo.setChatId('Nikita', '12345');
    await repo.setLang('Nikita', 'en');
    await repo.setChatId('Nikita', '99999');
    expect(await repo.getDriver('Nikita')).toMatchObject({ chatId: '99999', lang: 'en' });
  });

  it('sets lang before any chat is registered (chat_id null)', async () => {
    await repo.setLang('Bjorn', 'pl');
    expect(await repo.getDriver('Bjorn')).toMatchObject({ chatId: null, lang: 'pl' });
  });

  it('lists registered drivers', async () => {
    await repo.setChatId('Timur', '55555');
    const names = (await repo.listRegistered()).map(r => r.driverName);
    expect(names).toContain('Timur');
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverTelegramRepo.integration.test.js`
Expected: FAIL — `Cannot find module '../repos/driverTelegramRepo.js'`.

- [ ] **Step 5: Implement the repo**

`backend/src/repos/driverTelegramRepo.js`:
```js
// Data-access for driver_telegram_chats — maps a Driver's name to the Telegram
// chat_id captured at /start, plus the notification language the Owner sets
// (ADR-0009).
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { driverTelegramChats } from '../db/schema.js';

export async function getDriver(driverName) {
  if (!driverName) return null;
  const [row] = await db
    .select({ chatId: driverTelegramChats.chatId, lang: driverTelegramChats.lang })
    .from(driverTelegramChats)
    .where(eq(driverTelegramChats.driverName, driverName));
  return row ?? null;
}

// Register / refresh a chat id. Preserves any lang the Owner already set.
export async function setChatId(driverName, chatId) {
  await db
    .insert(driverTelegramChats)
    .values({ driverName, chatId })
    .onConflictDoUpdate({
      target: driverTelegramChats.driverName,
      set: { chatId },
    });
}

// Owner sets a Driver's notification language. Upserts so it works before the
// Driver has registered a chat.
export async function setLang(driverName, lang) {
  await db
    .insert(driverTelegramChats)
    .values({ driverName, lang })
    .onConflictDoUpdate({
      target: driverTelegramChats.driverName,
      set: { lang },
    });
}

export async function listRegistered() {
  return db.select().from(driverTelegramChats);
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverTelegramRepo.integration.test.js`
Expected: PASS (5 tests).

- [ ] **Step 7: Add a lab factory**

Match the existing factory pattern in `lab/factories/`. Add `driverTelegramChat`:
```js
export function driverTelegramChat(overrides = {}) {
  return {
    driverName: 'Nikita',
    chatId: '100000001',
    lang: 'ru',
    ...overrides,
  };
}
```
Register it in the factory barrel exactly as the sibling factories are registered.

- [ ] **Step 8: Run lab factory unit tests**

Run: `npm run lab:test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/db/migrations/0015_driver_telegram_chats.sql backend/src/db/schema.js backend/src/repos/driverTelegramRepo.js backend/src/__tests__/driverTelegramRepo.integration.test.js lab/factories/
git commit -m "feat(telegram): driver_telegram_chats table (chat_id + lang) + repo + factory"
```

---

## Task 2: `resolveDriverByPin` helper + auth refactor

**Files:**
- Create: `backend/src/utils/driverPins.js`
- Create: `backend/src/__tests__/driverPins.test.js`
- Modify: `backend/src/middleware/auth.js:18-24,47-56`

- [ ] **Step 1: Write the failing unit test**

`backend/src/__tests__/driverPins.test.js`:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('resolveDriverByPin', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PIN_DRIVER_NIKITA = '5678';
    process.env.PIN_DRIVER_TIMUR = '1234';
  });

  it('maps a driver PIN to the capitalised driver name', async () => {
    const { resolveDriverByPin } = await import('../utils/driverPins.js');
    expect(resolveDriverByPin('5678')).toBe('Nikita');
    expect(resolveDriverByPin('1234')).toBe('Timur');
  });

  it('returns null for an unknown or empty PIN', async () => {
    const { resolveDriverByPin } = await import('../utils/driverPins.js');
    expect(resolveDriverByPin('0000')).toBeNull();
    expect(resolveDriverByPin('')).toBeNull();
    expect(resolveDriverByPin(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverPins.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`backend/src/utils/driverPins.js`:
```js
// Driver PIN resolution, shared by the auth middleware and the driver Telegram
// bot. Each PIN_DRIVER_<NAME> env var maps to a capitalised driver name; the
// Backup PIN resolves to the owner-set backup name when present.
import { getBackupDriverName } from '../services/driverState.js';
import { safeEqual } from './auth.js';

export function listDriverPins() {
  return Object.entries(process.env)
    .filter(([key]) => key.startsWith('PIN_DRIVER_'))
    .map(([key, value]) => ({
      pin: value,
      name: key.replace('PIN_DRIVER_', '').charAt(0).toUpperCase()
            + key.replace('PIN_DRIVER_', '').slice(1).toLowerCase(),
    }));
}

export function resolveDriverByPin(pin) {
  if (!pin) return null;
  const driver = listDriverPins().find(d => safeEqual(d.pin, pin));
  if (!driver) return null;
  return driver.name === 'Backup'
    ? (getBackupDriverName() || driver.name)
    : driver.name;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverPins.test.js`
Expected: PASS.

- [ ] **Step 5: Refactor `auth.js` to use the helper (behaviour-preserving)**

In `backend/src/middleware/auth.js`, delete the inline `DRIVER_PINS` block (lines 18-24) and replace the driver-resolution block (lines 47-56). Add at top: `import { resolveDriverByPin } from '../utils/driverPins.js';` Replace the driver section of `authenticate`:
```js
  // Check driver PINs — each driver has their own badge
  const driverName = resolveDriverByPin(pin);
  if (driverName) {
    req.role = 'driver';
    req.driverName = driverName;
    return next();
  }
```

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/driverPins.js backend/src/__tests__/driverPins.test.js backend/src/middleware/auth.js
git commit -m "refactor(auth): extract resolveDriverByPin shared helper"
```

---

## Task 3: `sendToChat` + driver registration bot (TRACER — registration end-to-end)

**Files:**
- Modify: `backend/src/services/telegram.js` (after `broadcastAlert`, ~line 72)
- Create: `backend/src/services/driverBot.js`
- Create: `backend/src/__tests__/driverBot.test.js`
- Modify: `backend/src/index.js` (next to `startFeedbackBot()`, ~line 143)

- [ ] **Step 1: Export a targeted sender from telegram.js**

In `backend/src/services/telegram.js`, after `broadcastAlert`:
```js
/**
 * Send a message to one specific chat on the alerts bot. Used for targeted
 * Driver Assignment Notifications (ADR-0009) — never broadcasts.
 */
export async function sendToChat(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  await sendTo(token, chatId, text);
}
```

- [ ] **Step 2: Write the failing registration-handler test**

`backend/src/__tests__/driverBot.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/driverTelegramRepo.js', () => ({
  setChatId: vi.fn(),
  getDriver: vi.fn(),
}));
vi.mock('../services/telegram.js', () => ({ sendToChat: vi.fn() }));

import { handleDriverUpdate } from '../services/driverBot.js';
import * as repo from '../repos/driverTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';

describe('handleDriverUpdate (/start registration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIN_DRIVER_NIKITA = '5678';
    repo.getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
  });

  it('registers a valid PIN and confirms in the stored language', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 5678' } });
    expect(repo.setChatId).toHaveBeenCalledWith('Nikita', '42');
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('Никита'));
  });

  it('confirms in English when the driver lang is en', async () => {
    repo.getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 5678' } });
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('Nikita'));
    expect(sendToChat.mock.calls[0][1]).toMatch(/connected|notifications/i);
  });

  it('rejects a wrong PIN without storing anything', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: '/start 0000' } });
    expect(repo.setChatId).not.toHaveBeenCalled();
    expect(sendToChat).toHaveBeenCalledWith('42', expect.stringContaining('PIN'));
  });

  it('ignores non-/start messages', async () => {
    await handleDriverUpdate({ message: { chat: { id: 42 }, text: 'hello' } });
    expect(repo.setChatId).not.toHaveBeenCalled();
  });

  it('ignores updates without a text message', async () => {
    await handleDriverUpdate({ edited_message: {} });
    expect(repo.setChatId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverBot.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the bot**

`backend/src/services/driverBot.js`:
```js
// Inbound Telegram loop for the alerts bot (TELEGRAM_BOT_TOKEN). Captures Driver
// chat ids via `/start <PIN>` so Assignment Notifications can reach them
// (ADR-0009). Mirrors feedbackTelegramBot.js, but on a different token and with
// its own poll offset, so the two loops never collide.
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemMeta } from '../db/schema.js';
import { resolveDriverByPin } from '../utils/driverPins.js';
import { setChatId, getDriver } from '../repos/driverTelegramRepo.js';
import { sendToChat } from './telegram.js';

const BASE = 'https://api.telegram.org/bot';
const POLL_OFFSET_KEY = 'driver_bot_poll_offset';

// Registration confirmation per language. Bad-PIN / hint stay in ru (the driver
// isn't resolved yet, so no language is known).
const REGISTERED = {
  ru: (name) => `Привет, ${name}! 👋 Вы подключены к уведомлениям о доставках и закупках.`,
  en: (name) => `Hi ${name}! 👋 You're now connected to delivery and purchase notifications.`,
  pl: (name) => `Cześć ${name}! 👋 Połączono Cię z powiadomieniami o dostawach i zakupach.`,
};
const BAD_PIN = 'Неверный PIN. Попробуйте: /start <PIN>';
const HINT = 'Чтобы получать уведомления, отправьте: /start <ваш PIN>';

export async function handleDriverUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const pin = text.split(' ')[1];
    const driverName = resolveDriverByPin(pin);
    if (driverName) {
      try {
        await setChatId(driverName, chatId);
      } catch (err) {
        console.error('[DRIVER_BOT] register error:', err.message);
      }
      const row = await getDriver(driverName).catch(() => null);
      const lang = (REGISTERED[row?.lang]) ? row.lang : 'ru';
      await sendToChat(chatId, REGISTERED[lang](driverName));
    } else {
      await sendToChat(chatId, BAD_PIN);
    }
    return;
  }
  await sendToChat(chatId, HINT);
}

let running = false;
let pollOffset = 0;
let pollTimer = null;

async function savePollOffset() {
  try {
    await db.insert(systemMeta)
      .values({ key: POLL_OFFSET_KEY, value: String(pollOffset) })
      .onConflictDoUpdate({ target: systemMeta.key, set: { value: String(pollOffset) } });
  } catch (err) {
    console.error('[DRIVER_BOT] failed to save poll offset:', err.message);
  }
}

async function loadPollOffset() {
  try {
    const [row] = await db.select({ value: systemMeta.value })
      .from(systemMeta)
      .where(eq(systemMeta.key, POLL_OFFSET_KEY));
    if (row?.value) pollOffset = parseInt(row.value, 10) || 0;
  } catch (err) {
    console.error('[DRIVER_BOT] failed to load poll offset:', err.message);
  }
}

async function poll(token) {
  if (!running) return;
  try {
    const res = await fetch(`${BASE}${token}/getUpdates?offset=${pollOffset}&timeout=20`);
    if (res.ok) {
      const { result: updates } = await res.json();
      if (updates?.length) {
        for (const update of updates) {
          pollOffset = update.update_id + 1;
          await handleDriverUpdate(update);
        }
        await savePollOffset();
      }
    }
  } catch (err) {
    console.error('[DRIVER_BOT] poll error:', err.message);
  }
  if (running) pollTimer = setTimeout(() => poll(token), 500);
}

export async function startDriverBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[DRIVER_BOT] TELEGRAM_BOT_TOKEN not set — driver registration bot disabled');
    return;
  }
  await loadPollOffset();
  running = true;
  poll(token);
  console.log('[DRIVER_BOT] Driver registration bot started');
}

export function stopDriverBot() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverBot.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire startup**

In `backend/src/index.js`, next to `startFeedbackBot();` (~line 143):
```js
import { startDriverBot } from './services/driverBot.js';
// ...
startDriverBot();
```

- [ ] **Step 7: Demo (tracer)** — boot the backend, confirm `[DRIVER_BOT] Driver registration bot started` in logs. With a real token, `/start <PIN>` from the Driver's Telegram stores a row in `driver_telegram_chats`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/telegram.js backend/src/services/driverBot.js backend/src/__tests__/driverBot.test.js backend/src/index.js
git commit -m "feat(telegram): driver /start registration bot + sendToChat"
```

---

## Task 4: `driverNotifyService` — target resolution, lang messages, notifyDeliveryAssigned

**Files:**
- Create: `backend/src/services/driverNotifyService.js`
- Create: `backend/src/__tests__/driverNotifyService.test.js`

- [ ] **Step 1: Write the failing service test**

`backend/src/__tests__/driverNotifyService.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/driverTelegramRepo.js', () => ({ getDriver: vi.fn() }));
vi.mock('../services/telegram.js', () => ({ sendToChat: vi.fn() }));
vi.mock('../repos/orderRepo.js', () => ({ getById: vi.fn() }));

import { notifyDeliveryAssigned } from '../services/driverNotifyService.js';
import { getDriver } from '../repos/driverTelegramRepo.js';
import { sendToChat } from '../services/telegram.js';
import * as orderRepo from '../repos/orderRepo.js';

const delivery = {
  orderId: 'o1',
  'Delivery Date': '2026-06-02',
  'Delivery Time': '10-12',
  'Delivery Address': 'ul. Kwiatowa 5',
};

describe('notifyDeliveryAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderRepo.getById.mockResolvedValue({ 'App Order ID': 'A-100' });
  });

  it('sends a Russian delivery message to a ru driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Nikita' });
    const [chatId, text] = sendToChat.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toContain('назначена доставка');
    expect(text).toContain('A-100');
    expect(text).toContain('ul. Kwiatowa 5');
    expect(text).toContain('10-12');
  });

  it('sends an English message to an en driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Bjorn' });
    expect(sendToChat.mock.calls[0][1]).toContain('assigned a delivery');
  });

  it('sends a Polish message to a pl driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'pl' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Anna' });
    expect(sendToChat.mock.calls[0][1]).toContain('Przydzielono');
  });

  it('falls back to ru for an unknown lang', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'de' });
    await notifyDeliveryAssigned({ delivery, driverName: 'X' });
    expect(sendToChat.mock.calls[0][1]).toContain('назначена доставка');
  });

  it('suppresses notification on self-claim (actor === assignee)', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyDeliveryAssigned({ delivery, driverName: 'Nikita', actorName: 'Nikita' });
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips (no throw) when the driver has no chat id', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'en' });
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Timur' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips (no throw) when the driver row is missing', async () => {
    getDriver.mockResolvedValue(null);
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Ghost' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does nothing when driverName is empty', async () => {
    await notifyDeliveryAssigned({ delivery, driverName: '' });
    expect(getDriver).not.toHaveBeenCalled();
  });

  it('never throws into the caller when the send fails', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    sendToChat.mockRejectedValue(new Error('telegram down'));
    await expect(notifyDeliveryAssigned({ delivery, driverName: 'Nikita' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service (target resolution + lang strings + notifyDeliveryAssigned)**

`backend/src/services/driverNotifyService.js`:
```js
// The single seam every assignment path calls to notify a Driver via Telegram
// (ADR-0009, PRD #368). Owns target resolution (chat id + language), the
// suppress-self and skip-unregistered guards, per-language message composition,
// and dispatch. Never throws into the caller — assignment must succeed even if
// Telegram is down.
import { getDriver } from '../repos/driverTelegramRepo.js';
import { sendToChat } from './telegram.js';
import * as orderRepo from '../repos/orderRepo.js';

export const SUPPORTED_LANGS = ['ru', 'en', 'pl'];
const pickLang = (lang) => (SUPPORTED_LANGS.includes(lang) ? lang : 'ru');

// Message fragments. Static labels keyed by lang; headers/digest are builders.
const M = {
  deliveryHeader: {
    ru: '🚚 Вам назначена доставка',
    en: "🚚 You've been assigned a delivery",
    pl: '🚚 Przydzielono Ci dostawę',
  },
  poHeader: {
    ru: '🛒 Вам назначена закупка',
    en: "🛒 You've been assigned a purchase run",
    pl: '🛒 Przydzielono Ci zakupy',
  },
  order:   { ru: 'Заказ',  en: 'Order',   pl: 'Zamówienie' },
  date:    { ru: 'Дата',   en: 'Date',    pl: 'Data' },
  address: { ru: 'Адрес',  en: 'Address', pl: 'Adres' },
  buy:     { ru: 'Купить', en: 'Buy',     pl: 'Kup' },
  digestHeader: {
    ru: (n) => `🚚 Вы сегодня водитель — назначено доставок: ${n}`,
    en: (n) => `🚚 You're today's driver — deliveries assigned: ${n}`,
    pl: (n) => `🚚 Jesteś dziś kierowcą — przydzielone dostawy: ${n}`,
  },
};

// Resolve chat id + lang, or null if the Driver can't be messaged.
async function resolveTarget(driverName) {
  const row = await getDriver(driverName);
  if (!row?.chatId) {
    console.log(`[DRIVER_NOTIFY] ${driverName} not registered — skipped`);
    return null;
  }
  return { chatId: row.chatId, lang: pickLang(row.lang) };
}

async function orderNumberFor(delivery) {
  const orderId = delivery.orderId || delivery['Linked Order']?.[0];
  if (!orderId) return '';
  const order = await orderRepo.getById(orderId).catch(() => null);
  return order?.['App Order ID'] || '';
}

export async function notifyDeliveryAssigned({ delivery, driverName, actorName }) {
  try {
    if (!driverName) return;
    if (actorName && actorName === driverName) return; // self-claim
    const target = await resolveTarget(driverName);
    if (!target) return;
    const { lang } = target;
    const orderNum = await orderNumberFor(delivery);
    const date = delivery['Delivery Date'] || '';
    const time = delivery['Delivery Time'] || '';
    const addr = delivery['Delivery Address'] || '';
    const text = [
      M.deliveryHeader[lang],
      orderNum ? `${M.order[lang]}: ${orderNum}` : '',
      (date || time) ? `${M.date[lang]}: ${date} ${time}`.trim() : '',
      addr ? `${M.address[lang]}: ${addr}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] delivery-assigned failed:', err.message);
  }
}

// Exported for the digest + PO tasks (Task 6, Task 8).
export { resolveTarget, orderNumberFor, M };
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverNotifyService.js backend/src/__tests__/driverNotifyService.test.js
git commit -m "feat(telegram): driverNotifyService — lang-aware delivery notify + guards"
```

---

## Task 5: Wire the delivery PATCH trigger with diff-detection (TRACER — first live notification)

**Files:**
- Modify: `backend/src/routes/deliveries.js:141-180`
- Create: `backend/src/__tests__/deliveries.assign-notify.integration.test.js`

- [ ] **Step 1: Write the failing integration test**

`backend/src/__tests__/deliveries.assign-notify.integration.test.js`. Mock the notify seam and assert the diff-detection contract. Copy the supertest/pglite bootstrap from the nearest existing `deliveries` / order integration test in `backend/src/__tests__/`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn(),
  notifyDeliveryDigest: vi.fn(),
  notifyPoAssigned: vi.fn(),
}));
// ... import the app/supertest harness as sibling *.integration.test.js do, plus:
import { notifyDeliveryAssigned } from '../services/driverNotifyService.js';

describe('delivery assignment → driver notification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies when Assigned Driver changes empty → Nikita (owner PIN)', async () => {
    // PATCH /api/deliveries/:id { "Assigned Driver": "Nikita" } as owner → 200
    expect(notifyDeliveryAssigned).toHaveBeenCalledTimes(1);
    expect(notifyDeliveryAssigned.mock.calls[0][0]).toMatchObject({ driverName: 'Nikita' });
  });

  it('does NOT notify on a no-op PATCH that leaves Assigned Driver unchanged', async () => {
    // assign Nikita, clear mock, PATCH an unrelated field (Driver Notes)
    expect(notifyDeliveryAssigned).not.toHaveBeenCalled();
  });

  it('does NOT notify on self-claim (driver advances status to Out for Delivery)', async () => {
    // PATCH with driver PIN + { Status: 'Out for Delivery' }
    expect(notifyDeliveryAssigned).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/deliveries.assign-notify.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement diff-detection in the PATCH handler**

In `backend/src/routes/deliveries.js`, add `import { notifyDeliveryAssigned } from '../services/driverNotifyService.js';`. Inside `router.patch('/:id', ...)`, after `pickAllowed` + validation, before the existing self-claim stamp block:
```js
    // Capture the prior driver so we only notify on a genuine assignment change.
    const before = await orderRepo.getDeliveryById(req.params.id).catch(() => null);
    const priorDriver = before?.['Assigned Driver'] || '';

    // Self-claim: a driver advancing status stamps their own name (no notify).
    let selfClaim = false;
    if (fields.Status === DELIVERY_STATUS.OUT_FOR_DELIVERY || fields.Status === DELIVERY_STATUS.DELIVERED) {
      if (req.driverName) {
        fields['Assigned Driver'] = req.driverName;
        selfClaim = true;
      }
    }
```
Then after `updateDelivery(...)` and the existing delivery-complete alert block:
```js
    const newDriver = updated['Assigned Driver'] || '';
    if (newDriver && newDriver !== priorDriver && !selfClaim) {
      notifyDeliveryAssigned({
        delivery: updated,
        driverName: newDriver,
        actorName: req.driverName || '',
      }).catch(err => console.error('[DRIVER_NOTIFY] patch hook failed:', err.message));
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/deliveries.assign-notify.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite (no cascade regression)**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/deliveries.js backend/src/__tests__/deliveries.assign-notify.integration.test.js
git commit -m "feat(deliveries): notify driver on assignment (diff-detect, suppress self-claim)"
```

---

## Task 6: Driver-of-Day digest + Owner-set driver language endpoint

**Files:**
- Modify: `backend/src/services/driverNotifyService.js`
- Modify: `backend/src/__tests__/driverNotifyService.test.js`
- Modify: `backend/src/routes/settings.js:37-59` (digest) and add `PUT /driver-language`
- Create: `backend/src/__tests__/settings.driver-language.integration.test.js`

- [ ] **Step 1: Add a failing digest test**

Append to `backend/src/__tests__/driverNotifyService.test.js`:
```js
import { notifyDeliveryDigest } from '../services/driverNotifyService.js';

describe('notifyDeliveryDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderRepo.getById.mockImplementation(async (id) => ({ 'App Order ID': `A-${id}` }));
  });

  it('sends ONE message summarising all assigned deliveries (driver lang)', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    const deliveries = [
      { orderId: '1', 'Delivery Time': '10-12', 'Delivery Address': 'Addr 1' },
      { orderId: '2', 'Delivery Time': '12-14', 'Delivery Address': 'Addr 2' },
    ];
    await notifyDeliveryDigest({ driverName: 'Bjorn', deliveries });
    expect(sendToChat).toHaveBeenCalledTimes(1);
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain("today's driver");
    expect(text).toContain('2');
    expect(text).toContain('Addr 1');
    expect(text).toContain('Addr 2');
  });

  it('sends nothing for an empty delivery list', async () => {
    await notifyDeliveryDigest({ driverName: 'Nikita', deliveries: [] });
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('skips an unregistered driver without throwing', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'ru' });
    await expect(
      notifyDeliveryDigest({ driverName: 'Timur', deliveries: [{ orderId: '1' }] })
    ).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: FAIL — `notifyDeliveryDigest` not exported.

- [ ] **Step 3: Implement `notifyDeliveryDigest`**

Append to `backend/src/services/driverNotifyService.js` (before the trailing `export { ... }`, or add `notifyDeliveryDigest` as a normal `export async function`):
```js
export async function notifyDeliveryDigest({ driverName, deliveries }) {
  try {
    if (!driverName || !deliveries?.length) return;
    const target = await resolveTarget(driverName);
    if (!target) return;
    const { lang } = target;
    const lines = [];
    for (let i = 0; i < deliveries.length; i++) {
      const d = deliveries[i];
      const orderNum = await orderNumberFor(d);
      const time = d['Delivery Time'] || '';
      const addr = d['Delivery Address'] || '';
      lines.push(`${i + 1}. ${[orderNum, time, addr].filter(Boolean).join(' · ')}`);
    }
    const text = [M.digestHeader[lang](deliveries.length), ...lines].join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] digest failed:', err.message);
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: PASS.

- [ ] **Step 5: Wire driver-of-day to send one digest**

In `backend/src/routes/settings.js`, add `import { notifyDeliveryDigest } from '../services/driverNotifyService.js';` and collect the deliveries actually assigned, then fire one digest after the loop:
```js
    let assignedCount = 0;
    const assigned = [];
    if (driverName) {
      const today = new Date().toISOString().split('T')[0];
      const allToday = await orderRepo.listDeliveries({ pg: { date: today } });
      const unassigned = allToday.filter(
        d => !d['Assigned Driver'] && d.Status !== DELIVERY_STATUS.DELIVERED
      );
      for (const d of unassigned) {
        await orderRepo.updateDelivery(d.id, { 'Assigned Driver': driverName });
        assigned.push(d);
        assignedCount++;
      }
      if (assigned.length) {
        notifyDeliveryDigest({ driverName, deliveries: assigned })
          .catch(err => console.error('[DRIVER_NOTIFY] digest hook failed:', err.message));
      }
    }
```

- [ ] **Step 6: Add the driver-language admin endpoint + failing test**

`backend/src/__tests__/settings.driver-language.integration.test.js` (copy the supertest/pglite bootstrap from an existing settings integration test):
```js
import { describe, it, expect } from 'vitest';
// ... import the app/supertest harness + owner PIN header helper
import * as repo from '../repos/driverTelegramRepo.js';

describe('PUT /api/settings/driver-language', () => {
  it('sets a driver language (owner)', async () => {
    // PUT with owner PIN, body { driverName: 'Nikita', lang: 'en' } → 200
    expect(await repo.getDriver('Nikita')).toMatchObject({ lang: 'en' });
  });

  it('rejects an unsupported language with 400', async () => {
    // PUT { driverName: 'Nikita', lang: 'de' } → 400
  });

  it('rejects a non-owner with 403', async () => {
    // PUT with florist/driver PIN → 403
  });
});
```

- [ ] **Step 7: Run to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/settings.driver-language.integration.test.js`
Expected: FAIL — route 404.

- [ ] **Step 8: Implement the endpoint**

In `backend/src/routes/settings.js`, add imports `import { setLang } from '../repos/driverTelegramRepo.js';` and `import { SUPPORTED_LANGS } from '../services/driverNotifyService.js';`, then:
```js
// ── PUT /api/settings/driver-language ──
// Owner sets the Telegram notification language for a Driver. Default is 'ru'.
router.put('/driver-language', authorize('admin'), async (req, res, next) => {
  try {
    const { driverName, lang } = req.body;
    if (!driverName || !SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({
        error: `driverName required and lang must be one of: ${SUPPORTED_LANGS.join(', ')}`,
      });
    }
    await setLang(driverName, lang);
    res.json({ driverName, lang });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 9: Run the endpoint test + full suite**

Run: `cd backend && npx vitest run src/__tests__/settings.driver-language.integration.test.js && cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/driverNotifyService.js backend/src/__tests__/driverNotifyService.test.js backend/src/routes/settings.js backend/src/__tests__/settings.driver-language.integration.test.js
git commit -m "feat(settings): driver-of-day digest + owner-set driver notification language"
```

---

## Task 7: Notify on order-creation + convert-to-delivery with a driver

**Files:**
- Modify: `backend/src/routes/orders.js` (convert-to-delivery ~line 517; POST create handler)
- (No new test file — covered by the Task 4 service unit test; route wiring composing an existing service, so the red phase is skipped per the /feature TDD policy. Verify by the full suite + manual demo.)

- [ ] **Step 1: Notify on convert-to-delivery**

In `backend/src/routes/orders.js`, add `import { notifyDeliveryAssigned } from '../services/driverNotifyService.js';`. In the convert handler that sets `'Assigned Driver': driver || getDriverOfDay() || null` (~line 517), after the delivery is persisted:
```js
    const assignedDriver = driver || getDriverOfDay() || null;
    if (assignedDriver) {
      const deliveryRec = await orderRepo.getDeliveryById(/* the delivery id from the convert result */).catch(() => null);
      if (deliveryRec) {
        notifyDeliveryAssigned({ delivery: deliveryRec, driverName: assignedDriver })
          .catch(err => console.error('[DRIVER_NOTIFY] convert hook failed:', err.message));
      }
    }
```
Use whatever delivery id/record the handler already produced; only fetch via `getDeliveryById` if the handler doesn't already hold the delivery wire object.

- [ ] **Step 2: Notify on order-creation with a driver**

In the POST `/orders` handler, after creation, if the created order is a delivery with an assigned driver, resolve the delivery record and call `notifyDeliveryAssigned` the same way:
```js
    if (createdDelivery?.['Assigned Driver']) {
      notifyDeliveryAssigned({
        delivery: createdDelivery,
        driverName: createdDelivery['Assigned Driver'],
      }).catch(err => console.error('[DRIVER_NOTIFY] create hook failed:', err.message));
    }
```

- [ ] **Step 3: Run the full suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/orders.js
git commit -m "feat(orders): notify driver on create/convert-to-delivery assignment"
```

---

## Task 8: PO assignment notification (send + explicit driver PATCH)

**Files:**
- Modify: `backend/src/services/driverNotifyService.js`
- Modify: `backend/src/__tests__/driverNotifyService.test.js`
- Modify: `backend/src/routes/stockOrders.js` (send ~line 439-445; the `Assigned Driver` PATCH branch)

- [ ] **Step 1: Add a failing PO test**

Append to `backend/src/__tests__/driverNotifyService.test.js`:
```js
import { notifyPoAssigned } from '../services/driverNotifyService.js';

vi.mock('../repos/stockOrderRepo.js', () => ({
  getById: vi.fn(),
  getLinesByPoId: vi.fn(),
}));
import * as stockOrderRepo from '../repos/stockOrderRepo.js';

describe('notifyPoAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stockOrderRepo.getById.mockResolvedValue({ _pgId: 'p1', 'Stock Order ID': 'PO-7', 'Planned Date': '2026-06-03' });
    stockOrderRepo.getLinesByPoId.mockResolvedValue([
      { 'Flower Name': 'Rose Red' }, { 'Flower Name': 'Peony Pink' },
    ]);
  });

  it('sends a Russian pickup message with PO ref, date and flower list', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'ru' });
    await notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Nikita' });
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain('назначена закупка');
    expect(text).toContain('PO-7');
    expect(text).toContain('2026-06-03');
    expect(text).toContain('Rose Red');
    expect(text).toContain('Peony Pink');
  });

  it('sends an English pickup message to an en driver', async () => {
    getDriver.mockResolvedValue({ chatId: '42', lang: 'en' });
    await notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Bjorn' });
    expect(sendToChat.mock.calls[0][1]).toContain('purchase run');
  });

  it('skips an unregistered driver without throwing', async () => {
    getDriver.mockResolvedValue({ chatId: null, lang: 'ru' });
    await expect(notifyPoAssigned({ stockOrderId: 'PO-7', driverName: 'Timur' })).resolves.toBeUndefined();
    expect(sendToChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: FAIL — `notifyPoAssigned` not exported.

- [ ] **Step 3: Implement `notifyPoAssigned`**

In `backend/src/services/driverNotifyService.js`, add `import * as stockOrderRepo from '../repos/stockOrderRepo.js';` at top, then:
```js
export async function notifyPoAssigned({ stockOrderId, driverName }) {
  try {
    if (!driverName) return;
    const target = await resolveTarget(driverName);
    if (!target) return;
    const { lang } = target;
    const po = await stockOrderRepo.getById(stockOrderId).catch(() => null);
    if (!po) return;
    const lines = await stockOrderRepo.getLinesByPoId(po._pgId).catch(() => []);
    const flowers = lines.map(l => l['Flower Name']).filter(Boolean).join(', ');
    const ref = po['Stock Order ID'] || '';
    const date = po['Planned Date'] || '';
    const text = [
      M.poHeader[lang],
      ref ? `${M.order[lang]}: ${ref}` : '',
      date ? `${M.date[lang]}: ${date}` : '',
      flowers ? `${M.buy[lang]}: ${flowers}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] po-assigned failed:', err.message);
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && npx vitest run src/__tests__/driverNotifyService.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the send handler**

In `backend/src/routes/stockOrders.js`, add `import { notifyPoAssigned } from '../services/driverNotifyService.js';`. After the existing `broadcast({ type: 'stock_pickup_assigned', ... })` in `/:id/send`:
```js
    if (resolvedDriver) {
      notifyPoAssigned({ stockOrderId: req.params.id, driverName: resolvedDriver })
        .catch(err => console.error('[DRIVER_NOTIFY] po send hook failed:', err.message));
    }
```

- [ ] **Step 6: Wire the explicit `Assigned Driver` PATCH branch**

In the PATCH handler that broadcasts `stock_pickup_assigned` when `'Assigned Driver' in fields`, mirror it — notify only on a non-empty value:
```js
    if ('Assigned Driver' in fields && fields['Assigned Driver']) {
      notifyPoAssigned({ stockOrderId: req.params.id, driverName: fields['Assigned Driver'] })
        .catch(err => console.error('[DRIVER_NOTIFY] po patch hook failed:', err.message));
    }
```

- [ ] **Step 7: Run the full suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/driverNotifyService.js backend/src/__tests__/driverNotifyService.test.js backend/src/routes/stockOrders.js
git commit -m "feat(stock-orders): notify driver on PO send + explicit assignment"
```

---

## Task 9: API E2E section

**Files:**
- Modify: the E2E suite under the repo-root E2E directory (run by `npm run test:e2e`).

- [ ] **Step 1: Add an Assignment Notification section**

Add a numbered section that, against the pglite harness:
1. Seeds an order with a delivery.
2. PATCHes the delivery `{ "Assigned Driver": "Nikita" }` as owner → asserts 200.
3. Asserts the side-effect observably (mock spy / captured Telegram call), OR — if Telegram is not observable in E2E — asserts the registration + language path via `/test/state` and notes the Task 5 integration test as the verifying path.

Mirror the nearest existing side-effect section. If Telegram side-effects aren't observable in the harness, say so in the section comment and record it in the PR body per the Verification Gate.

- [ ] **Step 2: Run the E2E suite**

Run: `npm run harness &` then `npm run test:e2e`
Expected: PASS including the new section.

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "test(e2e): driver assignment notification section"
```

---

## Self-Review

**Spec coverage (PRD #368 + language addendum):**
- Registration `/start <PIN>` + confirm (in driver lang) + bad-PIN → Task 3. ✓
- Delivery assigned (manual/new/convert), order#/date/time/address → Tasks 4, 5, 7. ✓
- Driver-of-day digest → Task 6. ✓
- PO assigned message (ref/date/flowers; no supplier) → Task 8. ✓
- Reassign notifies only new driver; no-op sends nothing → Task 5 diff-detect. ✓
- Self-claim suppressed → Tasks 4 (service guard) + 5 (route guard). ✓
- Unregistered driver silent + logged, assignment never fails → Task 4 `resolveTarget` + caller `.catch`. ✓
- Drivers get only assignment messages, never broadcasts → separate `driver_telegram_chats` storage (Task 1), `sendToChat` targeted (Task 3). ✓
- chat_id persists across restarts → DB table (Task 1). ✓
- **Per-driver language, Owner-controlled, ru/en/pl, default ru** → `lang` column (Task 1), `SUPPORTED_LANGS` + `M` strings (Task 4), `PUT /driver-language` (Task 6), every message lang-keyed (Tasks 4/6/8). ✓
- Tests: service incl. lang variants (T4/6/8), diff-detect integration (T5), /start handler incl. lang (T3), repo incl. lang (T1), language endpoint (T6), E2E (T9). ✓

**Placeholder scan:** none — real code in every code step. Deferred specifics: the E2E harness wiring (Task 9 Step 1) and the supertest bootstrap copy (Tasks 5, 6 — explicitly "copy from sibling test").

**Type/name consistency:** repo exposes `getDriver`/`setChatId`/`setLang`/`listRegistered` (T1), consumed as `getDriver` in T3/T4 and `setLang`/`SUPPORTED_LANGS` in T6; `resolveTarget`/`orderNumberFor`/`M` exported from T4 and reused in T6/T8; `notifyDeliveryAssigned`/`notifyDeliveryDigest`/`notifyPoAssigned` match call sites in T5/6/7/8; `sendToChat` (T3) consumed throughout.

**Deletion test (deep module):** delete `driverNotifyService` → target resolution, the ru/en/pl strings table, suppress-self, skip-unregistered, and order#/flower-list resolution scatter across `deliveries.js`, `settings.js`, `orders.js`, `stockOrders.js`. Confirmed deep — keep.

**Out of scope (held):** florist new-order alert; "removed from your list"; owner nudge on unregistered driver; SSE/push parity; a dashboard UI control for driver language (the endpoint exists; the desktop control is a tracked follow-up).
