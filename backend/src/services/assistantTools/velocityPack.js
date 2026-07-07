// backend/src/services/assistantTools/velocityPack.js
//
// Stock velocity tool — fastest/slowest-moving items by stems sold in window.
//
// Canonical sources:
//   - orderRepo.getLinesForVelocity(dateFrom, dateTo) → [{stockItemId, quantity}]
//     (non-cancelled order lines in window, filtered by order_date)
//   - stockRepo.list({ pg: { includeEmpty: true } }) → all active stock rows
//     with wire-format fields including _pgId, 'Display Name', 'Current Quantity'
//
// Y-model safe: groups by 'Display Name' so multi-batch Varieties (multiple PG
// rows sharing the same display name) merge their qtySold and currentQty sums.
//
// Pitfall #8 compliance: currentQty is used as-is from 'Current Quantity' (already
// net of committed demand). qty < 0 = genuine shortfall — never subtract committed.
//
// Caveat: lines where stockItemId is a legacy recXXX no longer backed by a PG
// stock row will not join and their sales are invisible. Free-text-named lines
// (no stockItemId) are also excluded — both are correct behavior.

import * as orderRepo from '../../repos/orderRepo.js';
import * as stockRepo from '../../repos/stockRepo.js';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Stock velocity report: fastest/slowest-moving items in a trailing window.
 *
 * @param {{
 *   days?: number,           default 30, capped at 90
 *   sort?: 'fastest'|'slowest',  default 'fastest'
 *   limit?: number,          default 20, capped at 50
 *   search?: string,         case-insensitive substring on Display Name
 * }} input
 * @returns {Promise<{
 *   windowDays: number,
 *   trackedItemCount: number,
 *   zeroSalesCount: number,
 *   sort: string,
 *   items: object[],
 *   truncated: boolean,
 *   shown: number,
 * }>}
 */
export async function stockVelocityHandler(input = {}) {
  const days = Math.min(Math.max(Number(input.days) || DEFAULT_DAYS, 1), MAX_DAYS);
  const sort = input.sort === 'slowest' ? 'slowest' : 'fastest';
  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const search = input.search ? String(input.search).toLowerCase() : null;

  // Date window: [today - days, today] both inclusive
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Fetch non-cancelled order lines within the window (by order_date)
  const lines = await orderRepo.getLinesForVelocity(fromDate, today);

  // Sum qty sold per stockItemId (UUID strings)
  const qtySoldById = {};
  for (const line of lines) {
    const id = line.stockItemId;
    if (!id) continue;
    qtySoldById[id] = (qtySoldById[id] || 0) + Number(line.quantity || 0);
  }

  // Fetch all active stock rows including zero/negative qty (pitfall #8 — never filter by qty here)
  const stockRows = await stockRepo.list({ pg: { includeEmpty: true } });

  // Group by Display Name — sums qtySold and currentQty across all batches sharing a name.
  // This merges Y-model siblings.
  const groups = {};
  for (const row of stockRows) {
    const name = row['Display Name'];
    if (!name) continue;
    const rowQty = Number(row['Current Quantity']) || 0;
    const rowSold = qtySoldById[row._pgId] || 0;

    if (!groups[name]) {
      groups[name] = { qtySold: 0, currentQty: 0 };
    }
    groups[name].qtySold += rowSold;
    groups[name].currentQty += rowQty;
  }

  // Build item list with computed metrics
  let items = Object.entries(groups).map(([name, g]) => {
    const avgDailyUsage = round1(g.qtySold / days);
    const shortfall = g.currentQty < 0;
    // daysOfSupply only when usage is positive AND we have positive stock (pitfall #8: never show
    // daysOfSupply when in shortfall — currentQty < 0 means buy more, not "X days left")
    const daysOfSupply = (avgDailyUsage > 0 && g.currentQty > 0)
      ? round1(g.currentQty / avgDailyUsage)
      : null;
    return { name, qtySold: g.qtySold, avgDailyUsage, currentQty: g.currentQty, daysOfSupply, shortfall };
  });

  // Apply search filter (case-insensitive substring on name)
  if (search) {
    items = items.filter(i => i.name.toLowerCase().includes(search));
  }

  // Count zero-sales items (after search, before fastest filter removes them)
  const zeroSalesCount = items.filter(i => i.qtySold === 0).length;

  // For 'fastest': exclude zero-sales items unless a search is active
  // (search scope is already narrow; showing a matched zero-sale item is useful)
  if (sort === 'fastest' && !search) {
    items = items.filter(i => i.qtySold > 0);
  }

  // Sort: fastest = qtySold desc, slowest = qtySold asc; stable tie-break by name
  if (sort === 'slowest') {
    items.sort((a, b) => a.qtySold - b.qtySold || a.name.localeCompare(b.name));
  } else {
    items.sort((a, b) => b.qtySold - a.qtySold || a.name.localeCompare(b.name));
  }

  const trackedItemCount = items.length;
  const capped = items.slice(0, limit);

  return {
    windowDays: days,
    period: { from: fromDate, to: today }, // period-echo: lets the assistant state the resolved window
    trackedItemCount,
    zeroSalesCount,
    sort,
    items: capped,
    truncated: trackedItemCount > capped.length,
    shown: capped.length,
  };
}
