import * as stockRepo from '../../repos/stockRepo.js';
import * as stockLossRepo from '../../repos/stockLossRepo.js';

const SOFT_ROW_CAP = 50;
const HARD_ROW_CEILING = 250;

// Available stock = Current Quantity (already net of committed demand — CLAUDE.md
// pitfall #8; never subtract a separate "committed" figure). qty < 0 = shortfall.
export async function stockStatusHandler(input = {}) {
  const { shortfallOnly = false, search, limit } = input;
  const pg = { includeEmpty: true };
  if (search) pg.displayName = `%${search}%`;
  const rows = await stockRepo.list({ pg });
  let items = rows.map((r) => {
    const quantity = Number(r['Current Quantity']) || 0;
    return { name: r['Display Name'], quantity, unit: r['Unit'] ?? null, shortfall: quantity < 0 };
  });
  if (shortfallOnly) items = items.filter((i) => i.shortfall);
  const matchedCount = items.length;
  const cap = limit ? Math.min(limit, HARD_ROW_CEILING) : (shortfallOnly ? HARD_ROW_CEILING : SOFT_ROW_CAP);
  const shown = items.slice(0, cap);
  return {
    matchedCount,
    shortfallCount: items.filter((i) => i.shortfall).length,
    truncated: matchedCount > shown.length,
    shown: shown.length,
    items: shown,
  };
}

const WRITEOFF_FLOWER_CAP = 50;

export async function stockWriteoffsHandler(input = {}) {
  const { from, to, reason: reasonFilter } = input;
  let rows = await stockLossRepo.list({ from, to });
  // Optional case-insensitive reason filter (e.g. only "wilted" or "broken").
  if (reasonFilter) {
    const want = String(reasonFilter).trim().toLowerCase();
    rows = rows.filter((r) => String(r.Reason || '').toLowerCase() === want);
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const byReason = {};
  const flowerMap = new Map(); // flowerName -> { flower, quantity, entryCount, lostValue }
  let totalQuantity = 0;
  let totalLostValue = 0;   // sum of quantity * batch cost (zł), where cost is known
  let unvaluedQuantity = 0; // stems we can't value (loss row has no linked stock / no cost)
  for (const r of rows) {
    const reason = r.Reason || 'Unknown';
    const flower = r.flowerName || '—';
    const q = Number(r.Quantity) || 0;
    // costPrice = the linked batch's current cost (stock.currentCostPrice via the
    // loss→stock join in stockLossRepo). Same basis supplier_scorecard uses for
    // wasteCost. Loss rows with no stock link (flowerName '—') have cost 0.
    const cost = Number(r.costPrice) || 0;
    const value = q * cost;
    byReason[reason] = (byReason[reason] || 0) + q;
    const f = flowerMap.get(flower) || { flower, quantity: 0, entryCount: 0, lostValue: 0 };
    f.quantity += q;
    f.entryCount += 1;
    f.lostValue += value;
    flowerMap.set(flower, f);
    totalQuantity += q;
    totalLostValue += value;
    if (cost <= 0) unvaluedQuantity += q;
  }

  // Most-wasted flowers first (by stems) — answers "which flowers were wasted most".
  // Each entry also carries lostValue (zł) for "how much did waste cost me by flower".
  const sorted = [...flowerMap.values()].sort((a, b) => b.quantity - a.quantity);
  const byFlower = sorted
    .slice(0, WRITEOFF_FLOWER_CAP)
    .map((f) => ({ ...f, lostValue: round2(f.lostValue) }));

  return {
    period: { from: from ?? null, to: to ?? null },
    reason: reasonFilter ?? null,
    entryCount: rows.length,
    totalQuantity,
    totalLostValue: round2(totalLostValue),
    unvaluedQuantity, // stems excluded from totalLostValue (no linked stock/cost)
    currency: 'zł',
    byReason,
    flowerCount: flowerMap.size,
    byFlower,
    truncated: flowerMap.size > byFlower.length,
  };
}
