// lab/factories/customer.js
//
// Synthetic Customer row — matches backend/src/db/schema.js `customers` table.
// PII-clean by construction (faker generates fake people).
//
// Schema: id, airtable_id, name, nickname, phone, email, link, language,
//         home_address, sex_business, segment, found_us_from,
//         communication_method, order_source, created_at, deleted_at

import { faker } from '@faker-js/faker';

export function makeCustomer(overrides = {}) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return {
    id: faker.string.uuid(),
    airtable_id: null,
    name: `${firstName} ${lastName}`,
    nickname: null,
    phone: '+48' + faker.string.numeric(9),
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    link: null,
    language: faker.helpers.arrayElement(['ru', 'pl', 'en', null]),
    home_address: faker.location.streetAddress(),
    sex_business: null,
    segment: null,
    found_us_from: null,
    communication_method: null,
    order_source: null,
    created_at: new Date(),
    deleted_at: null,
    ...overrides,
  };
}
