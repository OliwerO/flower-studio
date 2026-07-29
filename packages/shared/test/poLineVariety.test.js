import { describe, it, expect } from 'vitest';
import {
  lineAttrsToTuple,
  stockItemToTuple,
  findVarietyMatch,
  resolveVarietyLink,
  derivePackages,
  stemsFromPackages,
  linkAgreesWithAttrs,
} from '../utils/poLineVariety.js';

// A small stock set mirroring the shapes the PO screens actually load:
// an undated canonical card per Variety, plus dated Batches for one of them.
const PEONY_PINK_60 = {
  id: 'sp-1', 'Display Name': 'Peony Pink 60cm Sarah B.',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: 'Sarah B.',
  'Current Cost Price': 4.5, 'Current Sell Price': 14, 'Lot Size': 10,
  Supplier: 'Zielona', Farmer: 'Kowalski',
};
const PEONY_PINK_60_BATCH = {
  id: 'sp-1b', 'Display Name': 'Peony Pink 60cm Sarah B. (14.Mar.)',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: 'Sarah B.',
  'Current Cost Price': 4.9, 'Current Sell Price': 15, 'Lot Size': 10,
};
const PEONY_PINK_70 = {
  id: 'sp-2', 'Display Name': 'Peony Pink 70cm Sarah B.',
  Type: 'Peony', Colour: 'Pink', Size: 70, Cultivar: 'Sarah B.',
  'Current Cost Price': 5.2, 'Current Sell Price': 16, 'Lot Size': 10,
};
const EUCALYPTUS_NO_COLOUR = {
  id: 'sp-3', 'Display Name': 'Eucalyptus',
  Type: 'Eucalyptus', Colour: null, Size: null, Cultivar: null,
  'Current Cost Price': 3, 'Current Sell Price': 9, 'Lot Size': 0,
};
const EUCALYPTUS_GREEN = {
  id: 'sp-4', 'Display Name': 'Eucalyptus Green',
  Type: 'Eucalyptus', Colour: 'Green', Size: null, Cultivar: null,
  'Current Cost Price': 3.1, 'Current Sell Price': 9, 'Lot Size': 0,
};
const COST_ONLY = {
  id: 'sp-5', 'Display Name': 'Tulip Red',
  Type: 'Tulip', Colour: 'Red', Size: null, Cultivar: null,
  'Current Cost Price': 2, 'Current Sell Price': 0, 'Lot Size': 0,
};

const STOCK = [
  PEONY_PINK_60, PEONY_PINK_60_BATCH, PEONY_PINK_70,
  EUCALYPTUS_NO_COLOUR, EUCALYPTUS_GREEN, COST_ONLY,
];

const attrsOf = (s) => ({
  type: s.Type, colour: s.Colour, size: s.Size, cultivar: s.Cultivar,
});

describe('tuple normalization', () => {
  it('normalizes blank and whitespace-only attrs to null', () => {
    expect(lineAttrsToTuple({ type: ' Peony ', colour: '', size: '', cultivar: '   ' }))
      .toEqual({ type_name: 'Peony', colour: null, size_cm: null, cultivar: null });
  });

  it('keeps size 0 as a real size rather than collapsing it to null', () => {
    // ADR-0006 renders size 0 as "0cm" — it is a value, not an absence.
    expect(lineAttrsToTuple({ type: 'X', size: 0 }).size_cm).toBe(0);
  });

  it('reads a size that arrives as a string from a number input', () => {
    expect(lineAttrsToTuple({ type: 'X', size: '60' }).size_cm).toBe(60);
  });

  it('dual-reads snake_case stock rows', () => {
    expect(stockItemToTuple({ type_name: 'Rose', colour: 'Red', size_cm: 50 }))
      .toEqual({ type_name: 'Rose', colour: 'Red', size_cm: 50, cultivar: null });
  });
});

describe('findVarietyMatch', () => {
  it('matches an existing Variety on the full four-tuple', () => {
    expect(findVarietyMatch(STOCK, attrsOf(PEONY_PINK_70))?.id).toBe('sp-2');
  });

  it('prefers the undated card over a dated Batch of the same Variety', () => {
    // Linking a purchase to last week's arrival would bind new stems to an old
    // Batch — the canonical undated card is the correct target.
    expect(findVarietyMatch(STOCK, attrsOf(PEONY_PINK_60))?.id).toBe('sp-1');
  });

  it('returns null when no Variety has that combination', () => {
    expect(findVarietyMatch(STOCK, { type: 'Peony', colour: 'White', size: 60, cultivar: 'Sarah B.' }))
      .toBeNull();
  });

  it('treats empty Colour and a filled Colour as different Varieties (ADR-0006 strict identity)', () => {
    expect(findVarietyMatch(STOCK, { type: 'Eucalyptus' })?.id).toBe('sp-3');
    expect(findVarietyMatch(STOCK, { type: 'Eucalyptus', colour: 'Green' })?.id).toBe('sp-4');
  });

  it('refuses to match without a Type', () => {
    // Without Type there is no Variety to identify; matching on Colour alone
    // would link the line to an arbitrary card.
    expect(findVarietyMatch(STOCK, { colour: 'Pink', size: 60 })).toBeNull();
  });

  it('tolerates an empty stock list', () => {
    expect(findVarietyMatch([], { type: 'Peony' })).toBeNull();
    expect(findVarietyMatch(undefined, { type: 'Peony' })).toBeNull();
  });
});

