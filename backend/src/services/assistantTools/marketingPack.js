// backend/src/services/assistantTools/marketingPack.js
//
// Marketing spend tool — thin adapter over marketingSpendRepo.
// Never recomputes anything; delegates to the canonical repo.
// NOTE: channel is free text; Order Source is an enum.
// The model must NOT attempt to join them — state the caveat when combining.
import * as marketingSpendRepo from '../../repos/marketingSpendRepo.js';

/** Round to 2 decimal places. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregate marketing spend by channel for the given period.
 *
 * @param {{ from?: string, to?: string }} input  YYYY-MM strings (both optional)
 * @returns {Promise<object>}
 */
export async function marketingSpendHandler({ from, to } = {}) {
  // Defensive: the repo expects YYYY-MM; if the model passes a full YYYY-MM-DD
  // (the format every other tool uses), trim to month so the repo doesn't build
  // a malformed 'YYYY-MM-DD-01' bound.
  const month = (d) => (typeof d === 'string' && d.length >= 7 ? d.slice(0, 7) : d);
  const fromM = month(from);
  const toM = month(to);
  const rows = await marketingSpendRepo.list({ from: fromM, to: toM });

  // Aggregate: total + per-channel map
  const channelMap = {};
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.Amount) || 0;
    total += amount;
    const channel = row.Channel || 'Unknown';
    channelMap[channel] = (channelMap[channel] || 0) + amount;
  }

  // Sort by amount descending
  const byChannel = Object.entries(channelMap)
    .map(([channel, amount]) => ({ channel, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period:      { from: fromM ?? null, to: toM ?? null },
    totalSpend:  round2(total),
    byChannel,
    rowCount:    rows.length,
  };
}
