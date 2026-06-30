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

  const byReason = {};
  const flowerMap = new Map(); // flowerName -> { flower, quantity, entryCount }
  let totalQuantity = 0;
  for (const r of rows) {
    const reason = r.Reason || 'Unknown';
    const flower = r.flowerName || '—';
    const q = Number(r.Quantity) || 0;
    byReason[reason] = (byReason[reason] || 0) + q;
    const f = flowerMap.get(flower) || { flower, quantity: 0, entryCount: 0 };
    f.quantity += q;
    f.entryCount += 1;
    flowerMap.set(flower, f);
    totalQuantity += q;
  }

  // Most-wasted flowers first — answers "which flowers were wasted most".
  const sorted = [...flowerMap.values()].sort((a, b) => b.quantity - a.quantity);
  const byFlower = sorted.slice(0, WRITEOFF_FLOWER_CAP);

  return {
    period: { from: from ?? null, to: to ?? null },
    reason: reasonFilter ?? null,
    entryCount: rows.length,
    totalQuantity,
    byReason,
    flowerCount: flowerMap.size,
    byFlower,
    truncated: flowerMap.size > byFlower.length,
  };
}
