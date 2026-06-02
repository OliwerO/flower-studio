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
