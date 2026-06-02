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
