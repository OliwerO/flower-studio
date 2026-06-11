import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as repo from '../repos/driverTelegramRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('driverTelegramRepo', () => {
  it('returns null for an unknown driver', async () => {
    expect(await repo.getDriver('Ghost')).toBeNull();
  });

  it('stores a chat id with default lang ru', async () => {
    await repo.setChatId('Nikita', '12345');
    expect(await repo.getDriver('Nikita')).toMatchObject({ chatId: '12345', lang: 'ru' });
  });

  it('upserts the chat id on re-registration, preserving lang', async () => {
    await repo.setChatId('Nikita', '12345');
    await repo.setLang('Nikita', 'en');
    await repo.setChatId('Nikita', '99999');
    expect(await repo.getDriver('Nikita')).toMatchObject({ chatId: '99999', lang: 'en' });
  });

  it('sets lang before any chat is registered (chat_id null)', async () => {
    await repo.setLang('Bjorn', 'pl');
    expect(await repo.getDriver('Bjorn')).toMatchObject({ chatId: null, lang: 'pl' });
  });

  it('lists registered drivers', async () => {
    await repo.setChatId('Timur', '55555');
    const names = (await repo.listRegistered()).map(r => r.driverName);
    expect(names).toContain('Timur');
  });
});
