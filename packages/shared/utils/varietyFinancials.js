/**
 * Per-Variety financials for the stock cards (CR-05 follow-on). Mirrors
 * BatchArrivalList.flatten's derivation so Shortfalls / Pending Arrivals show the
 * same Cost / Sell / Markup / Supplier as the Flat table.
 *   cost     — newest positive-qty batch's cost (fallback: any row carrying a cost)
 *   sell     — that same source row's sell (fallback: any row's sell)
 *   markup   — sell / cost when both > 0, else null
 *   supplier — aggregated across rows: one name, "A, B" for two, "A +N" for more
 */

function readNum(row, displayKey, snakeKey) {
  const v = row[displayKey] ?? row[snakeKey];
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function varietyFinancials(rows = []) {
  let newest = null;   // { date, cost, sell } from newest positive-qty batch
  let fallback = null; // { cost, sell } from the first row that has any price
  const suppliers = new Set();

  for (const row of rows) {
    const cost = readNum(row, 'Current Cost Price', 'current_cost_price');
    const sell = readNum(row, 'Current Sell Price', 'current_sell_price');
    const supplier = row.Supplier ?? row.supplier ?? null;
    const qty = Number(row.current_quantity) || 0;
    const date = row.date ?? null;

    if (supplier) suppliers.add(supplier);
    if (fallback == null && (cost != null || sell != null)) fallback = { cost, sell };

    if (qty > 0) {
      if (date && (!newest || date > newest.date)) newest = { date, cost, sell };
      else if (!newest) newest = { date: null, cost, sell };
    }
  }

  const src = newest ?? fallback ?? { cost: null, sell: null };
  const cost = src.cost;
  const sell = src.sell;
  const markup = (cost > 0 && sell > 0) ? sell / cost : null;
  const arr = [...suppliers];
  const supplier =
    arr.length === 0 ? null :
    arr.length === 1 ? arr[0] :
    arr.length === 2 ? arr.join(', ') :
    `${arr[0]} +${arr.length - 1}`;

  return { cost, sell, markup, supplier };
}
