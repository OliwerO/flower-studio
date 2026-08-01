// Client-side Variety identity — the mirror of backend/src/utils/varietyIdentity.js.
//
// Why a mirror exists at all: the server already refuses to create a duplicate
// (#603 — POST /stock matches before it creates). But the SCREEN has to decide,
// before it posts, whether to show the user "this flower already exists" or
// "this will create a new one" — and if the two disagree, the user is asked to
// confirm creating something that already exists, clicks through, and the
// confirmed path (`newVariety: true`) deliberately bypasses the server guard.
// A client that under-matches is therefore not a cosmetic problem: it re-opens
// the exact door #603 closed.
//
// `PARITY_CASES` below is exported and re-run against the BACKEND implementation
// by backend/src/__tests__/varietyIdentity.parity.test.js. That is the anti-drift
// device — without it this mirror rots within a month.

import { describe, it, expect } from 'vitest';
import {
  isDatedBatchName,
  normaliseIdentityValue,
  normaliseSize,
  identityKey,
  stockItemIdentity,
  sameVariety,
  pickCanonical,
  resolveVariety,
  seedVarietyFromQuery,
} from '../utils/varietyIdentity.js';
import { PARITY_CASES, BLANK_VALUES, SIZE_CASES, BATCH_NAME_CASES } from './varietyIdentityParityCases.js';

// ── Fixtures: the shapes /stock actually returns (pgToResponse) ──
// Note there is deliberately NO 'Created At' — the wire row has no such field.
const PEONY_PINK_60 = {
  id: 'st-peony-pink-60', 'Display Name': 'Peony Pink 60cm',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null,
  'Current Quantity': 12, 'Current Cost Price': 4.5, 'Current Sell Price': 14,
  Supplier: 'Zielona', 'Lot Size': 10,
};
const PEONY_PINK_60_BATCH = {
  id: 'st-peony-pink-60-batch', 'Display Name': 'Peony Pink 60cm (24.Jul.)',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null,
  'Current Quantity': 30, 'Current Cost Price': 5, 'Current Sell Price': 15,
};
const PEONY_PINK_70 = {
  id: 'st-peony-pink-70', 'Display Name': 'Peony Pink 70cm',
  Type: 'Peony', Colour: 'Pink', Size: 70, Cultivar: null,
  'Current Quantity': 0, 'Current Cost Price': 6, 'Current Sell Price': 18,
};
const PEONY_PLAIN = {
  id: 'st-peony-plain', 'Display Name': 'Peony',
  Type: 'Peony', Colour: null, Size: null, Cultivar: null,
  'Current Quantity': 3, 'Current Cost Price': 4, 'Current Sell Price': 12,
};
const ROSE_RED_SARAH = {
  id: 'st-rose-red', 'Display Name': 'Rose Red 50cm Freedom',
  Type: 'Rose', Colour: 'Red', Size: 50, Cultivar: 'Freedom',
  'Current Quantity': 20, 'Current Cost Price': 3, 'Current Sell Price': 9,
};
// A Variety that exists ONLY as a dated delivery — no canonical card.
const DAHLIA_CORAL_BATCH = {
  id: 'st-dahlia-batch', 'Display Name': 'Dahlia Coral (22.Jul.)',
  Type: 'Dahlia', Colour: 'Coral', Size: null, Cultivar: null,
  'Current Quantity': 8, 'Current Cost Price': 7, 'Current Sell Price': 21,
};
// Attr-less legacy card — name only, no 4-tuple at all.
const EUCALYPTUS = {
  id: 'st-euc', 'Display Name': 'Eucalyptus',
  Type: null, Colour: null, Size: null, Cultivar: null,
  'Current Quantity': 5, 'Current Cost Price': 2, 'Current Sell Price': 6,
};

const STOCK = [
  PEONY_PINK_60, PEONY_PINK_60_BATCH, PEONY_PINK_70, PEONY_PLAIN,
  ROSE_RED_SARAH, DAHLIA_CORAL_BATCH, EUCALYPTUS,
];

