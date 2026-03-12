// Telegram Bot API helper — sends alerts to owner + florists.
// Like an automated pager system: when a new order arrives,
// everyone who needs to act gets a direct message.

const BASE_URL = 'https://api.telegram.org/bot';

/**
 * Get all configured chat IDs (owner + florists).
 * TELEGRAM_CHAT_IDS is a comma-separated list of chat IDs.
 * Falls back to TELEGRAM_OWNER_CHAT_ID for backwards compatibility.
 */
function getChatIds() {
  const ids = process.env.TELEGRAM_CHAT_IDS;
  if (ids) return ids.split(',').map(s => s.trim()).filter(Boolean);
  const owner = process.env.TELEGRAM_OWNER_CHAT_ID;
  return owner ? [owner] : [];
}

/**
 * Send a text message to a single Telegram chat.
 */
async function sendTo(token, chatId, text) {
  try {
    const res = await fetch(`${BASE_URL}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[TELEGRAM] Send to ${chatId} failed:`, err);
    }
  } catch (err) {
    console.error(`[TELEGRAM] Send to ${chatId} error:`, err.message);
  }
}

/**
 * Send a text message to the owner's chat only (backwards compat).
 */
export async function sendAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return null;
  await sendTo(token, chatId, text);
}

/**
 * Broadcast a message to ALL configured chats (owner + florists).
 */
export async function broadcastAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const chatIds = getChatIds();
  if (chatIds.length === 0) return;
  await Promise.all(chatIds.map(id => sendTo(token, id, text)));
}

/**
 * Send a new-order notification to all team members.
 */
export async function notifyNewOrder({ source, customerName, request, deliveryType, price }) {
  const lines = [
    `🌸 <b>New order</b> — ${source || 'In-store'}`,
    customerName ? `👤 ${customerName}` : '',
    request ? `📝 ${request}` : '',
    deliveryType ? `📦 ${deliveryType}` : '',
    price ? `💰 ${price} zł` : '',
  ].filter(Boolean);
  await broadcastAlert(lines.join('\n'));
}
