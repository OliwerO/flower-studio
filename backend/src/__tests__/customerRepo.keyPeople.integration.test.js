// Integration: key_people phone + address round-trip (CR-30 C1), extended with
// instagram + telegram (#553, migration 0023).
// Boots pglite, applies migrations (incl. 0018 + 0023), exercises the repo against real SQL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { customers, keyPeople } from '../db/schema.js';

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

describe('createKeyPerson find-or-create dedupe (#517)', () => {
  it('returns the existing row instead of inserting a duplicate when name+phone match exactly', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });
    const second = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });

    expect(second.id).toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
  });

  it('matches name case-insensitively and trimmed, and phone on digits only', async () => {
    const first = await createKeyPerson(customerId, { name: '  Maria Kowalska  ', phone: '+48 500-100-200' });
    const second = await createKeyPerson(customerId, { name: 'MARIA KOWALSKA', phone: '48500100200' });

    expect(second.id).toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
  });

  it('matches on name+phone both blank (no phone given either time)', async () => {
    const first = await createKeyPerson(customerId, { name: 'Babcia' });
    const second = await createKeyPerson(customerId, { name: 'babcia' });

    expect(second.id).toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
  });

  it('creates a separate row when the phone differs', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });
    const second = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48999888777' });

    expect(second.id).not.toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(2);
  });

  it('creates a separate row when one has a phone and the other does not', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska' });
    const second = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });

    expect(second.id).not.toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(2);
  });

  it('creates a separate row when the name differs (same phone)', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });
    const second = await createKeyPerson(customerId, { name: 'Anna Nowak', phone: '+48500100200' });

    expect(second.id).not.toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(2);
  });

  it('does not dedupe across different customers', async () => {
    const [otherCustomer] = await harness.db.insert(customers).values({ name: 'Other Customer' }).returning();

    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });
    const second = await createKeyPerson(otherCustomer.id, { name: 'Maria Kowalska', phone: '+48500100200' });

    expect(second.id).not.toBe(first.id);
    expect(await listKeyPeople(customerId)).toHaveLength(1);
    expect(await listKeyPeople(otherCustomer.id)).toHaveLength(1);
  });

  it('the address on a matched (deduped) row is unchanged — no silent overwrite', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200', address: 'ul. Kwiatowa 7' });
    const second = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200', address: 'ul. Inna 99' });

    expect(second.id).toBe(first.id);
    expect(second.address).toBe('ul. Kwiatowa 7');
  });

  // Review fix: blank-phone rows need an address match too, else two
  // different people who share a name (e.g. "Мама") and never had a phone
  // recorded collapse into one key-person row.
  it('does NOT dedupe two blank-phone rows with different addresses (review fix)', async () => {
    const home = await createKeyPerson(customerId, { name: 'Мама', address: 'ul. Domowa 1' });
    const work = await createKeyPerson(customerId, { name: 'Мама', address: 'ul. Biurowa 2' });

    expect(work.id).not.toBe(home.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(2);
  });

  it('DOES dedupe two blank-phone rows when the address also matches (case/whitespace-insensitive)', async () => {
    const first = await createKeyPerson(customerId, { name: 'Мама', address: '  Ul. Domowa 1  ' });
    const second = await createKeyPerson(customerId, { name: 'Мама', address: 'ul. domowa 1' });

    expect(second.id).toBe(first.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
  });

  it('backfills a blank address onto the matched row when the phone matches (review fix)', async () => {
    const first = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });
    expect(first.address).toBeNull();

    const second = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200', address: 'ul. Kwiatowa 7' });

    expect(second.id).toBe(first.id);
    expect(second.address).toBe('ul. Kwiatowa 7');
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe('ul. Kwiatowa 7');
  });

  it('picks the earliest-created row deterministically when duplicates already exist (review fix)', async () => {
    // Simulate a pre-existing duplicate pair — e.g. left over from before this
    // dedupe existed — by inserting directly (bypassing the repo), with
    // explicit createdAt timestamps in NEWER-then-OLDER insertion order so a
    // correct result depends on the repo's own ORDER BY, not table scan order.
    const [newer] = await harness.db.insert(keyPeople).values({
      customerId, name: 'Maria Kowalska', phone: '+48500100200',
      createdAt: new Date('2024-06-01T00:00:00Z'),
    }).returning();
    const [older] = await harness.db.insert(keyPeople).values({
      customerId, name: 'Maria Kowalska', phone: '+48500100200',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    }).returning();

    const result = await createKeyPerson(customerId, { name: 'Maria Kowalska', phone: '+48500100200' });

    expect(result.id).toBe(older.id);
    expect(result.id).not.toBe(newer.id);
    const list = await listKeyPeople(customerId);
    expect(list).toHaveLength(2); // no third row inserted — still matched
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
