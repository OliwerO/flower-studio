/**
 * poLineVariety — pure logic behind the unified Stock Order line form
 * (`PoLineForm`). Two concerns, both deliberately kept out of the component so
 * they can be tested directly:
 *
 *   1. Packages ⇄ Stems. Packages is DERIVED, never stored (ADR: plan
 *      2026-07-29, D1). `quantity_needed` is the single stored quantity that
 *      evaluation, FEFO and settlement all read; Packages is reconstructed from
 *      it for display wherever a Lot Size exists.
 *
 *   2. Variety re-resolution (ADR-0014). Editing any of the four Variety attrs
 *      on a line re-matches the whole tuple against loaded stock: a match
 *      re-links the line to that Stock Item, no match detaches it.
 *
 * The invariant these exist to protect: a line NEVER carries a Stock Item link
 * whose Variety differs from the attrs displayed on it. `stockOrderService.js`
 * skips Variety resolution entirely when a line is linked (`if (!stockItemId
 * && ...)`), so a linked-but-edited line receives stems into the WRONG card —
 * that is issue #558, which needed a manual prod repair.
 */

import parseBatchName from './parseBatchName.js';
import { varietyKey, varietyDisplayName } from './varietyKey.js';

/** '' / undefined / whitespace-only → null. Mirrors varietyKey's `norm`. */
const normText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** '' / null / non-numeric → null. 0 is a valid size (ADR-0006 renders "0cm"). */
const normSize = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Form-state attrs ({ type, colour, size, cultivar }) → varietyKey tuple shape.
 * This is the shape the PO line form and the `stock_order_lines` wire format use.
 */
export function lineAttrsToTuple(attrs = {}) {
  return {
    type_name: normText(attrs.type ?? attrs.Type),
    colour:    normText(attrs.colour ?? attrs.Colour),
    size_cm:   normSize(attrs.size ?? attrs.Size),
    cultivar:  normText(attrs.cultivar ?? attrs.Cultivar),
  };
}

/**
 * Stock wire row ({ Type, Colour, Size, Cultivar }) → varietyKey tuple shape.
 * Dual-reads snake_case so it works against both the REST wire format and raw
 * grouped rows, matching the convention in NewVarietyFields.
 */
export function stockItemToTuple(item = {}) {
  return {
    type_name: normText(item.Type ?? item.type_name),
    colour:    normText(item.Colour ?? item.colour),
    size_cm:   normSize(item.Size ?? item.size_cm),
    cultivar:  normText(item.Cultivar ?? item.cultivar),
  };
}

/**
 * Find the Stock Item whose Variety exactly matches `attrs`, per ADR-0006
 * strict identity (null-aware — empty Colour and Colour="Green" are different
 * Varieties and must never coalesce).
 *
 * Type is required: without it there is no Variety to match, so this returns
 * null rather than matching every attr-less row.
 *
 * When several Stock Items share the Variety (an undated Demand Entry plus one
 * or more dated Batches), the UNDATED row wins — it is the Variety's canonical
 * card and the one `buildPoSuggestions` links shortfall lines to. Linking a PO
 * line to a dated Batch would bind next week's purchase to last week's arrival.
 *
 * @param {Array<object>} stockItems  Stock wire rows.
 * @param {object} attrs              Form attrs { type, colour, size, cultivar }.
 * @returns {object|null}
 */
export function findVarietyMatch(stockItems, attrs) {
  const tuple = lineAttrsToTuple(attrs);
  if (!tuple.type_name) return null;

  const wanted = varietyKey(tuple);
  const matches = (stockItems || []).filter(
    (s) => varietyKey(stockItemToTuple(s)) === wanted,
  );
  if (matches.length === 0) return null;

  const undated = matches.find(
    (s) => parseBatchName(s['Display Name'] || '').batch === null,
  );
  return undated || matches[0];
}

/**
 * The ADR-0014 rule, as a pure function.
 *
 * Given the attrs now showing on the line, decide what the line's Stock Item
 * link and adopted card fields should be:
 *   - a Variety match  → re-link to it and adopt its name/prices/lot/supplier
 *   - no match         → detach (stockItemId: '') and keep the typed attrs
 *
 * `adopt` is only populated on a match, and only with values the card actually
 * carries — a card with no cost must not blank a cost the Owner already typed.
 * Callers merge `adopt` over their existing form state.
 *
 * @param {Array<object>} stockItems
 * @param {object} attrs                 { type, colour, size, cultivar }
 * @param {{targetMarkup?: number}} opts  Used to suggest a sell price when the
 *                                        matched card has a cost but no sell.
 * @returns {{ matched: object|null, stockItemId: string, adopt: object }}
 */
export function resolveVarietyLink(stockItems, attrs, { targetMarkup } = {}) {
  const matched = findVarietyMatch(stockItems, attrs);
  if (!matched) {
    // Detaching must also drop the name the old card supplied. Otherwise a
    // line whose Colour was changed Pink → White keeps reading "Peony Pink
    // 60cm", and since evaluation names a brand-new Variety from the line's
    // Flower Name, it would create a WHITE peony card called "Peony Pink 60cm".
    const tuple = lineAttrsToTuple(attrs);
    const composed = tuple.type_name ? varietyDisplayName(tuple) : '';
    return {
      matched: null,
      stockItemId: '',
      adopt: composed ? { flowerName: composed } : {},
    };
  }

  const cost = Number(matched['Current Cost Price']) || 0;
  const sell = Number(matched['Current Sell Price']) || 0;
  const lot  = Number(matched['Lot Size']) || 0;

  const adopt = { flowerName: matched['Display Name'] || '' };
  if (cost > 0) adopt.costPerStem = String(cost);
  if (sell > 0) {
    adopt.sellPerStem = String(sell);
  } else if (cost > 0 && targetMarkup) {
    adopt.sellPerStem = String(Math.round(cost * targetMarkup));
  }
  if (lot > 0) adopt.lotSize = String(lot);
  if (matched.Supplier) adopt.supplier = matched.Supplier;
  if (matched.Farmer)   adopt.farmer   = matched.Farmer;

  return { matched, stockItemId: matched.id, adopt };
}