describe('resolveVarietyLink — the ADR-0014 rule', () => {
  it('re-links and adopts the card when an edit lands on an existing Variety', () => {
    // Owner picked Peony Pink 60 then changed Size to 70 — a Variety she
    // already stocks. That is a re-pick, not a new Variety.
    const r = resolveVarietyLink(STOCK, attrsOf(PEONY_PINK_70));
    expect(r.stockItemId).toBe('sp-2');
    expect(r.adopt).toMatchObject({
      flowerName: 'Peony Pink 70cm Sarah B.',
      costPerStem: '5.2',
      sellPerStem: '16',
      lotSize: '10',
    });
  });

  it('detaches when the edit produces a combination that does not exist', () => {
    const r = resolveVarietyLink(STOCK, { type: 'Peony', colour: 'White', size: 60, cultivar: 'Sarah B.' });
    expect(r.stockItemId).toBe('');
    expect(r.matched).toBeNull();
    expect(r.adopt).toEqual({});
  });

  it('never adopts a zero cost or sell over what the Owner typed', () => {
    const r = resolveVarietyLink(STOCK, attrsOf(COST_ONLY));
    expect(r.adopt.costPerStem).toBe('2');
    expect(r.adopt).not.toHaveProperty('lotSize');  // card has none
  });

  it('suggests a sell price from markup when the card has cost but no sell', () => {
    const r = resolveVarietyLink(STOCK, attrsOf(COST_ONLY), { targetMarkup: 2.5 });
    expect(r.adopt.sellPerStem).toBe('5');
  });

  it('prefers the card\'s own sell price over the markup suggestion', () => {
    const r = resolveVarietyLink(STOCK, attrsOf(PEONY_PINK_70), { targetMarkup: 2.5 });
    expect(r.adopt.sellPerStem).toBe('16');
  });
});

describe('linkAgreesWithAttrs — the #558 invariant', () => {
  it('holds for a line linked to the card whose attrs it shows', () => {
    expect(linkAgreesWithAttrs(STOCK, 'sp-1', attrsOf(PEONY_PINK_60))).toBe(true);
  });

  it('FAILS for a line still linked to Pink while showing White', () => {
    // This is exactly #558: evaluation ignores attrs on a linked line, so the
    // White stems would be received into the Pink card.
    expect(linkAgreesWithAttrs(STOCK, 'sp-1', { ...attrsOf(PEONY_PINK_60), colour: 'White' }))
      .toBe(false);
  });

  it('holds for a detached line whatever its attrs', () => {
    expect(linkAgreesWithAttrs(STOCK, '', { type: 'Anything', colour: 'New' })).toBe(true);
  });

  it('holds after resolveVarietyLink, for both the match and the no-match path', () => {
    // The property that matters: whatever resolveVarietyLink returns, the
    // resulting (stockItemId, attrs) pair is always self-consistent.
    for (const attrs of [
      attrsOf(PEONY_PINK_60),
      attrsOf(PEONY_PINK_70),
      { type: 'Peony', colour: 'White', size: 60, cultivar: 'Sarah B.' },
      { type: 'Eucalyptus' },
      { type: 'Eucalyptus', colour: 'Green' },
      { type: 'Brand New Thing' },
    ]) {
      const { stockItemId } = resolveVarietyLink(STOCK, attrs);
      expect(linkAgreesWithAttrs(STOCK, stockItemId, attrs)).toBe(true);
    }
  });
});

describe('packages ⇄ stems', () => {
  it('derives whole packages from an exact multiple', () => {
    expect(derivePackages(40, 10)).toBe(4);
  });

  it('reports a fractional package count rather than rounding the stem count', () => {
    // 35 stems against a lot of 10 really is 3.5 packages. Rounding here would
    // either lie or silently change the Owner's stem count.
    expect(derivePackages(35, 10)).toBe(3.5);
  });

  it('returns null when there is no meaningful lot', () => {
    expect(derivePackages(40, 0)).toBeNull();
    expect(derivePackages(40, 1)).toBeNull();
  });

  it('converts packages back to stems', () => {
    expect(stemsFromPackages(4, 10)).toBe(40);
    expect(stemsFromPackages(3.5, 10)).toBe(35);
  });

  it('round-trips stems → packages → stems for exact multiples', () => {
    for (const [stems, lot] of [[40, 10], [25, 25], [120, 5], [35, 10]]) {
      expect(stemsFromPackages(derivePackages(stems, lot), lot)).toBe(stems);
    }
  });

  it('yields no stems when packages or lot are absent', () => {
    expect(stemsFromPackages(0, 10)).toBe(0);
    expect(stemsFromPackages(4, 0)).toBe(0);
  });
});
