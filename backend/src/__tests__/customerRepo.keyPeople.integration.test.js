// Integration: key_people phone + address round-trip (CR-30 C1).
// Boots pglite, applies migrations (incl. 0018), exercises the repo against real SQL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { customers } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { createKeyPerson, listKeyPeople } from '../repos/customerRepo.js';

let harness, customerId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  const [c] = await harness.db.insert(customers).values({ name: 'Anna Test' }).returning();
  customerId = c.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('key_people phone + address (CR-30 C1)', () => {
  it('persists phone + address on create and returns them from list', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Babcia Maria',
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
      importantDate: '1950-03-08',
      importantDateLabel: 'Birthday',
    });

    expect(created).toMatchObject({
      name: 'Babcia Maria',
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
    });

    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Babcia Maria',
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
      importantDateLabel: 'Birthday',
    });
  });

  it('defaults phone + address to null when omitted (back-compat)', async () => {
    await createKeyPerson(customerId, { name: 'Brat Piotr' });
    const [row] = await listKeyPeople(customerId);
    expect(row.name).toBe('Brat Piotr');
    expect(row.phone).toBeNull();
    expect(row.address).toBeNull();
  });

  it('treats empty-string phone/address as null', async () => {
    const created = await createKeyPerson(customerId, { name: 'X', phone: '', address: '' });
    expect(created.phone).toBeNull();
    expect(created.address).toBeNull();
  });
});
