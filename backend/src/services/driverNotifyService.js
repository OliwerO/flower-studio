// The single seam every assignment path calls to notify a Driver via Telegram
// (ADR-0009, PRD #368). Owns target resolution (chat id + language), the
// suppress-self and skip-unregistered guards, per-language message composition,
// and dispatch. Never throws into the caller — assignment must succeed even if
// Telegram is down.
//
// notifyDeliveryTimeChanged (issue #545) extends the seam to schedule edits:
// same target resolution + suppress-self / skip-unregistered guards, plus two
// guards unique to a schedule edit (both live HERE, not at the two call sites
// in routes/orders.js + routes/deliveries.js, so the two PATCH paths — order-
// side Required By/Delivery Time cascade, and delivery-side direct edit —
// can't drift): skip a terminal delivery (Delivered/Cancelled) and skip a
// no-op save (old date/time === new date/time).
import { getDriver } from '../repos/driverTelegramRepo.js';
import { sendToChat, escapeHtml } from './telegram.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import { DELIVERY_TERMINAL_STATUSES } from '../constants/statuses.js';

export const SUPPORTED_LANGS = ['ru', 'en', 'pl'];
const pickLang = (lang) => (SUPPORTED_LANGS.includes(lang) ? lang : 'ru');

// Message fragments. Static labels keyed by lang; headers/digest are builders.
export const M = {
  deliveryHeader: {
    ru: '🚚 Вам назначена доставка',
    en: "🚚 You've been assigned a delivery",
    pl: '🚚 Przydzielono Ci dostawę',
  },
  timeChangeHeader: {
    ru: '🕐 Изменилось время доставки',
    en: '🕐 Delivery time has changed',
    pl: '🕐 Zmienił się czas dostawy',
  },
  was: { ru: 'Было', en: 'Was', pl: 'Było' },
  now: { ru: 'Стало', en: 'Now', pl: 'Teraz' },
  poHeader: {
    ru: '🛒 Вам назначена закупка',
    en: "🛒 You've been assigned a purchase run",
    pl: '🛒 Przydzielono Ci zakupy',
  },
  poCancelledHeader: {
    ru: '🚫 Закупка отменена',
    en: '🚫 Purchase run cancelled',
    pl: '🚫 Zakupy odwołane',
  },
  poCancelledBody: {
    ru: 'Не нужно её покупать.',
    en: 'No need to buy it.',
    pl: 'Nie trzeba tego kupować.',
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
      orderNum ? `${M.order[lang]}: ${escapeHtml(orderNum)}` : '',
      (date || time) ? `${M.date[lang]}: ${[escapeHtml(date), escapeHtml(time)].filter(Boolean).join(' ')}` : '',
      addr ? `${M.address[lang]}: ${escapeHtml(addr)}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] delivery-assigned failed:', err.message);
  }
}

// Notify the assigned Driver that the delivery's date/time was edited after
// the fact — same target resolution + language mechanism as
// notifyDeliveryAssigned, but for a schedule correction rather than a fresh
// assignment (issue #545, PRD in the linked GitHub issue).
//
// `before`/`after` are delivery-shaped records (Airtable-style keys —
// 'Delivery Date', 'Delivery Time', 'Assigned Driver', 'Status', ...), the
// same wire format orderRepo hands back everywhere else. `before` may be
// null (fetch failed) — treated as "no prior value", which conservatively
// still fires when `after` has a value (better to over-notify on a rare
// fetch hiccup than silently miss a real change).
//
// Guards — ALL of them live here (not at the two call sites) so the
// order-side cascade path and the delivery-side direct-edit path can never
// diverge on when they fire:
//   - no delivery / no assigned driver → nothing to notify
//   - actor IS the assigned driver → self-edit, no self-ping
//   - delivery already Delivered/Cancelled → driver doesn't need it anymore
//   - old date+time === new date+time → no-op save, not a real change
//   - driver not registered on Telegram → resolveTarget returns null
export async function notifyDeliveryTimeChanged({ before, after, actorName }) {
  try {
    if (!after) return;
    const driverName = after['Assigned Driver'] || '';
    if (!driverName) return;
    if (actorName && actorName === driverName) return; // self-edit
    if (DELIVERY_TERMINAL_STATUSES.includes(after.Status)) return; // Delivered/Cancelled

    const oldDate = before?.['Delivery Date'] || '';
    const oldTime = before?.['Delivery Time'] || '';
    const newDate = after['Delivery Date'] || '';
    const newTime = after['Delivery Time'] || '';
    if (oldDate === newDate && oldTime === newTime) return; // no-op save

    const target = await resolveTarget(driverName);
    if (!target) return;
    const { lang } = target;
    const orderNum = await orderNumberFor(after);
    const addr = after['Delivery Address'] || '';
    const oldStr = [oldDate, oldTime].filter(Boolean).join(' ');
    const newStr = [newDate, newTime].filter(Boolean).join(' ');
    const text = [
      M.timeChangeHeader[lang],
      orderNum ? `${M.order[lang]}: ${escapeHtml(orderNum)}` : '',
      addr ? `${M.address[lang]}: ${escapeHtml(addr)}` : '',
      oldStr ? `${M.was[lang]}: ${escapeHtml(oldStr)}` : '',
      newStr ? `${M.now[lang]}: ${escapeHtml(newStr)}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] time-change failed:', err.message);
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
      lines.push(`${i + 1}. ${[escapeHtml(orderNum), escapeHtml(time), escapeHtml(addr)].filter(Boolean).join(' · ')}`);
    }
    const text = [M.digestHeader[lang](deliveries.length), ...lines].join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] digest failed:', err.message);
  }
}

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
      ref ? `${M.order[lang]}: ${escapeHtml(ref)}` : '',
      date ? `${M.date[lang]}: ${escapeHtml(date)}` : '',
      flowers ? `${M.buy[lang]}: ${escapeHtml(flowers)}` : '',
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] po-assigned failed:', err.message);
  }
}

/**
 * Tell the assigned Driver a purchase run is off (ADR-0015).
 *
 * Fires for BOTH kinds of termination — a Draft/Sent order deleted outright and
 * a Shopping order cancelled — because from the Driver's side they are the same
 * event: the run they were messaged about is no longer happening. A deleted
 * order is already gone by the time this runs, so the caller passes the details
 * it captured beforehand rather than an id to look up.
 */
export async function notifyPoCancelled({ driverName, poRef = '', plannedDate = '' }) {
  try {
    if (!driverName) return;
    const target = await resolveTarget(driverName);
    if (!target) return;
    const { lang } = target;
    const text = [
      M.poCancelledHeader[lang],
      poRef ? `${M.order[lang]}: ${escapeHtml(poRef)}` : '',
      plannedDate ? `${M.date[lang]}: ${escapeHtml(plannedDate)}` : '',
      M.poCancelledBody[lang],
    ].filter(Boolean).join('\n');
    await sendToChat(target.chatId, text);
  } catch (err) {
    console.error('[DRIVER_NOTIFY] po-cancelled failed:', err.message);
  }
}
