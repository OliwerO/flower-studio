// Integration: key_people phone + address round-trip (CR-30 C1), extended with
// instagram + telegram (#553, migration 0023).
// Boots pglite, applies migrations (incl. 0018 + 0023), exercises the repo against real SQL.
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

describe('key_people instagram + telegram (#553)', () => {
  it('persists instagram + telegram on create and returns them from list', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Babcia Maria',
      instagram: 'https://instagram.com/babcia.maria',
      telegram: 'babcia_maria',
    });

    expect(created).toMatchObject({
      name: 'Babcia Maria',
      instagram: 'https://instagram.com/babcia.maria',
      telegram: 'babcia_maria',
    });

    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Babcia Maria',
      instagram: 'https://instagram.com/babcia.maria',
      telegram: 'babcia_maria',
    });
  });

  it('defaults instagram + telegram to null when omitted (back-compat)', async () => {
    await createKeyPerson(customerId, { name: 'Brat Piotr' });
    const [row] = await listKeyPeople(customerId);
    expect(row.name).toBe('Brat Piotr');
    expect(row.instagram).toBeNull();
    expect(row.telegram).toBeNull();
  });

  it('treats empty-string instagram/telegram as null', async () => {
    const created = await createKeyPerson(customerId, { name: 'X', instagram: '', telegram: '' });
    expect(created.instagram).toBeNull();
    expect(created.telegram).toBeNull();
  });

  it('does not require instagram/telegram alongside phone/address — all four are independent', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Full Profile',
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
      instagram: '@full.profile',
      telegram: 'fullprofile',
    });
    expect(created).toMatchObject({
      phone: '+48500100200',
      address: 'ul. Kwiatowa 7, Kraków',
      instagram: '@full.profile',
      telegram: 'fullprofile',
    });
  });
});

describe('updateKeyPerson — instagram + telegram (#553)', () => {
  it('updates instagram + telegram and reflects the change in listKeyPeople', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Babcia Maria',
      instagram: '@babcia.maria',
      telegram: 'babcia_old',
    });

    const updated = await updateKeyPerson(created.id, {
      instagram: 'https://instagram.com/babcia.maria.nowak',
      telegram: 'babcia_nowak',
    });

    expect(updated).toMatchObject({
      id:        created.id,
      instagram: 'https://instagram.com/babcia.maria.nowak',
      telegram:  'babcia_nowak',
    });

    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      instagram: 'https://instagram.com/babcia.maria.nowak',
      telegram:  'babcia_nowak',
    });
  });

  it('partial update of only telegram leaves instagram + name intact', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Brat Piotr',
      instagram: '@brat.piotr',
      telegram: 'old_handle',
    });

    const updated = await updateKeyPerson(created.id, { telegram: 'new_handle' });

    expect(updated).toMatchObject({
      name:      'Brat Piotr',
      instagram: '@brat.piotr',
      telegram:  'new_handle',
    });

    const [row] = await listKeyPeople(customerId);
    expect(row.instagram).toBe('@brat.piotr');
    expect(row.telegram).toBe('new_handle');
  });

  it('clears instagram/telegram back to null when explicitly set empty', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'X',
      instagram: '@x',
      telegram: 'x_handle',
    });

    const updated = await updateKeyPerson(created.id, { instagram: '', telegram: '' });

    expect(updated.instagram).toBeNull();
    expect(updated.telegram).toBeNull();
  });

  it('clears instagram/telegram back to null when explicitly set to null (not just empty string)', async () => {
    const created = await createKeyPerson(customerId, {
      name: 'Y',
      instagram: '@y',
      telegram: 'y_handle',
    });

    const updated = await updateKeyPerson(created.id, { instagram: null, telegram: null });

    expect(updated.instagram).toBeNull();
    expect(updated.telegram).toBeNull();
  });
});
