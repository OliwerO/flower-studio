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

// ── Delivery-complete notification (owner only) ─────────────────
//
// Owner wants to know the moment a bouquet lands AND whether it was
// delivered inside the customer's promised window. All time comparisons
// run in Europe/Warsaw — the `Delivered At` timestamp is UTC but the
// `Delivery Time` slot is a local "HH:MM-HH:MM" string.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatMinDiff(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function krakowMinutes(iso) {
  // Reject null/undefined/empty so they don't coerce to the epoch
  // (which would otherwise return a real number and lie about timing).
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const h = parts.find(p => p.type === 'hour')?.value;
    const m = parts.find(p => p.type === 'minute')?.value;
    if (h == null || m == null) return null;
    return Number(h) * 60 + Number(m);
  } catch {
    return null;
  }
}

function krakowTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return null;
  }
}

// Accepts "HH:MM-HH:MM" or "HH:MM–HH:MM" (regular hyphen or en-dash).
// Returns null if the slot isn't parseable — caller falls back to
// "no planned slot" wording instead of showing a bogus comparison.
function parseSlot(slot) {
  if (!slot) return null;
  const parts = String(slot).split(/[-–]/).map(s => s.trim());
  if (parts.length !== 2) return null;
  if (!/^\d{1,2}:\d{2}$/.test(parts[0]) || !/^\d{1,2}:\d{2}$/.test(parts[1])) return null;
  return { start: toMinutes(parts[0]), end: toMinutes(parts[1]) };
}

function punctualityLabel(slot, deliveredAtIso) {
  const parsed = parseSlot(slot);
  const actual = krakowMinutes(deliveredAtIso);
  if (!parsed || actual == null) return null;
  if (actual < parsed.start) return `⚡ early by ${formatMinDiff(parsed.start - actual)}`;
  if (actual > parsed.end)   return `⚠ late by ${formatMinDiff(actual - parsed.end)}`;
  return '✅ on time';
}

// Exported for unit tests only — not part of the module's public API.
export const _internals = { parseSlot, punctualityLabel, formatMinDiff, krakowMinutes };

/**
 * Send a delivery-complete alert to the owner's Telegram.
 * Fire-and-forget — callers should not await unless they want to
 * block their HTTP response on Telegram latency.
 */
export async function notifyDeliveryComplete({
  customerName,
  appOrderId,
  bouquetSummary,
  recipientName,
  plannedSlot,
  deliveredAtIso,
  driver,
}) {
  const actualTime = deliveredAtIso ? krakowTime(deliveredAtIso) : null;
  const punct = punctualityLabel(plannedSlot, deliveredAtIso);

  let timingLine;
  if (plannedSlot && actualTime && punct) {
    timingLine = `🕐 ${escapeHtml(plannedSlot)} · delivered ${actualTime} (${punct})`;
  } else if (plannedSlot && actualTime) {
    timingLine = `🕐 ${escapeHtml(plannedSlot)} · delivered ${actualTime}`;
  } else if (actualTime) {
    timingLine = `🕐 Delivered ${actualTime}`;
  }

  const header = customerName
    ? `✅ <b>Delivered</b> — ${escapeHtml(customerName)}${appOrderId ? ` (#${escapeHtml(appOrderId)})` : ''}`
    : `✅ <b>Delivered</b>${appOrderId ? ` — #${escapeHtml(appOrderId)}` : ''}`;

  const lines = [
    header,
    bouquetSummary ? `🌸 ${escapeHtml(bouquetSummary)}` : '',
    recipientName && recipientName !== customerName ? `👤 To: ${escapeHtml(recipientName)}` : '',
    timingLine || '',
    driver ? `🚗 ${escapeHtml(driver)}` : '',
  ].filter(Boolean);

  await sendAlert(lines.join('\n'));
}
