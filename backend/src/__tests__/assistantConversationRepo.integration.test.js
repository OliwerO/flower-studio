import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import crypto from 'node:crypto';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as repo from '../repos/assistantConversationRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

const msgs = (n) => Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` }));

describe('assistantConversationRepo', () => {
  it('inserts then lists with messageCount, newest first', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.upsert({ id: a, title: 'first', messages: msgs(2) });
    await repo.upsert({ id: b, title: 'second', messages: msgs(4) });
    const rows = await repo.list();
    expect(rows.map(r => r.id)).toEqual([b, a]); // b updated last → first
    expect(rows.find(r => r.id === b).messageCount).toBe(4);
    expect(rows.find(r => r.id === a).title).toBe('first');
  });

  it('upsert on conflict refreshes messages but preserves title', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'orig', messages: msgs(1) });
    await repo.rename(id, 'renamed');
    await repo.upsert({ id, title: 'orig', messages: msgs(3) }); // a later turn
    const row = await repo.getById(id);
    expect(row.title).toBe('renamed'); // rename survived the upsert
    expect(row.messages).toHaveLength(3);
  });

  it('getById returns null for unknown id', async () => {
    expect(await repo.getById(crypto.randomUUID())).toBeNull();
  });

  it('rename returns the row, null when not found', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'x', messages: msgs(1) });
    expect(await repo.rename(id, 'newname')).toMatchObject({ id, title: 'newname' });
    expect(await repo.rename(crypto.randomUUID(), 'z')).toBeNull();
  });

  it('remove deletes and reports success/failure', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'x', messages: msgs(1) });
    expect(await repo.remove(id)).toBe(true);
    expect(await repo.getById(id)).toBeNull();
    expect(await repo.remove(id)).toBe(false);
  });
});
