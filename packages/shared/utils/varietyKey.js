/**
 * Variety identity helpers per ADR-0006.
 * 4-tuple: (type_name, colour?, size_cm?, cultivar?). NULL-aware strict identity.
 * Empty strings normalized to null defensively.
 *
 * Consumed by: picker grouping, Stock list collapse, future migration scripts.
 */

/** Normalize empty/undefined to null so the 4-tuple key is stable. */
const norm = (v) => (v === '' || v === undefined ? null : v);

/**
 * Serialize a stock row's 4-tuple into a deterministic string key.
 * NULL and empty string are both serialized as '' (empty segment).
 * 'Green' !== '' so Eucalyptus|Green| !== Eucalyptus|| — strict identity preserved.
 *
 * @param {{ type_name: string, colour?: string|null, size_cm?: number|null, cultivar?: string|null }} row
 * @returns {string}  e.g. 'Rose|Pink|60|' or 'Eucalyptus|||'
 */
export function varietyKey(row) {
  return [
    norm(row.type_name) ?? '',
    norm(row.colour) ?? '',
    norm(row.size_cm) != null ? norm(row.size_cm) : '',
    norm(row.cultivar) ?? '',
  ].join('|');
}

/**
 * Bucket an array of stock rows by Variety 4-tuple.
 *
 * @param {Array<object>} rows  Stock Item rows with 4-tuple fields.
 * @returns {Map<string, { key: string, type_name: string|null, colour: string|null, size_cm: number|null, cultivar: string|null, rows: Array<object> }>}
 */
export function groupByVariety(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = varietyKey(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        type_name: norm(row.type_name),
        colour: norm(row.colour),
        size_cm: norm(row.size_cm),
        cultivar: norm(row.cultivar),
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }
  return map;
}

/**
 * Render a human-readable display name for a Variety.
 * Format: `<Type> <Colour?> <Size?>cm <Cultivar?>` — empty parts omitted.
 * Cultivar shown only when non-null (ADR-0006 visibility rule).
 * size_cm=0 is treated as a valid size and rendered as "0cm".
 *
 * @param {{ type_name: string, colour?: string|null, size_cm?: number|null, cultivar?: string|null }} v
 * @returns {string}
 */
export function varietyDisplayName(v) {
  const parts = [];
  const type = norm(v.type_name);
  if (type) parts.push(type);
  const colour = norm(v.colour);
  if (colour) parts.push(colour);
  const size = norm(v.size_cm);
  if (size != null) parts.push(`${size}cm`);
  const cultivar = norm(v.cultivar);
  if (cultivar) parts.push(cultivar);
  return parts.join(' ');
}
