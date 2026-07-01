import { describe, it, expect } from 'vitest';
import { openExplorerViewHandler } from '../services/assistantTools/explorerViewPack.js';
import { db } from '../db/index.js';

// This test suite runs with no DATABASE_URL configured, so `db` is `null`
// (see backend/src/db/index.js: `export let db = pool ? drizzlePg(...) : null`).
// Any accidental DB read inside the handler (e.g. calling db.select(...))
// would throw "Cannot read properties of null" — the tests below prove the
// handler never touches `db` at all.

describe('explorerViewPack.open_explorer_view', () => {
  it('returns view/spec/label for a valid spec, using the given label', async () => {
    const spec = {
      entity: 'orders',
      filters: [{ field: 'status', op: 'eq', value: 'New' }],
    };
    const r = await openExplorerViewHandler({ spec, label: 'Новые заказы' });
    expect(r).toEqual({ view: 'explorer', spec, label: 'Новые заказы' });
  });

  it('defaults to the Russian label "Данные" when label is omitted', async () => {
    const spec = { entity: 'orders' };
    const r = await openExplorerViewHandler({ spec });
    expect(r).toEqual({ view: 'explorer', spec, label: 'Данные' });
  });

  it('ignores a blank/non-string label and falls back to the default', async () => {
    const spec = { entity: 'orders' };
    const r = await openExplorerViewHandler({ spec, label: '   ' });
    expect(r.label).toBe('Данные');
  });

  it('returns { error } for an invalid spec (unknown entity), never a view', async () => {
    const r = await openExplorerViewHandler({ spec: { entity: 'bogus_entity' } });
    expect(r.error).toBeTypeOf('string');
    expect(r.view).toBeUndefined();
  });

  it('returns { error } when spec is missing entirely', async () => {
    const r = await openExplorerViewHandler({});
    expect(r.error).toBeTypeOf('string');
    expect(r.view).toBeUndefined();
  });

  it('performs no database access — pure/synchronous echo of a validated spec', async () => {
    // Sanity check: db is null in this test environment (no DATABASE_URL), so
    // any accidental read inside the handler would throw a TypeError here.
    expect(db).toBeNull();

    const spec = { entity: 'orders', filters: [{ field: 'status', op: 'eq', value: 'New' }] };
    await expect(openExplorerViewHandler({ spec, label: 'Test' })).resolves.toEqual({
      view: 'explorer',
      spec,
      label: 'Test',
    });
  });
});
