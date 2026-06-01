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
