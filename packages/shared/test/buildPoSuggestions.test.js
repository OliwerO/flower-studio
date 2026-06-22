import { describe, it, expect } from 'vitest';
import { buildPoSuggestions } from '../utils/buildPoSuggestions.js';

// Helpers to build grouped-endpoint-shaped fixtures (GET /stock?grouped=true).
// Rows carry both PascalCase (pgToResponse) and snake_case (current_quantity, date)
// exactly as listGroupedByVariety emits them.
function orig(id, attrs = {}) {
  return {
    id, current_quantity: 0, 'Current Quantity': 0, date: null,
    'Display Name': attrs.name || 'Orig', 'Current Cost Price': attrs.cost ?? null,
    'Current Sell Price': attrs.sell ?? null, Supplier: attrs.supplier ?? '',
    'Lot Size': attrs.lotSize ?? 0, Farmer: attrs.farmer ?? '',
  };
}
function demand(id, qty, date) {
  return { id, current_quantity: -Math.abs(qty), 'Current Quantity': -Math.abs(qty), date };
}
function batch(id, qty, date, attrs = {}) {
  return {
    id, current_quantity: qty, 'Current Quantity': qty, date,
    'Current Cost Price': attrs.cost ?? null, 'Current Sell Price': attrs.sell ?? null,
    Supplier: attrs.supplier ?? '', 'Lot Size': attrs.lotSize ?? 0,
  };
}
function group(attrs, rows) {
  return {
    key: `${attrs.type_name || ''}|${attrs.colour || ''}|${attrs.size_cm ?? ''}|${attrs.cultivar || ''}`,
    type_name: attrs.type_name ?? null, colour: attrs.colour ?? null,
    size_cm: attrs.size_cm ?? null, cultivar: attrs.cultivar ?? null,
    rows, reservedForPremades: attrs.reservedForPremades ?? 0,
  };
}

describe('buildPoSuggestions', () => {
  it('suggests a genuine shortfall, attaching to the undated orig row', () => {
    const groups = [group(
      { type_name: 'Ranunculus', colour: 'Orange', size_cm: 40 },
      [orig('r-orig', { name: 'Ranunculus Orange 40cm', cost: 17.45, sell: 16 }),
       demand('r-de', 5, '2026-06-20')],
    )];
    const out = buildPoSuggestions(groups, {}, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      stockItemId: 'r-orig',          // attaches to the undated orig, not the DE
      flowerName: 'Ranunculus Orange 40cm',
      quantity: 5,                    // committed demand, nothing on hand
      costPrice: '17.45',
      sellPrice: '16',
      sellPriceManual: true,
      type: '', colour: '', size: '', cultivar: '', // identity omitted when linking to orig
    });
  });

  it('excludes a Variety fully covered by on-hand stock (Bug A)', () => {
    const groups = [group(
      { type_name: 'Lisianthus', colour: 'White', size_cm: 50 },
      [batch('l-b', 12, '2026-06-18', { cost: 18.26, sell: 14 }),
       demand('l-de', 12, '2026-06-18')],
    )];
    expect(buildPoSuggestions(groups, {}, {})).toEqual([]);
  });

  it('excludes a Variety already covered by a pending PO — even a late one (Bug B)', () => {
    const groups = [group(
      { type_name: 'Peony', colour: 'Pink', size_cm: 50 },
      [orig('p-orig', { name: 'Peony Pink 50cm' }), demand('p-de', 7, '2026-06-15')],
    )];
    // PO arrives 2026-06-16, AFTER the 2026-06-15 demand (late) — still nets in the form.
    const pendingPO = { 'p-orig': { ordered: 7, plannedDate: '2026-06-16', pos: [{ quantity: 7, plannedDate: '2026-06-16' }] } };
    expect(buildPoSuggestions(groups, pendingPO, {})).toEqual([]);
  });

  it('suggests only the residual when a pending PO partially covers the shortfall', () => {
    const groups = [group(
      { type_name: 'Peony', colour: 'Pink', size_cm: 50 },
      [orig('p-orig', { name: 'Peony Pink 50cm' }), demand('p-de', 7, '2026-06-15')],
    )];
    const pendingPO = { 'p-orig': { ordered: 3, plannedDate: '2026-06-16', pos: [{ quantity: 3, plannedDate: '2026-06-16' }] } };
    const out = buildPoSuggestions(groups, pendingPO, {});
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(4); // 7 demand − 3 incoming
  });

  it('carries Variety identity (no stockItemId) when the Variety has no undated orig', () => {
    const groups = [group(
      { type_name: 'Gypsophila', colour: 'White', size_cm: 60, cultivar: 'Xlence' },
      [demand('g-de', 5, '2026-06-22')], // DE only, no undated orig card
    )];
    const out = buildPoSuggestions(groups, {}, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      stockItemId: '',
      flowerName: 'Gypsophila White 60cm Xlence',
      quantity: 5,
      type: 'Gypsophila', colour: 'White', size: '60', cultivar: 'Xlence',
    });
  });

  it('does not suggest a Variety with no customer demand (premade-reservation only)', () => {
    const groups = [group(
      { type_name: 'Eucalyptus', colour: 'Green', size_cm: 50 },
      [orig('e-orig', { name: 'Eucalyptus' })], // onHand 0, no DE
    )];
    const premadeMap = { 'e-orig': { qty: 3 } }; // 3 stems reserved, but zero customer demand
    expect(buildPoSuggestions(groups, {}, premadeMap)).toEqual([]);
  });

  it('returns one line per short Variety and skips covered ones', () => {
    const groups = [
      group({ type_name: 'Ranunculus', colour: 'Orange', size_cm: 40 },
        [orig('r-orig', { name: 'Ranunculus Orange 40cm' }), demand('r-de', 5, '2026-06-20')]),
      group({ type_name: 'Lisianthus', colour: 'White', size_cm: 50 },
        [batch('l-b', 12, '2026-06-18'), demand('l-de', 12, '2026-06-18')]), // covered
      group({ type_name: 'Gypsophila', colour: 'White', size_cm: 60 },
        [orig('gy-orig', { name: 'Gypsophila White 60cm' }), demand('gy-de', 5, '2026-06-22')]),
    ];
    const out = buildPoSuggestions(groups, {}, {});
    expect(out.map(l => l.flowerName)).toEqual(['Ranunculus Orange 40cm', 'Gypsophila White 60cm']);
  });

  it('subtracts premade reservations from available on-hand when sizing the buy', () => {
    const groups = [group(
      { type_name: 'Hydrangea', colour: 'Blue', size_cm: 50 },
      [batch('h-b', 5, '2026-06-19'), demand('h-de', 5, '2026-06-22')], // onHand 5 vs demand 5
    )];
    const premadeMap = { 'h-b': { qty: 3 } }; // 3 of the 5 locked to premades → only 2 free
    const out = buildPoSuggestions(groups, {}, premadeMap);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3); // 5 demand − (5 onHand − 3 reserved) = 3
  });
});
