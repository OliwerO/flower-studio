// buildPoSuggestions — Y-model New-PO-form pre-fill source.
//
// Replaces the legacy `stock.filter(qty < 0).map(...)` pre-fill, which (under
// STOCK_Y_MODEL) listed one line per raw Demand Entry row and never netted
// pending POs — so it over-proposed Varieties already covered by on-hand stock
// AND re-proposed stems already on a Sent PO.
//
// Here we work at Variety granularity and reuse the single availability model:
//   effective = onHand − committed − reserved + incoming   (getVarietyAvailability)
// `incoming` is the sum of ALL pending PO arrivals for the Variety, DATE-AGNOSTIC
// (arrivalsForVariety). That is deliberate and differs from the stock-panel
// SHORTFALLS list (allocateVarietyCoverage, date-aware: a late PO still shows as
// short with a "+N late" flag). The form must NOT re-buy what is already on order,
// so a late PO nets out here even though the panel keeps flagging the gap.
//
// A Variety is suggested only when it has genuine customer demand (committed > 0)
// AND remains short after stock + all open POs (effective < 0). The buy quantity
// is `−effective`, which already accounts for premade reservations reducing the
// free on-hand pool.
//
// Attachment (pitfall #9): link the line to the Variety's UNDATED orig row
// (date === null) so receiveIntoStock absorbs into the right Variety. When the
// Variety has no orig card (e.g. a DE-only Variety), send the 4-tuple identity
// with no stockItemId — the #304 new-Variety PO path creates the card on receipt.

import { getVarietyAvailability, arrivalsForVariety } from './stockMath.js';
import { varietyFinancials } from './varietyFinancials.js';
import { varietyDisplayName } from './varietyKey.js';

/**
 * @param {Array} groups        GET /stock?grouped=true → groups[]
 * @param {Object} pendingPO    GET /stock/pending-po → { stockId: { ordered, plannedDate, pos:[{quantity, plannedDate}] } }
 * @param {Object} premadeMap   GET /stock/premade-committed → { stockId: { qty, bouquets } }
 * @returns {Array} form-line objects ready to spread into the New-PO form's formLines
 */
export function buildPoSuggestions(groups = [], pendingPO = {}, premadeMap = {}) {
  const out = [];
  for (const g of groups) {
    const rows = g.rows || [];
    const reservations = new Map(rows.map(r => [r.id, Number(premadeMap?.[r.id]?.qty) || 0]));
    const arrivals = arrivalsForVariety(rows, pendingPO);
    const { committed, effective } = getVarietyAvailability(rows, reservations, arrivals);

    // Demand-driven only: a Variety with zero customer demand (premade reservation
    // alone) is never auto-proposed — matches the SHORTFALLS panel's mental model.
    if (committed <= 0 || effective >= 0) continue;
    const quantity = Math.ceil(-effective);
    if (quantity <= 0) continue;

    const fin = varietyFinancials(rows);
    const orig = rows.find(r => r.date == null) || null;
    const canonical = orig || rows[0] || {};
    const flowerName = canonical['Display Name'] || varietyDisplayName(g) || '';
    const cost = fin.cost != null && fin.cost > 0 ? fin.cost : 0;
    const sell = fin.sell != null && fin.sell > 0 ? fin.sell : 0;

    out.push({
      stockItemId: orig ? orig.id : '',
      flowerName,
      quantity,
      lotSize: Number(canonical['Lot Size']) || 0,
      packages: 0,
      supplier: fin.supplier || canonical.Supplier || '',
      costPrice: cost > 0 ? String(cost) : '',
      sellPrice: sell > 0 ? String(sell) : '',
      sellPriceManual: sell > 0,
      farmer: canonical.Farmer || '',
      notes: '',
      // Carry the 4-tuple identity only when there is no orig card to link to
      // (new-Variety PO line, #304). When linking to an orig, leave blank so the
      // line is a plain stock-linked line.
      type: orig ? '' : (g.type_name || ''),
      colour: orig ? '' : (g.colour || ''),
      size: orig ? '' : (g.size_cm != null ? String(g.size_cm) : ''),
      cultivar: orig ? '' : (g.cultivar || ''),
    });
  }
  return out;
}
