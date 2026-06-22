// lab/factories/stockLoss.js
//
// Synthetic Stock Loss Log row — matches backend/src/db/schema.js `stock_loss_log` table.
//
// Schema: id, airtable_id, date (YYYY-MM-DD NOT NULL), stock_id (uuid FK→stock.id),
//         quantity (numeric 8,2 NOT NULL — POSITIVE stems lost), reason (text NOT NULL),
//         notes (text NOT NULL DEFAULT ''), created_at (timestamptz), deleted_at
//
// Factory-only shaping keys (stripped from output):
//   stockId → maps to stock_id

import { faker } from '@faker-js/faker';

export const LOSS_REASON = ['Wilted', 'Damaged', 'Arrived Broken', 'Overstock', 'Other'];

export function makeStockLoss(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { stockId, ...columnOverrides } = overrides;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    date: columnOverrides.date ?? '2026-01-01',
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
    quantity: columnOverrides.quantity ?? 1,
    reason: columnOverrides.reason ?? 'Wilted',
    notes: columnOverrides.notes ?? '',
    created_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last, excluding factory-only keys already handled.
    ...columnOverrides,
    // Ensure FK column is always correct (shorthand takes priority).
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
  };
}
