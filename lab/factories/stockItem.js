// lab/factories/stockItem.js
//
// Synthetic Stock Item — matches backend/src/db/schema.js `stock` table.
// Two shapes per CONTEXT.md "Stock Item":
//   - Batch (default): variety name + arrival-date suffix "(DD.Mmm.)"
//   - Demand Entry (type='demand'): variety name only, current_quantity < 0
//
// Schema: id, airtable_id, display_name, purchase_name, category,
//         current_quantity, unit, current_cost_price, current_sell_price,
//         supplier, reorder_threshold, active, supplier_notes, dead_stems,
//         lot_size, farmer, last_restocked, substitute_for,
//         date, type_name, colour, size_cm, cultivar,
//         created_at, updated_at, deleted_at

import { faker } from '@faker-js/faker';

const VARIETIES = [
  'Pink Peonies', 'White Roses', 'Red Roses', 'Yellow Tulips',
  'Eucalyptus', 'Lisianthus', 'Hydrangea', 'Ranunculus',
  'Anemone', 'Carnations', 'Chrysanthemum', 'Gypsophila',
];

function dateSuffix(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = d.toLocaleString('en-GB', { month: 'short' });
  // Capitalize first letter: "may" → "May"
  const mmmCapitalized = mmm.charAt(0).toUpperCase() + mmm.slice(1);
  return `(${dd}.${mmmCapitalized}.)`;
}

export function makeStockItem(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { type = 'batch', variety: varietyOverride, arrivalDate: arrivalDateOverride, ...columnOverrides } = overrides;

  const variety = varietyOverride ?? faker.helpers.arrayElement(VARIETIES);
  const arrivalDate = arrivalDateOverride ?? faker.date.recent({ days: 7 });

  // For demand entries, the display_name may be provided directly via columnOverrides.
  // If not, derive from variety (no date suffix for demand entries).
  // For dated-demand entries, build a full Variety display name per ADR-0006:
  // "<Type> <Colour> <Size>cm <Cultivar?> (<Date>)"
  function buildDatedDemandName() {
    const tn = columnOverrides.type_name ?? variety.split(' ')[0];
    const parts = [tn];
    if (columnOverrides.colour)   parts.push(columnOverrides.colour);
    if (columnOverrides.size_cm)  parts.push(`${columnOverrides.size_cm}cm`);
    if (columnOverrides.cultivar) parts.push(columnOverrides.cultivar);
    parts.push(`(${columnOverrides.date ?? new Date().toISOString().split('T')[0]})`);
    return parts.join(' ');
  }

  const display_name = columnOverrides.display_name !== undefined
    ? columnOverrides.display_name
    : type === 'dated-demand'
      ? buildDatedDemandName()
      : type === 'demand'
        ? variety
        : `${variety} ${dateSuffix(arrivalDate)}`;

  const current_quantity = columnOverrides.current_quantity !== undefined
    ? columnOverrides.current_quantity
    : type === 'demand' || type === 'dated-demand'
      ? -faker.number.int({ min: 5, max: 30 })
      : faker.number.int({ min: 0, max: 100 });

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    display_name,
    purchase_name: null,
    category: faker.helpers.arrayElement(['Flowers', 'Greenery', 'Filler', null]),
    current_quantity,
    unit: faker.helpers.arrayElement(['stem', 'bunch', null]),
    current_cost_price: Number(faker.commerce.price({ min: 3, max: 20 })),
    current_sell_price: Number(faker.commerce.price({ min: 8, max: 60 })),
    supplier: faker.helpers.arrayElement(['Ekipa', 'Hurt', 'Direct', null]),
    reorder_threshold: null,
    active: true,
    supplier_notes: null,
    dead_stems: 0,
    lot_size: null,
    farmer: null,
    last_restocked: null,
    substitute_for: null,
    // ── Stock Y-model identity columns (issue #284) ────────────
    // Default null so existing scenarios behave identically. Pass any
    // of these in `overrides` to produce a Variety-shaped row.
    // For 'dated-demand', type_name and date are required — derive from variety if not supplied.
    date:      type === 'dated-demand' ? (columnOverrides.date ?? new Date().toISOString().split('T')[0]) : null,
    type_name: type === 'dated-demand' ? (columnOverrides.type_name ?? variety.split(' ')[0]) : null,
    colour:    null,
    size_cm:   null,
    cultivar:  null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last, excluding already-handled keys.
    ...columnOverrides,
    // Ensure derived values are always correct even if columnOverrides re-set them.
    display_name,
    current_quantity,
  };
}
