// lab/factories/order.js
//
// Synthetic Order row — matches backend/src/db/schema.js `orders` table.
//
// Schema: id, airtable_id, app_order_id, customer_id (text, NOT uuid FK — holds
//         Airtable recXXX or customer.id string), status, delivery_type
//         ('Delivery' | 'Pickup'), order_date, required_by, delivery_time,
//         customer_request, notes_original, florist_note, greeting_card_text,
//         source, communication_method, payment_status, payment_method,
//         price_override, delivery_fee, created_by, payment_1_amount,
//         payment_1_method, image_url, key_person_id, wix_order_id,
//         created_at, updated_at, deleted_at
//
// NOTE: customer_id is text (not uuid) in the DB — the Phase 4 schema held
//       Airtable recXXX values during migration. Factories accept either
//       `customerId` (shorthand) or `customer_id` (column name).
//
// NOTE: delivery_type values are 'Delivery' | 'Pickup' (capitalized), matching
//       the Airtable field values and the schema comment in schema.js.

import { faker } from '@faker-js/faker';

export const ORDER_STATUSES = [
  'New',
  'In Progress',
  'In Preparation',
  'Ready',
  'Out for Delivery',
  'Delivered',
  'Picked Up',
  'Cancelled',
];

// Generates a human-facing order ID in the format used by configService.js
// e.g. "202605-00042" (no BLO prefix — factory uses plain numeric format)
let _orderCounter = 0;
function nextAppOrderId() {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  _orderCounter += 1;
  return `${yyyymm}-${String(_orderCounter).padStart(5, '0')}`;
}

export function makeOrder(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { customerId, ...columnOverrides } = overrides;

  const resolvedCustomerId = customerId ?? columnOverrides.customer_id ?? null;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    wix_order_id: null,
    app_order_id: nextAppOrderId(),
    customer_id: resolvedCustomerId,
    status: 'New',
    delivery_type: faker.helpers.arrayElement(['Delivery', 'Pickup']),
    order_date: new Date().toISOString().slice(0, 10),
    required_by: faker.date.soon({ days: 14 }).toISOString().slice(0, 10),
    delivery_time: '14:00',
    customer_request: null,
    notes_original: null,
    florist_note: null,
    greeting_card_text: null,
    source: faker.helpers.arrayElement(['In-store', 'Instagram', 'WhatsApp', 'Wix']),
    communication_method: null,
    payment_status: 'Unpaid',
    payment_method: faker.helpers.arrayElement(['Cash', 'Card', 'Transfer']),
    price_override: null,
    delivery_fee: null,
    created_by: null,
    payment_1_amount: null,
    payment_1_method: null,
    image_url: null,
    key_person_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last.
    ...columnOverrides,
    // Ensure customer_id is always correct (shorthand takes priority).
    customer_id: resolvedCustomerId,
  };
}