describe('normaliseIdentityValue', () => {
  it('lowercases and trims', () => {
    expect(normaliseIdentityValue('  Sarah Bernhardt ')).toBe('sarah bernhardt');
  });

  it('collapses every flavour of blank to null', () => {
    for (const blank of BLANK_VALUES) expect(normaliseIdentityValue(blank)).toBeNull();
  });
});

describe('normaliseSize', () => {
  it.each(SIZE_CASES)('%o normalises to %o', (input, expected) => {
    expect(normaliseSize(input)).toBe(expected);
  });
});

describe('sameVariety — the parity contract', () => {
  it.each(PARITY_CASES)('$why → same=$same', ({ a, b, same }) => {
    expect(sameVariety(a, b)).toBe(same);
    expect(sameVariety(b, a)).toBe(same); // symmetric
  });
});

describe('identityKey / stockItemIdentity', () => {
  it('two spellings of one flower produce one key', () => {
    expect(identityKey({ typeName: 'peony', colour: ' PINK', sizeCm: '60' }))
      .toBe(identityKey({ typeName: 'Peony', colour: 'Pink', sizeCm: 60 }));
  });

  it('reads a stock wire row in either Pascal or snake shape', () => {
    expect(stockItemIdentity(PEONY_PINK_60))
      .toEqual(stockItemIdentity({ type_name: 'Peony', colour: 'Pink', size_cm: 60, cultivar: null }));
  });

  it('keeps strict null-awareness — blank colour is its own key', () => {
    expect(identityKey({ typeName: 'Peony' })).not.toBe(identityKey({ typeName: 'Peony', colour: 'Pink' }));
  });
});

describe('isDatedBatchName', () => {
  it.each(BATCH_NAME_CASES)('"%s" → %s', (name, expected) => {
    expect(isDatedBatchName(name)).toBe(expected);
  });
});

describe('pickCanonical', () => {
  it('drops dated Batches and returns the first canonical row in the supplied order', () => {
    expect(pickCanonical([PEONY_PINK_60_BATCH, PEONY_PINK_60]).id).toBe('st-peony-pink-60');
  });

  it('returns null when every candidate is a dated Batch', () => {
    expect(pickCanonical([DAHLIA_CORAL_BATCH])).toBeNull();
    expect(pickCanonical([])).toBeNull();
    expect(pickCanonical(undefined)).toBeNull();
  });
});

describe('resolveVariety', () => {
  it('matches an existing card through case and whitespace drift', () => {
    const r = resolveVariety(STOCK, { typeName: ' peony ', colour: 'PINK', sizeCm: '60' });
    expect(r.reason).toBe('match');
    expect(r.match.id).toBe('st-peony-pink-60');
  });

  it('prefers the canonical card over its dated Batch', () => {
    const r = resolveVariety(STOCK, { typeName: 'Peony', colour: 'Pink', sizeCm: 60 });
    expect(r.match.id).toBe('st-peony-pink-60');
    expect(r.datedBatches.map(b => b.id)).toEqual(['st-peony-pink-60-batch']);
  });

  it('reports dated-only when the flower exists solely as a delivery', () => {
    const r = resolveVariety(STOCK, { typeName: 'Dahlia', colour: 'Coral' });
    expect(r.reason).toBe('dated-only');
    expect(r.match).toBeNull();
    expect(r.datedBatches.map(b => b.id)).toEqual(['st-dahlia-batch']);
  });

  it('is strictly null-aware — a blank Colour never matches a coloured card', () => {
    const r = resolveVariety(STOCK, { typeName: 'Peony', colour: '', sizeCm: '' });
    expect(r.match.id).toBe('st-peony-plain');
  });

  it('matches a zero-quantity card — an empty flower is still a flower', () => {
    const r = resolveVariety(STOCK, { typeName: 'Peony', colour: 'Pink', sizeCm: 70 });
    expect(r.reason).toBe('match');
    expect(r.match.id).toBe('st-peony-pink-70');
  });

  it('falls back to the display name when no Type is given', () => {
    const r = resolveVariety(STOCK, { name: '  eucalyptus ' });
    expect(r.reason).toBe('name-match');
    expect(r.match.id).toBe('st-euc');
  });

  it('never resolves a dated name onto the canonical card', () => {
    const r = resolveVariety(STOCK, { name: 'Peony Pink 60cm (24.Jul.)' });
    expect(r.match).toBeNull();
    expect(r.reason).toBe('new');
  });

  it('reports new for a genuinely unknown flower, and no-type when there is nothing to go on', () => {
    expect(resolveVariety(STOCK, { typeName: 'Ranunculus', colour: 'Peach' }).reason).toBe('new');
    expect(resolveVariety(STOCK, {}).reason).toBe('no-type');
  });

  it('survives an empty or missing stock list', () => {
    expect(resolveVariety([], { typeName: 'Peony' }).reason).toBe('new');
    expect(resolveVariety(undefined, { typeName: 'Peony' }).reason).toBe('new');
  });
});

