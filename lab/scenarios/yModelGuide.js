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
import { makeStockItem, makeOrder, makeOrderLine, makeDelivery } from '../factories/index.js';
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
      // CR-14: demand entries have no cost basis; pin to 0 so faker doesn't inject a phantom cost.
      current_cost_price: 0,
    });
    stockItems.push(row);
    return row;
  }
  function order({ requiredBy, status = 'New', deliveryType = 'Pickup', customer = cust, extra = {} }) {
    const o = makeOrder({ customerId: customer.id, status, delivery_type: deliveryType, required_by: requiredBy, ...extra });
    orders.push(o);
    return o;
  }
  function delivery({ order: ord, status = 'Pending', fee = 25, driver = 'Nikita', deliveredAt = null, date = TODAY }) {
    const d = makeDelivery({
      orderId: ord.id, status, delivery_fee: fee,
      assigned_driver: driver, delivered_at: deliveredAt, delivery_date: date,
    });
    deliveries.push(d);
    return d;
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
  function poLine({ po, stock, qty, name, supplier = 'Stojek', cost = 6, sell = 18, ...extra }) {
    stockOrderLines.push({
      id: randomUUID(),
      po_id: po.id,
      stock_id: stock ? stock.id : null,
      flower_name: name ?? (stock ? stock.display_name : ''),
      quantity_needed: qty,
      quantity_found: 0,
      lot_size: 0,
      driver_status: 'Pending',
      supplier,
      cost_price: cost,
      sell_price: sell,
      farmer: '',
      notes: '',
      substitute_flower_name: '',
      substitute_status: '',
      substitute_quantity_found: 0,
      substitute_cost: 0,
      substitute_supplier: '',
      quantity_accepted: 0,
      write_off_qty: 0,
      eval_status: '',
      type_name: null,
      colour: null,
      size_cm: null,
      cultivar: null,
      created_at: new Date(),
      ...extra,
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

  // ════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE + PAYMENT + DEEP-HISTORY ROWS (#19–#27) — added 2026-06-22.
  // ════════════════════════════════════════════════════════════════════════════

  // ── 19. PO LIFECYCLE — five remaining statuses (Draft/Shopping/Reviewing/Evaluating/Eval Error)
  // The guide already has Sent (PO-GUIDE-1) and Complete (PO-ABSORB-1).
  // Each PO demonstrates a distinct driver_status + eval_status variant.

  // 19a — Draft PO: one blank-ish line (quantity_found=0, driver_status Pending)
  const draftPo = po({ number: 'PO-DRAFT-1', status: 'Draft', driver: 'Nikita', plannedDate: null });
  poLine({ po: draftPo, stock: null, qty: 10, name: 'Hydrangea White 30cm', supplier: 'Stojek', cost: 8, sell: 0,
    notes: 'PO #PO-DRAFT-1 L#1' });

  // 19b — Shopping PO: FoundAll line + Partial line
  const shopPo = po({ number: 'PO-SHOP-1', status: 'Shopping', driver: 'Nikita', plannedDate: TODAY });
  poLine({ po: shopPo, stock: tulip, qty: 20, name: 'Tulip Yellow 40cm', supplier: 'Stojek', cost: 3, sell: 11,
    quantity_found: 20, driver_status: 'Found All', notes: 'PO #PO-SHOP-1 L#1' });
  poLine({ po: shopPo, stock: null, qty: 15, name: 'Rose Red 50cm Naomi', supplier: 'Stojek', cost: 5, sell: 18,
    quantity_found: 9, driver_status: 'Partial', notes: 'PO #PO-SHOP-1 L#2' });

  // 19c — Reviewing PO: FoundAll + Partial-with-substitute + NotFound-with-substitute
  const reviewPo = po({ number: 'PO-REVIEW-1', status: 'Reviewing', driver: 'Nikita', plannedDate: TODAY });
  // Line 1: FoundAll
  poLine({ po: reviewPo, stock: astilbe, qty: 8, name: 'Astilbe Pink 50cm', supplier: 'Stojek', cost: 6, sell: 19,
    quantity_found: 8, driver_status: 'Found All', notes: 'PO #PO-REVIEW-1 L#1' });
  // Line 2: Partial + substitute
  poLine({ po: reviewPo, stock: hydBlue, qty: 12, name: 'Hydrangea Blue 30cm', supplier: 'Stojek', cost: 9, sell: 28,
    quantity_found: 7, driver_status: 'Partial',
    substitute_flower_name: 'Peony White 50cm', substitute_status: 'Pending',
    substitute_quantity_found: 5, substitute_cost: 60, substitute_supplier: 'Stojek',
    notes: 'PO #PO-REVIEW-1 L#2' });
  // Line 3: NotFound + substitute
  poLine({ po: reviewPo, stock: null, qty: 6, name: 'Freesia Purple 40cm', supplier: '4f', cost: 5, sell: 14,
    quantity_found: 0, driver_status: 'Not Found',
    substitute_flower_name: 'Ranunculus', substitute_status: 'Pending',
    substitute_quantity_found: 10, substitute_cost: 80, substitute_supplier: '4f',
    notes: 'PO #PO-REVIEW-1 L#3' });

  // 19d — Evaluating PO: FoundAll + Partial
  const evalPo = po({ number: 'PO-EVAL-1', status: 'Evaluating', driver: 'Nikita', plannedDate: BATCH_RECENT });
  poLine({ po: evalPo, stock: scabiosa, qty: 20, name: 'Scabiosa Blue 50cm', supplier: 'Stojek', cost: 6, sell: 17,
    quantity_found: 20, driver_status: 'Found All', notes: 'PO #PO-EVAL-1 L#1' });
  poLine({ po: evalPo, stock: null, qty: 10, name: 'Carnation Pink 40cm', supplier: 'Stojek', cost: 4, sell: 12,
    quantity_found: 6, driver_status: 'Partial', notes: 'PO #PO-EVAL-1 L#2' });

  // 19e — Eval Error PO: one Processed + purchase, one Partial acc=0
  // The Processed line represents a stem accepted into stock; the Partial is the "error" case.
  const evalErrStock = batch({
    display: 'Gerbera Yellow 40cm (19.Jun.)',
    type: 'Gerbera', colour: 'Yellow', size: 40, cultivar: null,
    qty: 18, date: ABSORB_ARRIVE, cost: 5, sell: 14,
  });
  const errPo = po({ number: 'PO-ERR-1', status: 'Eval Error', driver: 'Nikita', plannedDate: ABSORB_ARRIVE });
  poLine({ po: errPo, stock: evalErrStock, qty: 18, name: 'Gerbera Yellow 40cm', supplier: 'Stojek', cost: 5, sell: 14,
    quantity_found: 18, quantity_accepted: 18, driver_status: 'Found All', eval_status: 'Processed',
    notes: 'PO #PO-ERR-1 L#1' });
  purchase({ stock: evalErrStock, qty: 18, date: ABSORB_ARRIVE, cost: 5, supplier: 'Stojek',
    notes: 'PO #PO-ERR-1 L#1 primary' });
  poLine({ po: errPo, stock: null, qty: 12, name: 'Gerbera Pink 40cm', supplier: 'Stojek', cost: 5, sell: 13,
    quantity_found: 8, quantity_accepted: 0, driver_status: 'Partial', eval_status: '',
    notes: 'PO #PO-ERR-1 L#2' });

  // ── 21–23. DELIVERY STATUSES — Out for Delivery / Delivered / Pending ────────
  // Reuse the existing Rose White 60cm Avalanche batches for the order lines.
  // The existing ordLisi (concept #6, Lisianthus) is a 'Delivery' order WITH NO linked
  // delivery — we use that as the deliberate "unlinked" case per the spec.
  // We create new orders for the delivery-status concepts.

  // Find the Rose White 60cm batch (BATCH_RECENT) to use as the line stock.
  // It was pushed to stockItems as item #2 (after roseRed), no variable captured — create a new batch.
  const roseWhite60 = batch({
    display: 'Rose White 60cm Avalanche (delivery-demo)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 30, date: BATCH_RECENT, cost: 7, sell: 24,
  });

  // 21 — Out for Delivery order with linked delivery
  const ordOutDelivery = order({ requiredBy: TODAY, status: 'Out for Delivery', deliveryType: 'Delivery' });
  line({ order: ordOutDelivery, stock: roseWhite60, qty: 6, name: 'Rose White 60cm Avalanche' });
  delivery({ order: ordOutDelivery, status: 'Out for Delivery', fee: 30 });

  // 22 — Delivered order with linked delivery (with timestamp)
  const ordDelivered = order({ requiredBy: TODAY, status: 'Delivered', deliveryType: 'Delivery' });
  line({ order: ordDelivered, stock: roseWhite60, qty: 4, name: 'Rose White 60cm Avalanche' });
  delivery({ order: ordDelivered, status: 'Delivered', fee: 25, deliveredAt: '2026-06-22T11:30:00Z' });

  // 23 — Pending delivery linked to a new Delivery order (ordLisi has no delivery — it's the "unlinked" case)
  const ordPendingDelivery = order({ requiredBy: NEED_25, status: 'Ready', deliveryType: 'Delivery' });
  line({ order: ordPendingDelivery, stock: roseWhite60, qty: 5, name: 'Rose White 60cm Avalanche' });
  delivery({ order: ordPendingDelivery, status: 'Pending', fee: 20 });
  // ordLisi (concept #6) has no delivery linked — deliberate "unlinked" demonstration.

  // ── 24–26. PAYMENT STATES + CANCELLED ORDER ───────────────────────────────────

  // 24 — Fully Paid order (green badge, Card, price_override 120)
  const ordPaid = order({ requiredBy: NEED_25, deliveryType: 'Pickup',
    extra: { payment_status: 'Paid', payment_method: 'Card', price_override: '120.00' } });
  line({ order: ordPaid, stock: tulip, qty: 5, name: 'Tulip Yellow 40cm' });

  // 25 — Partial payment (amber badge, 50 Cash upfront on 130 total)
  const ordPartial = order({ requiredBy: NEED_27, deliveryType: 'Pickup',
    extra: { payment_status: 'Partial', payment_1_amount: '50.00', payment_1_method: 'Cash', price_override: '130.00' } });
  line({ order: ordPartial, stock: scabiosa, qty: 6, name: 'Scabiosa Blue 50cm' });

  // 26 — Cancelled order + Cancelled delivery (Marigold Orange 40cm — new variety)
  // ARC: purchase 12, order consumes 4, drift-check: 12−4 = 8 = onHand (correct)
  const marigold = batch({
    display: 'Marigold Orange 40cm (15.Jun.)',
    type: 'Marigold', colour: 'Orange', size: 40, cultivar: null,
    qty: 8, date: BATCH_OLD, cost: 3, sell: 10,
  });
  purchase({ stock: marigold, qty: 12, date: BATCH_OLD, cost: 3, supplier: 'Stojek',
    notes: 'PO #PO-MARI-1 L#1 primary' });
  const ordCancelled = order({ requiredBy: '2026-06-19', status: 'Cancelled', deliveryType: 'Delivery' });
  line({ order: ordCancelled, stock: marigold, qty: 4, name: 'Marigold Orange 40cm' });
  delivery({ order: ordCancelled, status: 'Cancelled', fee: 20 });

  // ── 27. DEEP-HISTORY Tulip Red 50cm Strong Love (rich trace for CR-18) ────────
  // Two batches, two complete POs, two write-offs, multiple orders, crosses zero twice.
  // Drift-check: batch1 = 40 in, 12+10+9 out, 8 loss = 1 remaining.
  //              batch2 = 20 in, 6 out, 3 loss = 11 remaining. Total on-hand = 12.
  const TR_NEED_04 = '2026-06-04';
  const TR_NEED_08 = '2026-06-08';
  const TR_NEED_15 = '2026-06-15';
  const TR_NEED_23B = '2026-06-23';

  const tulipRed1 = batch({
    display: 'Tulip Red 50cm Strong Love (01.Jun.)',
    type: 'Tulip', colour: 'Red', size: 50, cultivar: 'Strong Love',
    qty: 1, date: '2026-06-01', cost: 4, sell: 15, supplier: 'Stojek',
  });
  purchase({ stock: tulipRed1, qty: 40, date: '2026-06-01', cost: 4, supplier: 'Stojek',
    notes: 'PO #PO-TULRED-1 L#1 primary' });

  const poTulRed1 = po({ number: 'PO-TULRED-1', status: 'Complete', driver: 'Nikita', plannedDate: '2026-06-01' });
  poLine({ po: poTulRed1, stock: tulipRed1, qty: 40, name: 'Tulip Red 50cm Strong Love', supplier: 'Stojek', cost: 4, sell: 15,
    quantity_found: 40, quantity_accepted: 40, driver_status: 'Found All', eval_status: 'Processed',
    notes: 'PO #PO-TULRED-1 L#1' });

  // Orders consuming tulipRed1
  const ordTulRed1a = order({ requiredBy: TR_NEED_04, status: 'Delivered', deliveryType: 'Pickup' });
  line({ order: ordTulRed1a, stock: tulipRed1, qty: 12, name: 'Tulip Red 50cm Strong Love' });
  const ordTulRed1b = order({ requiredBy: TR_NEED_08, status: 'Picked Up', deliveryType: 'Pickup' });
  line({ order: ordTulRed1b, stock: tulipRed1, qty: 10, name: 'Tulip Red 50cm Strong Love' });

  // Write-off #1
  loss({ stock: tulipRed1, qty: 8, date: '2026-06-12', reason: 'Wilted', notes: 'first batch wilted' });

  // DE for the trough (batch1 dips near zero; order via DE)
  const tulipRedDE = de({
    display: 'Tulip Red 50cm Strong Love (2026-06-15)',
    type: 'Tulip', colour: 'Red', size: 50, cultivar: 'Strong Love',
    qty: -9, date: TR_NEED_15, sell: 15,
  });
  const ordTulRed1c = order({ requiredBy: TR_NEED_15, status: 'Picked Up', deliveryType: 'Pickup' });
  line({ order: ordTulRed1c, stock: tulipRedDE, qty: 9, name: 'Tulip Red 50cm Strong Love' });

  // Second batch arrives
  const tulipRed2 = batch({
    display: 'Tulip Red 50cm Strong Love (18.Jun.)',
    type: 'Tulip', colour: 'Red', size: 50, cultivar: 'Strong Love',
    qty: 11, date: '2026-06-18', cost: 4, sell: 15, supplier: '4f',
  });
  purchase({ stock: tulipRed2, qty: 20, date: '2026-06-18', cost: 4, supplier: '4f',
    notes: 'PO #PO-TULRED-2 L#1 primary' });

  const poTulRed2 = po({ number: 'PO-TULRED-2', status: 'Complete', driver: 'Nikita', plannedDate: '2026-06-18' });
  poLine({ po: poTulRed2, stock: tulipRed2, qty: 20, name: 'Tulip Red 50cm Strong Love', supplier: '4f', cost: 4, sell: 15,
    quantity_found: 20, quantity_accepted: 20, driver_status: 'Found All', eval_status: 'Processed',
    notes: 'PO #PO-TULRED-2 L#1' });

  // Write-off #2
  loss({ stock: tulipRed2, qty: 3, date: '2026-06-21', reason: 'Damaged', notes: 'second batch corner damage' });

  // Future order from batch2
  const ordTulRed2a = order({ requiredBy: TR_NEED_23B, status: 'Ready', deliveryType: 'Pickup' });
  line({ order: ordTulRed2a, stock: tulipRed2, qty: 6, name: 'Tulip Red 50cm Strong Love' });

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
