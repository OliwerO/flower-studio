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
//
// Anchored around the lab clock (~2026-06-12): batches arrived in the recent
// past, demands are needed in the near future, the PO arrives 2026-06-16.

import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';
import { makeStockLoss } from '../factories/stockLoss.js';
import { makeStockPurchase } from '../factories/stockPurchase.js';

const TODAY        = '2026-06-12';
const BATCH_RECENT = '2026-06-10';
const BATCH_OLD    = '2026-06-05';
const NEED_13      = '2026-06-13';
const NEED_15      = '2026-06-15';
const NEED_17      = '2026-06-17';
const NEED_18      = '2026-06-18';
const NEED_20      = '2026-06-20';
const PO_ARRIVE    = '2026-06-16';

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

  // ── 1. Healthy stock, single batch, no demand ──────────────────────────────
  // ARC A: 40 purchased, 20+10 consumed by orders, 6 wilted → 4 remaining.
  const roseRed = batch({
    display: 'Rose Red 50cm Naomi (10.Jun.)',
    type: 'Rose', colour: 'Red', size: 50, cultivar: 'Naomi',
    qty: 4, date: BATCH_RECENT, cost: 5, sell: 18,
  });
  purchase({ stock: roseRed, qty: 40, date: BATCH_RECENT, cost: 5, supplier: 'Stojek', notes: 'PO #PO-ROSE-1 L#1 primary' });
  const ordRoseA = order({ requiredBy: NEED_13 });
  line({ order: ordRoseA, stock: roseRed, qty: 20, name: 'Rose Red 50cm Naomi' });
  const ordRoseB = order({ requiredBy: NEED_15, status: 'Delivered' });
  line({ order: ordRoseB, stock: roseRed, qty: 10, name: 'Rose Red 50cm Naomi' });
  loss({ stock: roseRed, qty: 6, date: TODAY, reason: 'Wilted', notes: 'wilted on the shelf' });

  // ── 2. Multiple batches, one Variety (FEFO drains oldest first) ─────────────
  batch({
    display: 'Rose White 60cm Avalanche (10.Jun.)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 30, date: BATCH_RECENT, cost: 7, sell: 24,
  });
  batch({
    display: 'Rose White 60cm Avalanche (05.Jun.)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 12, date: BATCH_OLD, cost: 7, sell: 24,
  });

  // ── 3. Committed demand against healthy stock (an order eats stock) ─────────
  const tulip = batch({
    display: 'Tulip Yellow 40cm (10.Jun.)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: 50, date: BATCH_RECENT, cost: 3, sell: 11,
  });
  const tulipDE = de({
    display: 'Tulip Yellow 40cm (2026-06-15)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: -8, date: NEED_15, sell: 11,
  });
  const ordTulip = order({ requiredBy: NEED_15, status: 'Ready' });
  line({ order: ordTulip, stock: tulipDE, qty: 8, name: 'Tulip Yellow 40cm' });

  // ── 4. Pure shortfall / negative stock, NO incoming PO (the buy signal) ─────
  const ranDE = de({
    display: 'Ranunculus Orange 40cm (2026-06-20)',
    type: 'Ranunculus', colour: 'Orange', size: 40, cultivar: null,
    qty: -5, date: NEED_20, sell: 16,
  });
  const ordRan = order({ requiredBy: NEED_20 });
  line({ order: ordRan, stock: ranDE, qty: 5, name: 'Ranunculus Orange 40cm' });

  // ── 5. Shortfall COVERED by an incoming PO (effective 0) ────────────────────
  const peony50DE = de({
    display: 'Peony Pink 50cm (2026-06-15)',
    type: 'Peony', colour: 'Pink', size: 50, cultivar: null,
    qty: -7, date: NEED_15, sell: 38,
  });
  const ordPeony50 = order({ requiredBy: NEED_15 });
  line({ order: ordPeony50, stock: peony50DE, qty: 7, name: 'Peony Pink 50cm' });

  // ── 6. Surplus incoming (20 arrive, 12 needed → +8 effective) ───────────────
  const lisiDE = de({
    display: 'Lisianthus White 50cm (2026-06-18)',
    type: 'Lisianthus', colour: 'White', size: 50, cultivar: null,
    qty: -12, date: NEED_18, sell: 14,
  });
  const ordLisi = order({ requiredBy: NEED_18, deliveryType: 'Delivery' });
  line({ order: ordLisi, stock: lisiDE, qty: 12, name: 'Lisianthus White 50cm' });

  // ── 7. Premade reservation ties up physical stock ───────────────────────────
  // ARC B: 28 purchased, 10 damaged in transit → 12 net effective + 6 tied to premade.
  const hydBlue = batch({
    display: 'Hydrangea Blue 30cm (10.Jun.)',
    type: 'Hydrangea', colour: 'Blue', size: 30, cultivar: null,
    qty: 12, date: BATCH_RECENT, cost: 9, sell: 28,
  });
  purchase({ stock: hydBlue, qty: 28, date: BATCH_RECENT, cost: 9, notes: 'PO #PO-HYD-1 L#1 primary' });
  loss({ stock: hydBlue, qty: 10, date: '2026-06-11', reason: 'Damaged', notes: 'crushed in transit' });

  // ── 8. Same Variety, TWO demand dates (06-13 sole + 06-17 summed from 2) ────
  batch({
    display: 'Peony Pink 60cm Sarah Bernhardt (10.Jun.)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: 25, date: BATCH_RECENT, cost: 12, sell: 42,
  });
  const peony60DE13 = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-06-13)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -10, date: NEED_13, sell: 42,
  });
  const peony60DE17 = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-06-17)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -6, date: NEED_17, sell: 42,
  });
  const ordP60a = order({ requiredBy: NEED_13 });
  line({ order: ordP60a, stock: peony60DE13, qty: 10, name: 'Peony Pink 60cm Sarah Bernhardt' });
  // two orders on the SAME needed-by date sum into the one −6 Demand Entry
  const ordP60b = order({ requiredBy: NEED_17, customer: cust2 });
  line({ order: ordP60b, stock: peony60DE17, qty: 4, name: 'Peony Pink 60cm Sarah Bernhardt' });
  const ordP60c = order({ requiredBy: NEED_17 });
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
  loss({ stock: gyp, qty: 5, date: '2026-06-09', reason: 'Overstock', notes: 'old stock cleared' });

  // ── The incoming PO (covers concepts 5, 6, 9) ───────────────────────────────
  // Sent + assigned → also visible on the delivery app's shopping run.
  const guidePo = po({ number: 'PO-GUIDE-1', status: 'Sent', driver: 'Nikita', plannedDate: PO_ARRIVE });
  poLine({ po: guidePo, stock: peony50DE, qty: 7,  name: 'Peony Pink 50cm (2026-06-15)',      supplier: 'Stojek', cost: 18, sell: 38 });
  poLine({ po: guidePo, stock: lisiDE,    qty: 20, name: 'Lisianthus White 50cm (2026-06-18)', supplier: 'Stojek', cost: 5,  sell: 14 });
  poLine({ po: guidePo, stock: attrless,  qty: 50, name: 'peony',                              supplier: '4f',     cost: 12, sell: 20 });

  // ── ABSORPTION CASE — Anemone Burgundy 50cm ─────────────────────────────────
  // Post-absorption STATE: DE=0 (zeroed), Batch=7 (received 12 + existing −5 = 7).
  // The lab seeds raw rows — it does NOT run receiveIntoStock; this is the end-state.
  const anemDE = de({
    display: 'Anemone Burgundy 50cm (2026-06-14)',
    type: 'Anemone', colour: 'Burgundy', size: 50, cultivar: null,
    qty: 0, date: '2026-06-14', sell: 22,
  });
  const ordAnem = order({ requiredBy: '2026-06-14', status: 'Ready' });
  line({ order: ordAnem, stock: anemDE, qty: 5, name: 'Anemone Burgundy 50cm' });
  const anemBatch = batch({
    display: 'Anemone Burgundy 50cm (16.Jun.)',
    type: 'Anemone', colour: 'Burgundy', size: 50, cultivar: null,
    qty: 7, date: PO_ARRIVE, cost: 8, sell: 22, supplier: 'Stojek',
  });
  purchase({ stock: anemBatch, qty: 12, date: PO_ARRIVE, cost: 8, supplier: 'Stojek', notes: 'PO #PO-ABSORB-1 L#1 primary' });
  const absorbPo = po({ number: 'PO-ABSORB-1', status: 'Complete', driver: 'Nikita', plannedDate: PO_ARRIVE });
  poLine({ po: absorbPo, stock: anemDE, qty: 12, name: 'Anemone Burgundy 50cm (2026-06-14)', supplier: 'Stojek', cost: 8, sell: 22 });

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

  return {
    customers: base.customers,
    stockItems,
    stockLosses,
    stockPurchases,
    stockOrders,
    stockOrderLines,
    orders,
    orderLines,
    deliveries,
    premadeBouquets: bouquets,
    premadeBouquetLines: premadeLines,
  };
}
