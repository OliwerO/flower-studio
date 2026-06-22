// lab/scenarios/yModelGuide.js
//
// TEACHING fixture for the Y-model. Unlike y-model-demo (deliberately rich and
// MIXED — every Variety juggles several concepts at once), this scenario gives
// each concept its OWN clearly-named Variety so a guide can point at exactly one
// row and say "this = this concept = this display." Companion doc:
//   docs/superpowers/plans/2026-06-12-ymodel-functionality-guide.md
//
// Use:
//   npm run lab:template:rebuild -- --scenario=y-model-guide
//   npm run lab:reset
//
// Concept map (one Variety each):
//   1  Rose Red 50cm Naomi           — healthy stock, single batch, no demand
//   2  Rose White 60cm Avalanche     — multiple batches, one Variety (FEFO)
//   3  Tulip Yellow 40cm             — committed demand against healthy stock
//   4  Ranunculus Orange 40cm        — pure shortfall / negative, NO incoming PO
//   5  Peony Pink 50cm               — shortfall COVERED by an incoming PO
//   6  Lisianthus White 50cm         — surplus incoming (more arrives than needed)
//   7  Hydrangea Blue 30cm           — premade reservation ties up physical stock
//   8  Peony Pink 60cm Sarah Bernhardt — same Variety, TWO demand dates
//   9  (attr-less "peony")           — half-entered PO line → nameless row (defect)
//   10 Gypsophila White              — undated legacy aggregate (the "fuzzy" row)
//   11 Astilbe Pink 50cm             — TIGHT: net exactly 0 with committed demand (amber)
//   12 Dahlia Red 60cm               — OVERDUE incoming PO (still Sent, past due → red chip)
//   13 Freesia Yellow 40cm           — LATE PO (arrives after demand → shortfall + amber badge)
//   14 Carnation Red 50cm            — two batches, DIFFERENT sell prices (multi-tier label)
//   15 Statice Purple 40cm           — cost set, NO sell → owner row without ×markup badge
//   16 Scabiosa Blue 50cm            — genuine DRIFT>0 (inflows exceed on-hand → amber footer)
//   17 Aster White 50cm              — UNDATED demand + undated incoming PO (the '—' chips)
//   18 Eucalyptus Green 50cm         — DISSOLVE event (premade dissolved → released stems)
//
// Anchored to the real lab clock (2026-06-22): batches arrived in the recent
// past, demands are needed in the near future, the still-Sent PO arrives
// 2026-06-26, and the already-Complete absorption PO landed 2026-06-19 (past).

import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';
import { makeStockLoss } from '../factories/stockLoss.js';
import { makeStockPurchase } from '../factories/stockPurchase.js';
import { makeAuditLog } from '../factories/auditLog.js';

const TODAY         = '2026-06-22';   // real lab clock
const BATCH_RECENT  = '2026-06-20';   // TODAY-2  recent delivery
const BATCH_OLD     = '2026-06-15';   // TODAY-7  older batch (FEFO drains first)
const NEED_23       = '2026-06-23';   // TODAY+1
const NEED_25       = '2026-06-25';   // TODAY+3
const NEED_27       = '2026-06-27';   // TODAY+5
const NEED_28       = '2026-06-28';   // TODAY+6
const NEED_30       = '2026-06-30';   // TODAY+8
const PO_ARRIVE     = '2026-06-26';   // TODAY+4  Sent PO — still in the future
const ABSORB_NEED   = '2026-06-17';   // TODAY-5  pre-sold demand (past)
const ABSORB_ARRIVE = '2026-06-19';   // TODAY-3  Complete PO already received (past)
const PO_OVERDUE    = '2026-06-18';   // TODAY-4  still-Sent PO already past due (overdue chip)
const DISSOLVE_AT   = '2026-06-21T09:00:00Z'; // fixed → dissolve event plots at 2026-06-21

