// Ask Blossom — purchasing tool pack.
// po_status: PO workflow (stockOrderRepo) — counts by status, open vs complete, sample list.
// purchase_spend: actual flower spend over a range (stockPurchasesRepo) — total zł + by supplier.
// computeAnalytics covers neither the PO workflow nor a plain purchase-spend total.
import * as stockOrderRepo from '../../repos/stockOrderRepo.js';
import * as stockPurchasesRepo from '../../repos/stockPurchasesRepo.js';
import { PO_STATUS } from '../../constants/statuses.js';

const CAP = 25;
const round = (n) => Math.round(n * 100) / 100;

export async function poStatusHandler(input = {}) {
  const { status, limit } = input;
  const pos = await stockOrderRepo.list(status ? { status } : {});
  const byStatus = {};
  let open = 0, complete = 0;
  for (const po of pos) {
    const s = po.Status || 'Unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (s === PO_STATUS.COMPLETE) complete++; else open++;
  }
  const cap = Math.min(limit || CAP, CAP);
  const shown = pos.slice(0, cap).map(po => ({
    id: po['Stock Order ID'] || po.id,
    status: po.Status,
    createdDate: po['Created Date'],
    plannedDate: po['Planned Date'],
    driver: po['Assigned Driver'],
  }));
  return { matchedCount: pos.length, byStatus, open, complete, truncated: pos.length > shown.length, shown: shown.length, data: shown };
}

export async function purchaseSpendHandler(input = {}) {
  const { from, to } = input;
  const rows = await stockPurchasesRepo.list({ from, to });
  let total = 0;
  const bySupplier = {};
  for (const r of rows) {
    const cost = (Number(r['Price Per Unit']) || 0) * (Number(r['Quantity Purchased']) || 0);
    total += cost;
    const sup = r.Supplier || 'Unknown';
    bySupplier[sup] = (bySupplier[sup] || 0) + cost;
  }
  return {
    period: { from: from || null, to: to || null },
    purchaseCount: rows.length,
    totalSpend: round(total),
    bySupplier: Object.fromEntries(Object.entries(bySupplier).map(([k, v]) => [k, round(v)])),
  };
}
