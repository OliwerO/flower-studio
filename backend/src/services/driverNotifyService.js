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
export const M = {
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
export async function resolveTarget(driverName) {
  const row = await getDriver(driverName);
  if (!row?.chatId) {
    console.log(`[DRIVER_NOTIFY] ${driverName} not registered — skipped`);
    return null;
  }
  return { chatId: row.chatId, lang: pickLang(row.lang) };
}

export async function orderNumberFor(delivery) {
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