export function buildYModelGuide() {
  faker.seed(612);
  const base = buildBaseline();
  const cust  = base.customers[0];
  const cust2 = base.customers[1] ?? cust;

  // Keep only baseline customers — start every other list EMPTY so the teaching
  // Varieties / orders are the only rows in the apps (no random clutter).
  const stockItems      = [];
  const orders          = [];
  const orderLines      = [];
  const deliveries      = [];
  const stockOrders     = [];
  const stockOrderLines = [];
  const stockLosses     = [];
  const stockPurchases  = [];
  const auditLog        = [];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function batch({ display, type, colour, size, cultivar, qty, date, cost = 6, sell = 18, supplier = 'Stojek' }) {
    const row = makeStockItem({
      type: 'batch',
      display_name: display,
      type_name: type, colour: colour ?? null, size_cm: size ?? null, cultivar: cultivar ?? null,
      current_quantity: qty, date,
      current_cost_price: cost, current_sell_price: sell, supplier,
    });
    stockItems.push(row);
    return row;
  }
  function de({ display, type, colour, size, cultivar, qty, date, sell = 0 }) {
    const row = makeStockItem({
      type: 'dated-demand',
      display_name: display,
      type_name: type, colour: colour ?? null, size_cm: size ?? null, cultivar: cultivar ?? null,
      current_quantity: qty, date, current_sell_price: sell,
    });
    stockItems.push(row);
    return row;
  }
  function order({ requiredBy, status = 'New', deliveryType = 'Pickup', customer = cust }) {
    const o = makeOrder({ customerId: customer.id, status, delivery_type: deliveryType, required_by: requiredBy });
    orders.push(o);
    return o;
  }
  function line({ order, stock, qty, name }) {
    const l = makeOrderLine({
      orderId: order.id, stockItemId: stock.id,
      flower_name: name ?? stock.display_name, quantity: qty,
      costSnapshot: stock.current_cost_price, sellSnapshot: stock.current_sell_price,
    });
    orderLines.push(l);
    return l;
  }
  function po({ number, status = 'Sent', driver = 'Nikita', plannedDate = PO_ARRIVE }) {
    const p = {
      id: randomUUID(), po_number: number, status,
      created_date: TODAY, assigned_driver: driver, planned_date: plannedDate,
      notes: '',
    };
    stockOrders.push(p);
    return p;
  }
  function poLine({ po, stock, qty, name, supplier = 'Stojek', cost = 6, sell = 18 }) {
    stockOrderLines.push({
      id: randomUUID(), po_id: po.id, stock_id: stock.id,
      flower_name: name ?? stock.display_name,
      quantity_needed: qty, lot_size: 0, driver_status: 'Pending',
      supplier, cost_price: cost, sell_price: sell, created_at: new Date(),
    });
  }
  function loss({ stock, qty, date, reason = 'Wilted', notes = '' }) {
    const r = makeStockLoss({ stockId: stock.id, quantity: qty, date, reason, notes });
    stockLosses.push(r);
    return r;
  }
  function purchase({ stock, qty, date, cost, supplier = 'Stojek', notes = '' }) {
    const r = makeStockPurchase({ stockId: stock.id, quantity_purchased: qty, purchase_date: date, price_per_unit: cost, supplier, notes });
    stockPurchases.push(r);
    return r;
  }
  function dissolve({ stock, releasedQty, bouquetName, createdAt = DISSOLVE_AT }) {
    const r = makeAuditLog({
      stockId: stock.id, action: 'premade_dissolved', actor_role: 'owner', created_at: createdAt,
      diff: { before: null, after: { qty: releasedQty, bouquet_id: 'lab-dissolve-1', bouquet_name: bouquetName } },
    });
    auditLog.push(r);
    return r;
  }

  // ── 1. Healthy stock, single batch, no demand ──────────────────────────────
  // ARC A: 40 purchased, 20+10 consumed by orders, 6 wilted → 4 remaining.
  const roseRed = batch({
    display: 'Rose Red 50cm Naomi (20.Jun.)',
    type: 'Rose', colour: 'Red', size: 50, cultivar: 'Naomi',
    qty: 4, date: BATCH_RECENT, cost: 5, sell: 18,
  });
  purchase({ stock: roseRed, qty: 40, date: BATCH_RECENT, cost: 5, supplier: 'Stojek', notes: 'PO #PO-ROSE-1 L#1 primary' });
  const ordRoseA = order({ requiredBy: NEED_23 });
  line({ order: ordRoseA, stock: roseRed, qty: 20, name: 'Rose Red 50cm Naomi' });
  const ordRoseB = order({ requiredBy: NEED_25, status: 'Delivered' });
  line({ order: ordRoseB, stock: roseRed, qty: 10, name: 'Rose Red 50cm Naomi' });
  loss({ stock: roseRed, qty: 6, date: TODAY, reason: 'Wilted', notes: 'wilted on the shelf' });

  // ── 2. Multiple batches, one Variety (FEFO drains oldest first) ─────────────
  batch({
    display: 'Rose White 60cm Avalanche (20.Jun.)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 30, date: BATCH_RECENT, cost: 7, sell: 24,
  });
  batch({
    display: 'Rose White 60cm Avalanche (15.Jun.)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 12, date: BATCH_OLD, cost: 7, sell: 24,
  });

  // ── 3. Committed demand against healthy stock (an order eats stock) ─────────
  const tulip = batch({
    display: 'Tulip Yellow 40cm (20.Jun.)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: 50, date: BATCH_RECENT, cost: 3, sell: 11,
  });
  const tulipDE = de({
    display: 'Tulip Yellow 40cm (2026-06-25)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: -8, date: NEED_25, sell: 11,
  });
  const ordTulip = order({ requiredBy: NEED_25, status: 'Ready' });
  line({ order: ordTulip, stock: tulipDE, qty: 8, name: 'Tulip Yellow 40cm' });

  // ── 4. Pure shortfall / negative stock, NO incoming PO (the buy signal) ─────
  const ranDE = de({
    display: 'Ranunculus Orange 40cm (2026-06-30)',
    type: 'Ranunculus', colour: 'Orange', size: 40, cultivar: null,
    qty: -5, date: NEED_30, sell: 16,
  });
  const ordRan = order({ requiredBy: NEED_30 });
  line({ order: ordRan, stock: ranDE, qty: 5, name: 'Ranunculus Orange 40cm' });

  // ── 5. Shortfall COVERED by an incoming PO (effective 0) ────────────────────
  const peony50DE = de({
    display: 'Peony Pink 50cm (2026-06-25)',
    type: 'Peony', colour: 'Pink', size: 50, cultivar: null,
    qty: -7, date: NEED_25, sell: 38,
  });
  const ordPeony50 = order({ requiredBy: NEED_25 });
  line({ order: ordPeony50, stock: peony50DE, qty: 7, name: 'Peony Pink 50cm' });

  // ── 6. Surplus incoming (20 arrive, 12 needed → +8 effective) ───────────────
  const lisiDE = de({
    display: 'Lisianthus White 50cm (2026-06-28)',
    type: 'Lisianthus', colour: 'White', size: 50, cultivar: null,
    qty: -12, date: NEED_28, sell: 14,
  });
  const ordLisi = order({ requiredBy: NEED_28, deliveryType: 'Delivery' });
  line({ order: ordLisi, stock: lisiDE, qty: 12, name: 'Lisianthus White 50cm' });

  // ── 7. Premade reservation ties up physical stock ───────────────────────────
  // ARC B: 28 purchased, 10 damaged in transit → 12 net effective + 6 tied to premade.
  const hydBlue = batch({
    display: 'Hydrangea Blue 30cm (20.Jun.)',
    type: 'Hydrangea', colour: 'Blue', size: 30, cultivar: null,
    qty: 18, date: BATCH_RECENT, cost: 9, sell: 28,
  });
  purchase({ stock: hydBlue, qty: 28, date: BATCH_RECENT, cost: 9, notes: 'PO #PO-HYD-1 L#1 primary' });
  loss({ stock: hydBlue, qty: 10, date: '2026-06-21', reason: 'Damaged', notes: 'crushed in transit' });

  // ── 8. Same Variety, TWO demand dates (06-23 sole + 06-27 summed from 2) ────
  batch({
    display: 'Peony Pink 60cm Sarah Bernhardt (20.Jun.)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: 25, date: BATCH_RECENT, cost: 12, sell: 42,
  });
  const peony60DE13 = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-06-23)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -10, date: NEED_23, sell: 42,
  });
  const peony60DE17 = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-06-27)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -6, date: NEED_27, sell: 42,
  });
  const ordP60a = order({ requiredBy: NEED_23 });
  line({ order: ordP60a, stock: peony60DE13, qty: 10, name: 'Peony Pink 60cm Sarah Bernhardt' });
  // two orders on the SAME needed-by date sum into the one −6 Demand Entry
  const ordP60b = order({ requiredBy: NEED_27, customer: cust2 });
  line({ order: ordP60b, stock: peony60DE17, qty: 4, name: 'Peony Pink 60cm Sarah Bernhardt' });
  const ordP60c = order({ requiredBy: NEED_27 });
  line({ order: ordP60c, stock: peony60DE17, qty: 2, name: 'Peony Pink 60cm Sarah Bernhardt' });

  // ── 9. Attr-less row — half-entered PO line → nameless everywhere (defect) ───
  const attrless = makeStockItem({
    type: 'batch',
    display_name: 'peony',           // free-typed, lowercase
    type_name: null, colour: null, size_cm: null, cultivar: null, date: null,
    current_quantity: 0, current_cost_price: 12, current_sell_price: 20,
    supplier: '4f',
  });
  stockItems.push(attrless);

  // ── 10. Undated legacy aggregate (no date chip → "fuzzy") ───────────────────
  // ARC C: 5 stems written off as old stock; remaining qty 10.
  const gyp = batch({
    display: 'Gypsophila White',
    type: 'Gypsophila', colour: 'White', size: null, cultivar: null,
    qty: 10, date: null, cost: 4, sell: 9,
  });
  loss({ stock: gyp, qty: 5, date: '2026-06-19', reason: 'Overstock', notes: 'old stock cleared' });

  // ── The incoming PO (covers concepts 5, 6, 9) ───────────────────────────────
  // Still SENT (not yet received) → arrival must be in the FUTURE (2026-06-26).
  // Assigned → also visible on the delivery app's shopping run.
  const guidePo = po({ number: 'PO-GUIDE-1', status: 'Sent', driver: 'Nikita', plannedDate: PO_ARRIVE });
  poLine({ po: guidePo, stock: peony50DE, qty: 7,  name: 'Peony Pink 50cm (2026-06-25)',      supplier: 'Stojek', cost: 18, sell: 38 });
  poLine({ po: guidePo, stock: lisiDE,    qty: 20, name: 'Lisianthus White 50cm (2026-06-28)', supplier: 'Stojek', cost: 5,  sell: 14 });
  poLine({ po: guidePo, stock: attrless,  qty: 50, name: 'peony',                              supplier: '4f',     cost: 12, sell: 20 });

  // ── ABSORPTION CASE — Anemone Burgundy 50cm ─────────────────────────────────
  // Post-absorption STATE: DE=0 (zeroed), Batch=7 (received 12 + existing −5 = 7).
  // The lab seeds raw rows — it does NOT run receiveIntoStock; this is the end-state.
  // Realistic timeline (all PAST): a pre-sold demand needed 2026-06-17, then the
  // PO-ABSORB-1 was RECEIVED 2026-06-19 (status Complete → cannot be future-dated).
  // Trace shows the dip-to-negative then PO-recover absorption story.
  const anemDE = de({
    display: 'Anemone Burgundy 50cm (2026-06-17)',
    type: 'Anemone', colour: 'Burgundy', size: 50, cultivar: null,
    qty: 0, date: ABSORB_NEED, sell: 22,
  });
  const ordAnem = order({ requiredBy: ABSORB_NEED, status: 'Picked Up' });
  line({ order: ordAnem, stock: anemDE, qty: 5, name: 'Anemone Burgundy 50cm' });
  const anemBatch = batch({
    display: 'Anemone Burgundy 50cm (19.Jun.)',
    type: 'Anemone', colour: 'Burgundy', size: 50, cultivar: null,
    qty: 7, date: ABSORB_ARRIVE, cost: 8, sell: 22, supplier: 'Stojek',
  });
  purchase({ stock: anemBatch, qty: 12, date: ABSORB_ARRIVE, cost: 8, supplier: 'Stojek', notes: 'PO #PO-ABSORB-1 L#1 primary' });
  const absorbPo = po({ number: 'PO-ABSORB-1', status: 'Complete', driver: 'Nikita', plannedDate: ABSORB_ARRIVE });
  poLine({ po: absorbPo, stock: anemDE, qty: 12, name: 'Anemone Burgundy 50cm (2026-06-17)', supplier: 'Stojek', cost: 8, sell: 22 });

  // ── Premade reservation: "Spring Set" reserves 6 Hydrangea Blue ─────────────
  const bouquets = [
    { id: randomUUID(), name: 'Spring Set', price_override: '139.00' },
  ].map(b => ({ ...b, airtable_id: null, created_by: 'lab', notes: '', created_at: new Date() }));

  const premadeLines = [{
    id: randomUUID(), airtable_id: null, bouquet_id: bouquets[0].id,
    stock_id: hydBlue.id, stock_airtable_id: null,
    flower_name: hydBlue.display_name, quantity: 6,
    cost_price_per_unit: '0', sell_price_per_unit: '0', created_at: new Date(),
  }];

  // ════════════════════════════════════════════════════════════════════════════
  // EDGE-STATE ROWS (#11–#18) — each isolates ONE display state the core 1–10
  // rows don't reach. Added 2026-06-22 after a full UI-state coverage audit.
  // ════════════════════════════════════════════════════════════════════════════

  // ── 11. TIGHT — net lands EXACTLY on 0 with committed demand (amber) ─────────
  // onHand 8 (batch) − planned 8 (DE) = net 0, planned>0 → isTight: amber border,
  // ○ glyph, "tight" label, amber "0" net. No PO → no incoming sub-line to muddy it.
  const astilbe = batch({
    display: 'Astilbe Pink 50cm (20.Jun.)',
    type: 'Astilbe', colour: 'Pink', size: 50, cultivar: null,
    qty: 8, date: BATCH_RECENT, cost: 6, sell: 19,
  });
  purchase({ stock: astilbe, qty: 8, date: BATCH_RECENT, cost: 6, supplier: 'Stojek', notes: 'PO #PO-AST-1 L#1 primary' });
  const astilbeDE = de({
    display: 'Astilbe Pink 50cm (2026-06-25)',
    type: 'Astilbe', colour: 'Pink', size: 50, cultivar: null,
    qty: -8, date: NEED_25, sell: 19,
  });
  const ordAstilbe = order({ requiredBy: NEED_25, status: 'Ready' });
  line({ order: ordAstilbe, stock: astilbeDE, qty: 8, name: 'Astilbe Pink 50cm' });

  // ── 12. OVERDUE incoming PO — still SENT but past due (red overdue chip) ─────
  // Demand needed 06-25 (future). A still-Sent PO planned 06-18 is OVERDUE
  // (planned < today 06-22) yet would still land before the 06-25 demand → covered
  // in-time (no shortfall row), but the incoming chip renders RED. Net −6 (red border).
  const dahliaDE = de({
    display: 'Dahlia Red 60cm (2026-06-25)',
    type: 'Dahlia', colour: 'Red', size: 60, cultivar: null,
    qty: -6, date: NEED_25, sell: 30,
  });
  const ordDahlia = order({ requiredBy: NEED_25 });
  line({ order: ordDahlia, stock: dahliaDE, qty: 6, name: 'Dahlia Red 60cm' });
  const overduePo = po({ number: 'PO-LATE-1', status: 'Sent', driver: 'Nikita', plannedDate: PO_OVERDUE });
  poLine({ po: overduePo, stock: dahliaDE, qty: 6, name: 'Dahlia Red 60cm (2026-06-25)', supplier: 'Stojek', cost: 13, sell: 30 });

  // ── 13. LATE PO — arrives AFTER the demand date (shortfall + amber late badge) ─
  // Demand needed 06-23. A Sent PO planned 06-26 (future, blue chip) arrives AFTER
  // the demand → allocateVarietyCoverage leaves shortQty 6 AND latePoQty 6 → the
  // SHORTFALLS row shows a "+6 late" amber badge (both mobile + dashboard layouts).
  const freesiaDE = de({
    display: 'Freesia Yellow 40cm (2026-06-23)',
    type: 'Freesia', colour: 'Yellow', size: 40, cultivar: null,
    qty: -6, date: NEED_23, sell: 15,
  });
  const ordFreesia = order({ requiredBy: NEED_23 });
  line({ order: ordFreesia, stock: freesiaDE, qty: 6, name: 'Freesia Yellow 40cm' });
  const latePo = po({ number: 'PO-LATE-2', status: 'Sent', driver: 'Nikita', plannedDate: PO_ARRIVE });
  poLine({ po: latePo, stock: freesiaDE, qty: 6, name: 'Freesia Yellow 40cm (2026-06-23)', supplier: 'Stojek', cost: 6, sell: 15 });

  // ── 14. MULTI-TIER — two batches at DIFFERENT sell prices → per-tier label ───
  // Rose White #2 has two batches at the SAME sell (24) so they merge (no label).
  // Carnation's two batches differ (16 vs 14) → multiTier=true → each Batch row
  // prints its own sell price. Net +35 (green), no demand.
  batch({
    display: 'Carnation Red 50cm (20.Jun.)',
    type: 'Carnation', colour: 'Red', size: 50, cultivar: null,
    qty: 20, date: BATCH_RECENT, cost: 5, sell: 16,
  });
  batch({
    display: 'Carnation Red 50cm (15.Jun.)',
    type: 'Carnation', colour: 'Red', size: 50, cultivar: null,
    qty: 15, date: BATCH_OLD, cost: 5, sell: 14,
  });

  // ── 15. COST-ONLY — cost entered but NO sell price → no ×markup badge ────────
  // varietyFinancials needs cost>0 AND sell>0 to show a markup badge. sell 0 → the
  // owner row shows Cost 7.00 / Sell 0.00 with NO ×N.N badge (half-filled flower).
  batch({
    display: 'Statice Purple 40cm (20.Jun.)',
    type: 'Statice', colour: 'Purple', size: 40, cultivar: null,
    qty: 12, date: BATCH_RECENT, cost: 7, sell: 0,
  });

  // ── 16. DRIFT > 0 — recorded inflows exceed on-hand, NO write-off (amber) ────
  // Purchase records +20; one order consumes −6; NO loss logged. Batch on-hand is
  // only 9 (NOT 14). Trace: unaccounted = +20 −6 = 14; onHand 9 → drift = 14 − 9 = 5
  // → the amber "Unaccounted +5 stems" footer FIRES. (List still shows +9 green —
  // drift is a history concern.) Do NOT add a write-off here or the drift collapses.
  const scabiosa = batch({
    display: 'Scabiosa Blue 50cm (20.Jun.)',
    type: 'Scabiosa', colour: 'Blue', size: 50, cultivar: null,
    qty: 9, date: BATCH_RECENT, cost: 6, sell: 17,
  });
  purchase({ stock: scabiosa, qty: 20, date: BATCH_RECENT, cost: 6, supplier: 'Stojek', notes: 'PO #PO-SCAB-1 L#1 primary' });
  const ordScab = order({ requiredBy: NEED_27, status: 'Delivered' });
  line({ order: ordScab, stock: scabiosa, qty: 6, name: 'Scabiosa Blue 50cm' });

  // ── 17. UNDATED — legacy demand + incoming PO with no dates (the '—' chips) ──
  // A DE with date null → expansion demand row shows no date; a Sent PO with no
  // planned_date → the incoming/arriving DateTag renders '—'. Net −4 (red border).
  const asterDE = de({
    display: 'Aster White 50cm (undated)',
    type: 'Aster', colour: 'White', size: 50, cultivar: null,
    qty: -4, date: null, sell: 13,
  });
  const ordAster = order({ requiredBy: NEED_28 });
  line({ order: ordAster, stock: asterDE, qty: 4, name: 'Aster White 50cm' });
  const undatedPo = po({ number: 'PO-UNDATED-1', status: 'Sent', driver: 'Nikita', plannedDate: null });
  poLine({ po: undatedPo, stock: asterDE, qty: 4, name: 'Aster White 50cm (undated)', supplier: 'Stojek', cost: 5, sell: 13 });

  // ── 18. DISSOLVE event — a premade was dissolved, releasing stems (trace) ────
  // The 5th trace event type. Dissolving a premade CASCADE-deletes its lines; the
  // audit_log row is the only surviving record (qty=0 marker, releasedQty in diff).
  // Eucalyptus: purchase +15, then "Winter Wreath" dissolved 06-21 releasing 5 →
  // trace shows a purple dissolve row + gray sparkline marker. onHand 15, drift 0.
  const eucalyptus = batch({
    display: 'Eucalyptus Green 50cm (20.Jun.)',
    type: 'Eucalyptus', colour: 'Green', size: 50, cultivar: null,
    qty: 15, date: BATCH_RECENT, cost: 4, sell: 12,
  });
  purchase({ stock: eucalyptus, qty: 15, date: BATCH_RECENT, cost: 4, supplier: 'Stojek', notes: 'PO #PO-EUC-1 L#1 primary' });
  dissolve({ stock: eucalyptus, releasedQty: 5, bouquetName: 'Winter Wreath' });

  return {
    customers: base.customers,
    stockItems,
    stockLosses,
    stockPurchases,
    auditLog,
    stockOrders,
    stockOrderLines,
    orders,
    orderLines,
    deliveries,
    premadeBouquets: bouquets,
    premadeBouquetLines: premadeLines,
  };
}
