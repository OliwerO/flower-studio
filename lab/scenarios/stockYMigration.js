// lab/scenarios/stockYMigration.js
//
// Fixture for the Stock Y-model migration script regression gate
// (issue #290). Extends stockOverhaul with prod-shaped fixtures and
// guarantees every stock row has `type_name` set (post-#292 state).
//
// The unique index stock_demand_variety_date_idx enforces at-most-one
// DE per (type_name, colour, size_cm, cultivar, date). Legacy aggregate
// DEs (date=NULL, qty<0) fall under this when type_name is set — so we
// deduplicate demand entries by summing quantities into one per variety,
// matching the ADR-0002 "one aggregate per variety" invariant.

import { faker } from '@faker-js/faker';
import { buildStockOverhaul } from './stockOverhaul.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

export function buildStockYMigration() {
  faker.seed(290);
  const base = buildStockOverhaul();

  // Separate batch rows (qty >= 0) from demand entries (qty < 0).
  // For batch rows: assign type_name from display_name if missing.
  // For demand entries: deduplicate by variety name (ADR-0002: one aggregate per variety).
  const batchRows = base.stockItems.filter(s => s.current_quantity >= 0);
  const demandRows = base.stockItems.filter(s => s.current_quantity < 0);

  // Backfill type_name on batch rows — each batch has a unique display_name
  // (includes date suffix) so no duplicate constraint issues.
  const backedBatches = batchRows.map(s => ({
    ...s,
    type_name: s.type_name ?? (s.display_name.split(' ')[0] || 'Unknown'),
  }));

  // Deduplicate demand entries: keep first occurrence per variety name
  // and sum quantities, then assign type_name. This matches ADR-0002's
  // "at most one aggregate DE per variety" invariant.
  // Also build an id-remap so order lines pointing to removed duplicates
  // are updated to point to the surviving row.
  const seenVariety = new Map(); // varietyKey → surviving stock row
  const idRemap = new Map();     // removed id → surviving id
  for (const s of demandRows) {
    const varietyKey = s.display_name; // demand entries use variety name as display_name
    if (seenVariety.has(varietyKey)) {
      // Sum the quantities into the surviving occurrence (both are negative).
      seenVariety.get(varietyKey).current_quantity += s.current_quantity;
      idRemap.set(s.id, seenVariety.get(varietyKey).id);
    } else {
      seenVariety.set(varietyKey, { ...s });
    }
  }
  const deduplicatedDemands = Array.from(seenVariety.values()).map(s => ({
    ...s,
    type_name: s.type_name ?? (s.display_name.split(' ')[0] || 'Unknown'),
  }));

  // Remap order lines that pointed to removed duplicate demand entries.
  const orderLines = base.orderLines.map(ol =>
    idRemap.has(ol.stock_item_id)
      ? { ...ol, stock_item_id: idRemap.get(ol.stock_item_id) }
      : ol
  );

  const stockItems = [...backedBatches, ...deduplicatedDemands];

  // ── Phase 1 fixture: 1 aggregate DE shared by 2 orders on 2 different dates ──
  // Simulates a "Peony Pink 60cm" aggregate DE with qty=-8 and no date,
  // linked to two Pickup orders with distinct Required By dates.
  // The script must split this into two dated DEs (-5 and -3) and repoint
  // the order_lines to the correct dated DE.
  const PHASE1_DATE_A = '2026-06-01';
  const PHASE1_DATE_B = '2026-06-03';

  const aggDE = makeStockItem({
    type:             'demand',
    display_name:     'Peony Pink 60cm',
    type_name:        'Peony',
    colour:           'Pink',
    size_cm:          60,
    current_quantity: -8,
    date:             null,
  });
  stockItems.push(aggDE);

  // ── Phase 2 fixture: orphan negative DE with no linked order_lines ──
  // Simulates a "Tulip Yellow 40cm" aggregate DE with qty=-4, no date,
  // and no order_lines. The script must date it to today (migration day)
  // while preserving variety attributes and qty.
  const orphanDE = makeStockItem({
    type:             'demand',
    display_name:     'Tulip Yellow 40cm',
    type_name:        'Tulip',
    colour:           'Yellow',
    size_cm:          40,
    current_quantity: -4,
    date:             null,
  });
  stockItems.push(orphanDE);

  const cust = base.customers[0];
  const orderA = makeOrder({ customerId: cust.id, status: 'New', delivery_type: 'Pickup', required_by: PHASE1_DATE_A });
  const orderB = makeOrder({ customerId: cust.id, status: 'New', delivery_type: 'Pickup', required_by: PHASE1_DATE_B });
  const lineA  = makeOrderLine({ orderId: orderA.id, stockItemId: aggDE.id, flower_name: aggDE.display_name, quantity: 5 });
  const lineB  = makeOrderLine({ orderId: orderB.id, stockItemId: aggDE.id, flower_name: aggDE.display_name, quantity: 3 });

  return {
    customers:  base.customers,
    stockItems,
    orders:     [...base.orders, orderA, orderB],
    orderLines: [...orderLines, lineA, lineB],
    deliveries: base.deliveries,
  };
}
