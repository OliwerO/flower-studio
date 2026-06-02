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

import {
  getFloristChatId, setFloristChatId, getFloristLang, setFloristLang,
} from '../repos/floristTelegramRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('floristTelegramRepo', () => {
  it('returns null chat id and default ru lang before registration', async () => {
    expect(await getFloristChatId()).toBeNull();
    expect(await getFloristLang()).toBe('ru');
  });

  it('stores and reads back the florist chat id', async () => {
    await setFloristChatId('555');
    expect(await getFloristChatId()).toBe('555');
  });

  it('setFloristChatId preserves a previously set lang', async () => {
    await setFloristLang('en');
    await setFloristChatId('555');
    expect(await getFloristLang()).toBe('en');
    expect(await getFloristChatId()).toBe('555');
  });

  it('setFloristLang works before any chat id is registered', async () => {
    await setFloristLang('pl');
    expect(await getFloristLang()).toBe('pl');
    expect(await getFloristChatId()).toBeNull();
  });
});
