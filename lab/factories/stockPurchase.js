// lab/factories/stockPurchase.js
//
// Synthetic Stock Purchase row — matches backend/src/db/schema.js `stock_purchases` table.
//
// Schema: id, airtable_id, purchase_date (text YYYY-MM-DD NOT NULL), supplier (text NOT NULL),
//         stock_id (uuid FK→stock.id), stock_airtable_id, quantity_purchased (int NOT NULL, =Found),
//         quantity_accepted (int nullable — kept qty after write-off, #492),
//         price_per_unit (numeric 10,4 nullable), notes (text NOT NULL DEFAULT ''),
//         created_at (timestamptz)
//
// Factory-only shaping keys (stripped from output):
//   stockId → maps to stock_id

import { faker } from '@faker-js/faker';

export function makeStockPurchase(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { stockId, ...columnOverrides } = overrides;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    purchase_date: columnOverrides.purchase_date ?? '2026-01-01',
    supplier: columnOverrides.supplier ?? '',
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
    stock_airtable_id: null,
    quantity_purchased: columnOverrides.quantity_purchased ?? 0,
    quantity_accepted: columnOverrides.quantity_accepted ?? null,
    price_per_unit: columnOverrides.price_per_unit ?? null,
    notes: columnOverrides.notes ?? '',
    created_at: new Date(),
    // Apply column-level overrides last, excluding factory-only keys already handled.
    ...columnOverrides,
    // Ensure FK column is always correct (shorthand takes priority).
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
  };
}
