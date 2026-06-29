// Ask Blossom — deliveries tool pack.
// delivery_status: operational view over the deliveries TABLE (orderRepo.listDeliveries) —
// counts by status + by driver over a date range, plus a capped sample. Distinct from
// computeAnalytics.delivery (order-derived pickup/delivery split). Thin adapter, no logic
// beyond aggregation/shaping.
import * as orderRepo from '../../repos/orderRepo.js';

const CAP = 25;

export async function deliveryStatusHandler(input = {}) {
  const { from, to, status, driver, limit } = input;
  const rows = await orderRepo.listDeliveries({ pg: { from, to, status, driver } });
  const byStatus = {};
  const byDriver = {};
  for (const d of rows) {
    const s = d.Status || 'Unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
    const drv = d['Assigned Driver'] || 'Unassigned';
    byDriver[drv] = (byDriver[drv] || 0) + 1;
  }
  const cap = Math.min(limit || CAP, CAP);
  const shown = rows.slice(0, cap).map(d => ({
    id: d.id,
    date: d['Delivery Date'],
    time: d['Delivery Time'],
    status: d.Status,
    driver: d['Assigned Driver'],
    recipient: d['Recipient Name'],
    address: d['Delivery Address'],
    fee: d['Delivery Fee'],
    deliveredAt: d['Delivered At'],
  }));
  return {
    period: { from: from || null, to: to || null },
    matchedCount: rows.length,
    byStatus,
    byDriver,
    truncated: rows.length > shown.length,
    shown: shown.length,
    data: shown,
  };
}