describe('seedVarietyFromQuery — the search box is a seed, never an identity', () => {
  it('NEVER turns the raw query into a Type (#562)', () => {
    // The exact shape that produced `Type = "Pink Peonies"` beside Peony/Pink.
    const seed = seedVarietyFromQuery('Pink Peonies', STOCK);
    expect(seed.typeName).toBe('');
    expect(seed.name).toBe('Pink Peonies');
  });

  it('the owner\'s own case: a two-letter query seeds nothing and names nothing yet', () => {
    // She typed "DA" looking for Dahlia, then pressed "+ Add new" — and `DA`
    // became both the flower's name and its Type.
    const seed = seedVarietyFromQuery('DA', STOCK);
    expect(seed.typeName).toBe('');
    expect(seed.colour).toBe('');
  });

  it('decomposes a query against values that already exist', () => {
    const seed = seedVarietyFromQuery('peony pink 60', STOCK);
    expect(seed).toMatchObject({ typeName: 'Peony', colour: 'Pink', sizeCm: '60' });
  });

  it('decomposes a cultivar too, and tolerates a cm suffix', () => {
    const seed = seedVarietyFromQuery('rose red 50cm freedom', STOCK);
    expect(seed).toMatchObject({ typeName: 'Rose', colour: 'Red', sizeCm: '50', cultivar: 'Freedom' });
  });

  it('adopts the whole card — tuple, prices, supplier — on an exact name hit', () => {
    const seed = seedVarietyFromQuery('  peony pink 60cm ', STOCK);
    expect(seed).toMatchObject({
      typeName: 'Peony', colour: 'Pink', sizeCm: '60',
      costPrice: '4.5', sellPrice: '14', supplier: 'Zielona', lotSize: '10',
    });
    expect(seed.stockItemId).toBe('st-peony-pink-60');
  });

  it('takes an explicitly supplied card over anything it would infer', () => {
    const seed = seedVarietyFromQuery('whatever', STOCK, ROSE_RED_SARAH);
    expect(seed.stockItemId).toBe('st-rose-red');
    expect(seed.typeName).toBe('Rose');
  });

  it('seeds a dated-batch query by name only — that row is a delivery, not the card', () => {
    const seed = seedVarietyFromQuery('Peony Pink 60cm (24.Jul.)', STOCK);
    expect(seed.stockItemId).toBe('');
    expect(seed.typeName).toBe('');
    expect(seed.name).toBe('Peony Pink 60cm (24.Jul.)');
  });

  it('a bare known Type seeds only the Type, leaving the rest to be chosen', () => {
    const seed = seedVarietyFromQuery('пион', [{ ...PEONY_PINK_60, Type: 'Пион' }]);
    expect(seed.typeName).toBe('Пион');
    expect(seed.colour).toBe('');
  });

  it('returns a complete, all-string form shape whatever the input', () => {
    for (const q of ['', '   ', 'Ranunculus Peach']) {
      const seed = seedVarietyFromQuery(q, STOCK);
      for (const k of ['name', 'typeName', 'colour', 'sizeCm', 'cultivar', 'costPrice', 'sellPrice', 'supplier', 'lotSize', 'stockItemId']) {
        expect(typeof seed[k], `${k} for query "${q}"`).toBe('string');
      }
    }
  });
});
