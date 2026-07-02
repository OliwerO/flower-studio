// Ask Blossom — purchase_detail tool.
// Lists individual flower purchases (PO receipt lines), not just per-supplier
// totals like purchasingPack.purchaseSpendHandler. Answers "how much did we
// pay Stefan in June, on which days" / "what flowers did we buy from X".
// Thin adapter: stockPurchasesRepo.list (date range) + stockRepo.listByIds
// (batch-resolve the linked stock item's display name). No raw SQL here.
import * as stockPurchasesRepo from '../../repos/stockPurchasesRepo.js';
import * as stockRepo from '../../repos/stockRepo.js';

const CAP = 200;
const round = (n) => Math.round(n * 100) / 100;

export async function purchaseDetailHandler(input = {}) {
  const { supplier, flower, from, to, limit } = input;

  const rows = await stockPurchasesRepo.list({ from, to });

  // Batch-resolve the linked stock item's display name for every purchase
  // row that carries a Flower link (stockAirtableId or stockId).
  const flowerIds = [...new Set(rows.flatMap((r) => r.Flower || []))];
  const stockRows = flowerIds.length ? await stockRepo.listByIds(flowerIds) : [];
  const nameById = new Map();
  for (const s of stockRows) {
    const displayName = s['Display Name'] || s['Purchase Name'] || '—';
    if (s.id) nameById.set(s.id, displayName);
    if (s._pgId) nameById.set(s._pgId, displayName);
  }
  const flowerNameFor = (r) => {
    const id = (r.Flower || [])[0];
    return id ? (nameById.get(id) || '—') : '—';
  };

  const supplierQuery = supplier ? String(supplier).trim().toLowerCase() : null;
  const flowerQuery = flower ? String(flower).trim().toLowerCase() : null;

  const matched = rows.filter((r) => {
    if (supplierQuery && !String(r.Supplier || '').toLowerCase().includes(supplierQuery)) return false;
    if (flowerQuery && !flowerNameFor(r).toLowerCase().includes(flowerQuery)) return false;
    return true;
  });

  // Ascending by purchase date — "on which days" reads naturally in order.
  matched.sort((a, b) => String(a['Purchase Date']).localeCompare(String(b['Purchase Date'])));

  let total = 0;
  const byDateMap = new Map();
  const byFlowerMap = new Map();

  const allTransactions = matched.map((r) => {
    const qty = Number(r['Quantity Purchased']) || 0;
    const unitPrice = r['Price Per Unit'] != null ? Number(r['Price Per Unit']) : null;
    const amount = round((unitPrice || 0) * qty);
    const date = r['Purchase Date'];
    const flowerName = flowerNameFor(r);
    const supplierName = r.Supplier || '';
    const quantityAccepted = r['Quantity Accepted'] != null ? Number(r['Quantity Accepted']) : null;
    const writtenOff = quantityAccepted != null ? round(qty - quantityAccepted) : null;

    total += amount;
    byDateMap.set(date, round((byDateMap.get(date) || 0) + amount));

    const fEntry = byFlowerMap.get(flowerName) || { qty: 0, amount: 0 };
    fEntry.qty = round(fEntry.qty + qty);
    fEntry.amount = round(fEntry.amount + amount);
    byFlowerMap.set(flowerName, fEntry);

    return { date, flower: flowerName, supplier: supplierName, qty, quantityAccepted, writtenOff, unitPrice, amount };
  });

  // Totals/byDate/byFlower are always over the FULL match; only the
  // transactions list itself is capped (mirrors the rest of the tool pack —
  // aggregate is never truncated, the listing may be).
  // Normalize limit: only a finite positive number narrows the list; 0/negative/
  // NaN fall back to the hard CAP (a negative slice end would drop rows from the tail).
  const n = Number(limit);
  const cap = Number.isFinite(n) && n > 0 ? Math.min(n, CAP) : CAP;
  const transactions = allTransactions.slice(0, cap);

  return {
    period: { from: from || null, to: to || null },
    supplier: supplier || null,
    flower: flower || null,
    transactionCount: matched.length,
    totalSpend: round(total),
    currency: 'zł',
    transactions,
    byDate: [...byDateMap.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byFlower: [...byFlowerMap.entries()].map(([flowerName, v]) => ({
      flower: flowerName,
      qty: round(v.qty),
      amount: round(v.amount),
    })),
  };
}
