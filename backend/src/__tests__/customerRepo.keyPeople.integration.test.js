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

import { createKeyPerson, listKeyPeople, updateKeyPerson } from '../repos/customerRepo.js';

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

describe('updateKeyPerson (CR-30 C4)', () => {
  it('updates name + phone + address and reflects the change in listKeyPeople', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Babcia Maria',
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
      importantDate: '1950-03-08',
      importantDateLabel: 'Birthday',
    });

    const updated = await updateKeyPerson(created.id, {
      name: 'Babcia Maria Nowak',
      phone: '+48500999888',
      address: 'ul. Różana 12, Kraków',
    });

    expect(updated).toMatchObject({
      id:      created.id,
      name:    'Babcia Maria Nowak',
      phone:   '+48500999888',
      address: 'ul. Różana 12, Kraków',
      importantDate: '1950-03-08',
      importantDateLabel: 'Birthday',
    });

    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name:    'Babcia Maria Nowak',
      phone:   '+48500999888',
      address: 'ul. Różana 12, Kraków',
    });
  });

  it('partial update of only phone leaves name + address intact', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Brat Piotr',
      phone: '+48111222333',
      address: 'ul. Lipowa 4, Kraków',
    });

    const updated = await updateKeyPerson(created.id, { phone: '+48999000111' });

    expect(updated).toMatchObject({
      name:    'Brat Piotr',
      phone:   '+48999000111',
      address: 'ul. Lipowa 4, Kraków',
    });

    const [row] = await listKeyPeople(customerId);
    expect(row.name).toBe('Brat Piotr');
    expect(row.phone).toBe('+48999000111');
    expect(row.address).toBe('ul. Lipowa 4, Kraków');
  });

  it('throws statusCode 404 when updating a non-existent key person', async () => {
    await expect(
      updateKeyPerson('00000000-0000-0000-0000-000000000000', { phone: '+48000000000' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
