// lab/tests/api/stock-grouped-by-variety.test.js
//
// AC4 of #303 — verify GET /stock?grouped=true returns the Y-model grouped
// shape that drives the bouquet picker's inline catalog. The dropdown groups
// client-side via groupByVariety(), so the regression gate here is the wire
// shape: one entry per 4-tuple Variety key, NULL-aware (distinct cultivars on
// the same Type+Colour+Size stay separate), each carrying its constituent rows.
//
// The lab default scenario (baseline) doesn't seed Variety attrs, so we reset
// then insert a small curated fixture before exercising the endpoint.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { api, startLabBackend, stopLabBackend } from '../../helpers/api.js';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

async function seedVarietyRows(pool) {
  await pool.query(
    `INSERT INTO stock (id, display_name, type_name, colour, size_cm, cultivar,
                        current_quantity, current_cost_price, current_sell_price,
                        supplier, active, date)
     VALUES
       ($1, $2,  'Peony', 'Pink', 60, 'Sarah Bernhardt', 25, 12, 42, 'Direct', true, '2026-05-10'),
       ($3, $4,  'Peony', 'Pink', 60, 'Sarah Bernhardt',  8, 11, 42, 'Direct', true, '2026-05-07'),
       ($5, $6,  'Peony', 'Pink', 60, 'Coral Charm',     18, 13, 44, 'Direct', true, '2026-05-10'),
       ($7, $8,  'Peony', 'Pink', 50,  NULL,             10,  9, 36, 'Direct', true, '2026-05-10'),
       ($9, $10, 'Rose',  'Red',  50, 'Naomi',           40,  5, 18, 'Direct', true, '2026-05-10')`,
    [
      randomUUID(), 'Peony Pink 60cm Sarah Bernhardt (10.May)',
      randomUUID(), 'Peony Pink 60cm Sarah Bernhardt (07.May)',
      randomUUID(), 'Peony Pink 60cm Coral Charm (10.May)',
      randomUUID(), 'Peony Pink 50cm (10.May)',
      randomUUID(), 'Rose Red 50cm Naomi (10.May)',
    ],
  );
}

describe('GET /stock?grouped=true — Y-model grouped catalog (#303 AC4)', () => {
  beforeAll(async () => {
    await resetLabDb();
    await startLabBackend();
  }, 60_000);

  afterAll(stopLabBackend);

  beforeEach(async () => {
    await stopLabBackend();
    await resetLabDb();
    const pool = labPool();
    try {
      await seedVarietyRows(pool);
    } finally {
      await pool.end();
    }
    await startLabBackend();
  }, 60_000);

  it('collapses same-4-tuple rows into one group and splits distinct cultivars', async () => {
    const owner = api('owner');
    const res = await owner.get('/api/stock?grouped=true');
    expect(res.status).toBe(200);

    const groups = res.body.groups;
    expect(Array.isArray(groups)).toBe(true);

    // Every group carries the 4-tuple identity surface the picker reads.
    for (const g of groups) {
      expect(g).toHaveProperty('key');
      expect(g).toHaveProperty('type_name');
      expect(g).toHaveProperty('colour');
      expect(g).toHaveProperty('size_cm');
      expect(g).toHaveProperty('cultivar');
      expect(Array.isArray(g.rows)).toBe(true);
    }

    // No duplicate keys — grouping is the regression target.
    const keys = groups.map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);

    // Peony Pink 60cm Sarah Bernhardt: 2 rows in fixture → 1 group with 2 rows.
    const sarahBernhardt = groups.find(g =>
      g.type_name === 'Peony' && g.colour === 'Pink' &&
      g.size_cm === 60 && g.cultivar === 'Sarah Bernhardt',
    );
    expect(sarahBernhardt).toBeDefined();
    expect(sarahBernhardt.rows.length).toBe(2);

    // Coral Charm: same Type/Colour/Size as Sarah Bernhardt but different cultivar
    // → must be its own group (NULL-aware key discriminates).
    const coralCharm = groups.find(g => g.cultivar === 'Coral Charm');
    expect(coralCharm).toBeDefined();
    expect(coralCharm.rows.length).toBe(1);

    // null cultivar Peony Pink 50cm — separate group, cultivar serialized as null.
    const peonyNoCultivar = groups.find(g =>
      g.type_name === 'Peony' && g.size_cm === 50,
    );
    expect(peonyNoCultivar).toBeDefined();
    expect(peonyNoCultivar.cultivar).toBeNull();
    expect(peonyNoCultivar.rows.length).toBe(1);

    // Rose Red 50cm Naomi — distinct Type stays in its own group.
    const naomi = groups.find(g => g.type_name === 'Rose');
    expect(naomi).toBeDefined();
    expect(naomi.rows.length).toBe(1);
  });
});
