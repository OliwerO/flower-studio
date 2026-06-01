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
const REG_ERROR = 'Не удалось зарегистрировать. Попробуйте ещё раз позже.';

export async function handleDriverUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const pin = text.split(/\s+/)[1];
    const driverName = resolveDriverByPin(pin);
    if (driverName) {
      try {
        await setChatId(driverName, chatId);
      } catch (err) {
        console.error('[DRIVER_BOT] register error:', err.message);
        await sendToChat(chatId, REG_ERROR);
        return;
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
    } else {
      console.error('[DRIVER_BOT] getUpdates non-ok:', res.status);
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
