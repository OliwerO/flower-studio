// Telegram Bot API helper — sends alerts to the owner.
// Like an automated pager system: when something needs attention
// (oversold item, sync failure), the owner gets a direct message.

const BASE_URL = 'https://api.telegram.org/bot';

/**
 * Send a text message to the owner's Telegram chat.
 * Silently fails if credentials are not configured (non-blocking).
 */
export async function sendAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[TELEGRAM] Bot token or chat ID not configured — skipping alert');
    return null;
  }

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
      console.error('[TELEGRAM] Send failed:', err);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error('[TELEGRAM] Send error:', err.message);
    return null;
  }
}
