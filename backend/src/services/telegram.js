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

/**
 * Owner-only alert when Wix pull/push completes with errors.
 *
 * Why owner-only: Wix sync is the owner's workflow — florists don't need
 * these pings and would get noise. Uses `sendAlert` (single-chat) not
 * `broadcastAlert`.
 *
 * Format: title line + error count + up to 3 truncated error messages.
 * Full error list lives in the app toast + Railway logs — this is just
 * a signal that something needs attention.
 *
 * @param direction "pull" | "push"
 * @param errors array of error strings from stats.errors
 */
export async function notifyWixSyncError({ direction, errors }) {
  if (!errors || errors.length === 0) return;
  const dirLabel = direction === 'pull' ? 'Pull' : 'Push';
  const shown = errors.slice(0, 3).map(e => {
    // Truncate very long messages so the Telegram message stays readable.
    const s = String(e);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  });
  const moreLine = errors.length > 3 ? `\n<i>…and ${errors.length - 3} more</i>` : '';
  const lines = [
    `🔴 <b>Wix sync — ${dirLabel} errors</b>`,
    `${errors.length} error${errors.length === 1 ? '' : 's'}`,
    '',
    ...shown.map(e => `• <code>${escapeHtml(e)}</code>`),
    moreLine,
  ].filter(Boolean);
  await sendAlert(lines.join('\n'));
}

// Telegram parses HTML in message bodies (parse_mode: 'HTML'), so raw
// angle brackets in Wix error payloads would confuse the parser. Escape
// only inside <code> blocks where the owner sees the raw error.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
