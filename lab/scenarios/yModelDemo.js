// lab/scenarios/yModelDemo.js
//
// Rich Y-model demo fixture for local UI testing. Designed to surface every
// Y-model UI surface: Variety collapsed list with multiple cultivars per Type,
// dated Demand Entries crossing dates, premade reservations, mixed shortfall +
// healthy stock, active orders driving Planned bucket.
//
// Use:
//   npm run lab:template:rebuild -- --scenario=y-model-demo
//   npm run lab:reset
//
// Every stock row carries type_name (post-#292 backfill state), so the Y-model
// flag-on path renders all rows.

import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

// Absolute dates anchored around 2026-05-11 so the Required By cascades + dated
// DEs render in a meaningful range. Adjust if the lab clock drifts far away.
const TODAY     = '2026-05-11';
const TOMORROW  = '2026-05-12';
const D2        = '2026-05-13';
const D5        = '2026-05-16';
const D7        = '2026-05-18';
const D14       = '2026-05-25';

const BATCH_NEW = '2026-05-10';
const BATCH_MID = '2026-05-07';
const BATCH_OLD = '2026-05-04';

export function buildYModelDemo() {
  faker.seed(2026);
  const base = buildBaseline();
  const cust = base.customers[0];
  const cust2 = base.customers[1] ?? cust;

  // Strip any baseline stock that lacks Variety attrs — keeps the Y-model list
  // focused on the curated fixtures below. (Baseline ships ~80 random rows.)
  const stockItems = [];
  const orders     = [...base.orders];
  const orderLines = [...base.orderLines];
  const deliveries = [...base.deliveries];

  // Helpers ────────────────────────────────────────────────────────────────
  function batch({ display, type, colour, size, cultivar, qty, date, cost = 6, sell = 18 }) {
    return makeStockItem({
      type: 'batch',
      display_name: display,
      type_name:    type,
      colour:       colour ?? null,
      size_cm:      size ?? null,
      cultivar:     cultivar ?? null,
      current_quantity: qty,
      date,
      current_cost_price: cost,
      current_sell_price: sell,
      supplier: faker.helpers.arrayElement(['Stojek', '4f', 'Stefan', 'Direct']),
    });
  }
  function de({ display, type, colour, size, cultivar, qty, date }) {
    return makeStockItem({
      type: 'dated-demand',
      display_name: display,
      type_name:    type,
      colour:       colour ?? null,
      size_cm:      size ?? null,
      cultivar:     cultivar ?? null,
      current_quantity: qty, // negative
      date,
    });
  }
  function order({ requiredBy, status = 'New', deliveryType = 'Pickup', customer = cust }) {
    const o = makeOrder({
      customerId: customer.id, status, delivery_type: deliveryType, required_by: requiredBy,
    });
    orders.push(o);
    return o;
  }
  function line({ order, stock, qty, name }) {
    const l = makeOrderLine({
      orderId: order.id,
      stockItemId: stock.id,
      flower_name: name ?? stock.display_name,
      quantity: qty,
      costSnapshot: stock.current_cost_price,
      sellSnapshot: stock.current_sell_price,
    });
    orderLines.push(l);
    return l;
  }

  // 1. Peony Pink 60cm Sarah Bernhardt — 2 Batches + 3 orders spanning 3 dates
  const peonyA1 = batch({
    display: 'Peony Pink 60cm Sarah Bernhardt (10.May.)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: 25, date: BATCH_NEW, cost: 12, sell: 42,
  });
  const peonyA2 = batch({
    display: 'Peony Pink 60cm Sarah Bernhardt (07.May.)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: 8, date: BATCH_MID, cost: 11, sell: 42,
  });
  const peonyA_DE_today = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-05-12)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -10, date: TOMORROW,
  });
  const peonyA_DE_d5 = de({
    display: 'Peony Pink 60cm Sarah Bernhardt (2026-05-16)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Sarah Bernhardt',
    qty: -6, date: D5,
  });
  stockItems.push(peonyA1, peonyA2, peonyA_DE_today, peonyA_DE_d5);

  const ordPeonyTomorrow = order({ requiredBy: TOMORROW, customer: cust });
  line({ order: ordPeonyTomorrow, stock: peonyA_DE_today, qty: 10, name: 'Peony Pink 60cm Sarah Bernhardt' });

  const ordPeonyD5a = order({ requiredBy: D5, customer: cust2 });
  line({ order: ordPeonyD5a, stock: peonyA_DE_d5, qty: 4 });
  const ordPeonyD5b = order({ requiredBy: D5, customer: cust });
  line({ order: ordPeonyD5b, stock: peonyA_DE_d5, qty: 2 });

  // 2. Peony Pink 60cm Coral Charm — distinct cultivar; healthy, no orders
  stockItems.push(batch({
    display: 'Peony Pink 60cm Coral Charm (10.May.)',
    type: 'Peony', colour: 'Pink', size: 60, cultivar: 'Coral Charm',
    qty: 18, date: BATCH_NEW, cost: 13, sell: 44,
  }));

  // 3. Peony Pink 50cm — no cultivar; pure shortfall (only DE)
  stockItems.push(de({
    display: 'Peony Pink 50cm (2026-05-13)',
    type: 'Peony', colour: 'Pink', size: 50, cultivar: null,
    qty: -7, date: D2,
  }));

  // 4. Rose Red 50cm Naomi — 3 Batches across dates, healthy stock
  const roseRedA = batch({
    display: 'Rose Red 50cm Naomi (10.May.)',
    type: 'Rose', colour: 'Red', size: 50, cultivar: 'Naomi',
    qty: 40, date: BATCH_NEW, cost: 5, sell: 18,
  });
  const roseRedB = batch({
    display: 'Rose Red 50cm Naomi (07.May.)',
    type: 'Rose', colour: 'Red', size: 50, cultivar: 'Naomi',
    qty: 20, date: BATCH_MID, cost: 5, sell: 18,
  });
  const roseRedC = batch({
    display: 'Rose Red 50cm Naomi (04.May.)',
    type: 'Rose', colour: 'Red', size: 50, cultivar: 'Naomi',
    qty: 0, date: BATCH_OLD, cost: 5, sell: 18,
  });
  stockItems.push(roseRedA, roseRedB, roseRedC);

  // 5. Rose White 60cm Avalanche — 1 Batch + 2 orders + premade reservation
  const roseWhite = batch({
    display: 'Rose White 60cm Avalanche (10.May.)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: 30, date: BATCH_NEW, cost: 7, sell: 24,
  });
  stockItems.push(roseWhite);
  const roseWhiteDE = de({
    display: 'Rose White 60cm Avalanche (2026-05-18)',
    type: 'Rose', colour: 'White', size: 60, cultivar: 'Avalanche',
    qty: -8, date: D7,
  });
  stockItems.push(roseWhiteDE);
  const ordRoseWhiteA = order({ requiredBy: D7, deliveryType: 'Delivery' });
  line({ order: ordRoseWhiteA, stock: roseWhiteDE, qty: 5 });
  const ordRoseWhiteB = order({ requiredBy: D7 });
  line({ order: ordRoseWhiteB, stock: roseWhiteDE, qty: 3 });

  // 6. Rose Pink 70cm Mondial — shortfall (DE only) with active order
  const rosePinkDE = de({
    display: 'Rose Pink 70cm Mondial (2026-05-25)',
    type: 'Rose', colour: 'Pink', size: 70, cultivar: 'Mondial',
    qty: -12, date: D14,
  });
  stockItems.push(rosePinkDE);
  const ordRosePink = order({ requiredBy: D14, deliveryType: 'Delivery' });
  line({ order: ordRosePink, stock: rosePinkDE, qty: 12, name: 'Rose Pink 70cm Mondial' });

  // 7. Tulip Yellow 40cm — 1 Batch + 1 active order
  const tulipYellow = batch({
    display: 'Tulip Yellow 40cm (10.May.)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: 50, date: BATCH_NEW, cost: 3, sell: 11,
  });
  stockItems.push(tulipYellow);
  const tulipYellowDE = de({
    display: 'Tulip Yellow 40cm (2026-05-13)',
    type: 'Tulip', colour: 'Yellow', size: 40, cultivar: null,
    qty: -8, date: D2,
  });
  stockItems.push(tulipYellowDE);
  const ordTulip = order({ requiredBy: D2, status: 'Ready' });
  line({ order: ordTulip, stock: tulipYellowDE, qty: 8, name: 'Tulip Yellow 40cm' });

  // 8. Tulip Red 40cm — pure shortfall, no orders
  stockItems.push(de({
    display: 'Tulip Red 40cm (2026-05-16)',
    type: 'Tulip', colour: 'Red', size: 40, cultivar: null,
    qty: -15, date: D5,
  }));

  // 9. Hydrangea Blue 30cm — 2 Batches + premade reservation (2 lines on it)
  const hydBlueA = batch({
    display: 'Hydrangea Blue 30cm (10.May.)',
    type: 'Hydrangea', colour: 'Blue', size: 30, cultivar: null,
    qty: 22, date: BATCH_NEW, cost: 9, sell: 28,
  });
  const hydBlueB = batch({
    display: 'Hydrangea Blue 30cm (04.May.)',
    type: 'Hydrangea', colour: 'Blue', size: 30, cultivar: null,
    qty: 6, date: BATCH_OLD, cost: 9, sell: 28,
  });
  stockItems.push(hydBlueA, hydBlueB);

  // 10. Hydrangea Pink 40cm — 1 Batch + 1 order
  const hydPink = batch({
    display: 'Hydrangea Pink 40cm (07.May.)',
    type: 'Hydrangea', colour: 'Pink', size: 40, cultivar: null,
    qty: 14, date: BATCH_MID, cost: 9, sell: 28,
  });
  stockItems.push(hydPink);
  const ordHyd = order({ requiredBy: TOMORROW });
  line({ order: ordHyd, stock: hydPink, qty: 3 });

  // 11. Lisianthus White 50cm — Batch
  const lisiWhite = batch({
    display: 'Lisianthus White 50cm (10.May.)',
    type: 'Lisianthus', colour: 'White', size: 50, cultivar: null,
    qty: 36, date: BATCH_NEW, cost: 4, sell: 14,
  });
  stockItems.push(lisiWhite);

  // 12. Lisianthus Lilac 60cm — DE only (shortfall)
  stockItems.push(de({
    display: 'Lisianthus Lilac 60cm (2026-05-18)',
    type: 'Lisianthus', colour: 'Lilac', size: 60, cultivar: null,
    qty: -9, date: D7,
  }));

  // 13. Eucalyptus — filler, no colour / size / cultivar
  const eucalyptus = batch({
    display: 'Eucalyptus (10.May.)',
    type: 'Eucalyptus', colour: null, size: null, cultivar: null,
    qty: 80, date: BATCH_NEW, cost: 2, sell: 7,
  });
  stockItems.push(eucalyptus);

  // 14. Lily White 70cm — Batch + premade reservation
  const lilyWhite = batch({
    display: 'Lily White 70cm (07.May.)',
    type: 'Lily', colour: 'White', size: 70, cultivar: null,
    qty: 20, date: BATCH_MID, cost: 8, sell: 26,
  });
  stockItems.push(lilyWhite);

  // ── Premade bouquets + lines (drives Reserved bucket on Varieties above) ──
  // Schema: id, airtable_id, name, created_by, price_override, notes, created_at.
  const bouquets = [
    { id: randomUUID(), name: 'Romantic Pink', price_override: '189.00' },
    { id: randomUUID(), name: 'Vibrant Mix',   price_override: '129.00' },
    { id: randomUUID(), name: 'Blue Bouquet',  price_override: '149.00' },
  ].map(b => ({
    ...b,
    airtable_id: null,
    created_by: 'lab',
    notes: '',
    created_at: new Date(),
  }));

  function makeLine(bouquetId, stock, qty) {
    return {
      id: randomUUID(),
      airtable_id: null,
      bouquet_id: bouquetId,
      stock_id:   stock.id,
      stock_airtable_id: null,
      flower_name: stock.display_name,
      quantity:    qty,
      cost_price_per_unit: '0',
      sell_price_per_unit: '0',
      created_at:  new Date(),
    };
  }

  const premadeLines = [
    // Romantic Pink → Peony A1 × 5 + Rose White × 3 + Eucalyptus × 2
    makeLine(bouquets[0].id, peonyA1,    5),
    makeLine(bouquets[0].id, roseWhite,  3),
    makeLine(bouquets[0].id, eucalyptus, 2),
    // Vibrant Mix → Tulip Yellow × 5 + Lisianthus White × 3
    makeLine(bouquets[1].id, tulipYellow, 5),
    makeLine(bouquets[1].id, lisiWhite,   3),
    // Blue Bouquet → Hydrangea Blue × 4 + Lily White × 2
    makeLine(bouquets[2].id, hydBlueA, 4),
    makeLine(bouquets[2].id, lilyWhite, 2),
  ];

  return {
    customers:           base.customers,
    stockItems,
    orders,
    orderLines,
    deliveries,
    premadeBouquets:     bouquets,
    premadeBouquetLines: premadeLines,
  };
}
