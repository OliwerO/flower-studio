// backend/src/services/assistantTools/ordersPack.js
import * as orderRepo from '../../repos/orderRepo.js';
import { ORDER_STATUS } from '../../constants/statuses.js';

const SOFT_ROW_CAP = 50;
const HARD_ROW_CEILING = 250;

function buildPg(input) {
  const { dateField = 'order', from, to, status, deliveryType, source, paymentStatus, paymentMethod, customerId } = input;
  // When a specific status is requested, do NOT also exclude Cancelled — the user asked for it.
  const pg = status ? {} : { excludeStatuses: [ORDER_STATUS.CANCELLED] };
  if (dateField === 'delivery') { if (from) pg.requiredByFrom = from; if (to) pg.requiredByTo = to; }
  else { if (from) pg.dateFrom = from; if (to) pg.dateTo = to; }
  if (status) pg.statuses = [status];
  if (deliveryType) pg.deliveryType = deliveryType;
  if (source) pg.source = source;
  if (paymentStatus) pg.paymentStatus = paymentStatus;
  if (paymentMethod) pg.paymentMethod = paymentMethod;
  if (customerId) pg.customerId = customerId;
  return pg;
}

export async function queryOrdersHandler(input) {
  const { from, to } = input;
  const rows = await orderRepo.list({ pg: buildPg(input) });
  const matchedCount = rows.length;
  const bounded = Boolean(from && to);
  const cap = bounded ? HARD_ROW_CEILING : SOFT_ROW_CAP;
  const shownRows = rows.slice(0, cap);
  return {
    period: { from: from ?? null, to: to ?? null },
    matchedCount,
    truncated: matchedCount > shownRows.length,
    shown: shownRows.length,
    orders: shownRows.map(o => ({
      id: o['App Order ID'],
      orderDate: o['Order Date'],
      requiredBy: o['Required By'],
      deliveryType: o['Delivery Type'],
      status: o.Status,
      source: o.Source,
      paymentStatus: o['Payment Status'],
    })),
  };
}

const DIMENSION_KEY = {
  deliveryType: o => o['Delivery Type'] || 'Unknown',
  source: o => o.Source || 'Unknown',
  status: o => o.Status || 'Unknown',
  paymentStatus: o => o['Payment Status'] || 'Unknown',
  paymentMethod: o => o['Payment Method'] || 'Unknown',
};

export async function breakdownOrdersHandler(input) {
  const { dimension, from, to } = input;
  const keyOf = DIMENSION_KEY[dimension];
  if (!keyOf) throw new Error(`Unknown breakdown dimension: ${dimension}`);
  const rows = await orderRepo.list({ pg: buildPg({ ...input, status: undefined }) });
  const breakdown = {};
  for (const o of rows) { const k = keyOf(o); breakdown[k] = (breakdown[k] || 0) + 1; }
  return { period: { from: from ?? null, to: to ?? null }, dimension, total: rows.length, breakdown };
}