/**
 * Packages shown for a given stem count. Null when Lot Size is absent or 1 —
 * loose stems have no meaningful package count and the field is hidden.
 *
 * Deliberately NOT rounded to a whole number: if the Owner types 35 stems
 * against a lot of 10, "3.5 packages" is the truth. Rounding here would either
 * silently change her stem count or display a lie. One decimal place, with a
 * trailing .0 trimmed.
 */
export function derivePackages(stems, lotSize) {
  const ls = Number(lotSize) || 0;
  const n  = Number(stems) || 0;
  if (ls <= 1) return null;
  return Math.round((n / ls) * 10) / 10;
}

/** Stems implied by a package count. Packages is the input; stems is stored. */
export function stemsFromPackages(packages, lotSize) {
  const ls = Number(lotSize) || 0;
  const p  = Number(packages) || 0;
  if (ls <= 1 || p <= 0) return 0;
  return Math.round(p * ls);
}

/** Every canonical field, paired with the API field it maps to. */
const API_FIELDS = {
  flowerName:  'Flower Name',
  stockItemId: 'Stock Item',
  supplier:    'Supplier',
  farmer:      'Farmer',
  notes:       'Notes',
  lotSize:     'Lot Size',
  qty:         'Quantity Needed',
  costPerStem: 'Cost Price',
  sellPerStem: 'Sell Price',
  type:        'Type',
  colour:      'Colour',
  size:        'Size',
  cultivar:    'Cultivar',
};

/** A persisted PO line (Airtable-shaped wire format) → PoLineForm's shape. */
export function apiLineToCanonical(line = {}) {
  const stockItem = Array.isArray(line['Stock Item']) ? line['Stock Item'][0] : null;
  return {
    flowerName:  line['Flower Name'] || '',
    stockItemId: stockItem || '',
    supplier:    line.Supplier || '',
    farmer:      line.Farmer || '',
    notes:       line.Notes || '',
    lotSize:     String(Number(line['Lot Size']) || 0),
    qty:         String(Number(line['Quantity Needed']) || 0),
    costPerStem: Number(line['Cost Price']) ? String(Number(line['Cost Price'])) : '',
    sellPerStem: Number(line['Sell Price']) ? String(Number(line['Sell Price'])) : '',
    type:        line.Type || '',
    colour:      line.Colour || '',
    size:        line.Size != null ? String(line.Size) : '',
    cultivar:    line.Cultivar || '',
  };
}

/** One canonical field → its API representation. */
function apiValue(key, c) {
  switch (key) {
    case 'stockItemId': return c.stockItemId ? [c.stockItemId] : [];
    case 'lotSize':     return Number(c.lotSize) || 0;
    case 'qty':         return Number(c.qty) || 0;
    case 'costPerStem': return Number(c.costPerStem) || 0;
    case 'sellPerStem': return Number(c.sellPerStem) || 0;
    // Variety attrs are nullable: '' must reach the API as NULL, not '', or the
    // 4-tuple stops being NULL-aware and strict identity breaks (ADR-0006).
    case 'size':        return c.size !== '' && c.size != null ? Number(c.size) : null;
    case 'type':
    case 'colour':
    case 'cultivar':    return String(c[key] || '').trim() || null;
    default:            return c[key] ?? '';
  }
}

/** Canonical line → the full API field set (used when creating a line). */
export function canonicalToApiFields(c = {}) {
  const out = {};
  for (const key of Object.keys(API_FIELDS)) out[API_FIELDS[key]] = apiValue(key, c);
  return out;
}

/**
 * API fields for the canonical keys that actually changed.
 *
 * The Draft line editor flushes on blur rather than per keystroke, so it needs
 * to send a diff — PATCHing every field on every edit would let a stale value
 * from one field clobber a concurrent change to another.
 */
export const IDENTITY_KEYS = ['flowerName', 'stockItemId', 'type', 'colour', 'size', 'cultivar'];

export function canonicalDiffToApiFields(prev = {}, next = {}, { omitIdentity = false } = {}) {
  const out = {};
  for (const key of Object.keys(API_FIELDS)) {
    // A locked line 409s on ANY identity write (#593), including one that only
    // looks like a change because of a formatting difference. The form already
    // renders identity read-only there, so never send it.
    if (omitIdentity && IDENTITY_KEYS.includes(key)) continue;
    if (String(prev[key] ?? '') === String(next[key] ?? '')) continue;
    out[API_FIELDS[key]] = apiValue(key, next);
  }
  return out;
}

/**
 * Does this line's Stock Item link agree with the attrs displayed on it?
 *
 * The #558 invariant, expressed so tests can assert it directly and callers can
 * assert it defensively. A line that fails this check will receive stems into
 * the wrong Stock Item at evaluation.
 */
export function linkAgreesWithAttrs(stockItems, stockItemId, attrs) {
  if (!stockItemId) return true;             // detached — nothing to disagree with
  const linked = (stockItems || []).find((s) => s.id === stockItemId);
  if (!linked) return true;                  // unknown card (not yet loaded) — can't judge
  return varietyKey(stockItemToTuple(linked)) === varietyKey(lineAttrsToTuple(attrs));
}
