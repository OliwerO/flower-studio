// lab/factories/orderLine.js
//
// Synthetic Order Line row — matches backend/src/db/schema.js `order_lines` table.
//
// Schema: id, airtable_id, order_id (uuid FK → orders.id), stock_item_id (text),
//         flower_name (NOT NULL), quantity (int, default 0), cost_price_per_unit,
//         sell_price_per_unit, stock_deferred (bool), created_at, updated_at, deleted_at
//
// Factory-only shaping keys (stripped from output):
//   orderId     → maps to order_id
//   stockItemId → maps to stock_item_id
//   costSnapshot → maps to cost_price_per_unit  (matches CLAUDE.md price-snapshot naming)
//   sellSnapshot → maps to sell_price_per_unit
//
// IMPORTANT: flower_name is NOT NULL in the schema — always provide it or rely on
// the fallback below.

import { faker } from '@faker-js/faker';

const FALLBACK_FLOWERS = [
  'Red Roses', 'Pink Peonies', 'White Tulips', 'Eucalyptus',
  'Lisianthus', 'Hydrangea', 'Ranunculus', 'Gypsophila',
];

export function makeOrderLine(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const {
    orderId,
    stockItemId,
    costSnapshot,
    sellSnapshot,
    ...columnOverrides
  } = overrides;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    order_id: orderId ?? columnOverrides.order_id ?? null,
    stock_item_id: stockItemId ?? columnOverrides.stock_item_id ?? null,
    flower_name: columnOverrides.flower_name
      ?? faker.helpers.arrayElement(FALLBACK_FLOWERS),
    quantity: 1,
    cost_price_per_unit: costSnapshot ?? 0,
    sell_price_per_unit: sellSnapshot ?? 0,
    stock_deferred: false,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last, excluding factory-only keys already handled.
    ...columnOverrides,
    // Ensure FK columns are always correct (shorthands take priority).
    order_id: orderId ?? columnOverrides.order_id ?? null,
    stock_item_id: stockItemId ?? columnOverrides.stock_item_id ?? null,
    // Ensure snapshot columns honour shorthands even if columnOverrides re-sets them.
    cost_price_per_unit: costSnapshot ?? columnOverrides.cost_price_per_unit ?? 0,
    sell_price_per_unit: sellSnapshot ?? columnOverrides.sell_price_per_unit ?? 0,
  };
}
