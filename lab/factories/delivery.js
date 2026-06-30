// lab/factories/delivery.js
//
// Synthetic Delivery row — matches backend/src/db/schema.js `deliveries` table.
//
// Schema: id, airtable_id, order_id (uuid FK → orders.id), delivery_address,
//         recipient_name, recipient_phone, delivery_date, delivery_time,
//         courier_time, assigned_driver, delivery_fee, driver_instructions,
//         delivery_method ('Driver' | 'Self'), driver_payout,
//         status (default 'Pending'), delivered_at, created_at, updated_at, deleted_at
//
// Factory-only shaping keys (stripped from output):
//   orderId → maps to order_id
//
// One delivery per order — enforced by UNIQUE constraint on order_id in DB.

import { faker } from '@faker-js/faker';

export function makeDelivery(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { orderId, ...columnOverrides } = overrides;

  const resolvedOrderId = orderId ?? columnOverrides.order_id ?? null;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    order_id: resolvedOrderId,
    delivery_address: faker.location.streetAddress({ useFullAddress: true }),
    recipient_name: faker.person.fullName(),
    recipient_phone: '+48' + faker.string.numeric(9),
    delivery_date: faker.date.soon({ days: 14 }).toISOString().slice(0, 10),
    delivery_time: '14:00',
    courier_time: null,
    assigned_driver: null,
    delivery_fee: faker.number.int({ min: 15, max: 40 }),
    driver_instructions: null,
    delivery_method: 'Driver',
    driver_payout: null,
    status: 'Pending',
    delivered_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last.
    ...columnOverrides,
    // Ensure order_id is always correct (shorthand takes priority).
    order_id: resolvedOrderId,
  };
}
