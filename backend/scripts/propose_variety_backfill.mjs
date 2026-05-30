// SAFE — read-only via claude_ro DSN. #329 Tier-1 mapping proposal.
//
// Proposes Variety 4-tuple attrs for the rows that MUST be backfilled before
// the Y-model cutover (#291): NULL type_name AND not deleted AND
// (nonzero qty OR active-order consumer OR premade reservation).
//
// Two sources per row, in priority order:
//   1. Authoritative — a stock_order_line (PO line, #304) linked by stock_id
//      that carries non-null Variety attrs. Owner already entered these.
//   2. Heuristic — parse display_name (strip date suffix, first token = Type
//      with synonym normalization, colour lexicon, remainder = cultivar).
//
// Output: a review table + a JSON array the owner can approve in the Variety
// Backfill UI (or feed to PATCH /stock/variety-attrs/bulk). NEVER writes.
//
// Run: CLAUDE_RO_URL=... node backend/scripts/propose_variety_backfill.mjs
import pg from 'pg';

const TYPE_SYNONYMS = {
  paeonia: 'Peony', peony: 'Peony', peonies: 'Peony',
  rosa: 'Rose', rose: 'Rose',
  hydrangea: 'Hydrangea',
  oxypetalum: 'Oxypetalum',
  freesia: 'Freesia',
  dianthus: 'Dianthus',
  lisianthus: 'Lisianthus',
  matthiola: 'Matthiola',
  syringa: 'Syringa',
  antirrhinum: 'Antirrhinum',
  tulip: 'Tulip', tulipa: 'Tulip',
};
const COLOURS = ['pink', 'white', 'blue', 'red', 'lavender', 'lilac', 'green',
  'yellow', 'coral', 'orange', 'purple', 'cream', 'peach', 'mix'];

function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

function parseName(name) {
  // Strip a trailing "(DD.Mon.)" date tag.
  const base = name.replace(/\s*\(\d{1,2}\.\w{3,4}\.?\)\s*$/, '').trim();
  const tokens = base.split(/\s+/);
  const lower = tokens.map(t => t.toLowerCase());

  // Type = first token, normalized via synonyms (else title-cased first token).
  const typeRaw = lower[0];
  const type = TYPE_SYNONYMS[typeRaw] ?? titleCase(tokens[0]);

  // Colour = first lexicon hit anywhere after the type token.
  let colour = null, colourIdx = -1;
  for (let i = 1; i < lower.length; i++) {
    if (COLOURS.includes(lower[i])) { colour = titleCase(tokens[i]); colourIdx = i; break; }
  }

  // Cultivar = remaining middle tokens (between type and colour, or after type
  // if no colour), title-cased. Heuristic — owner must confirm.
  const rest = tokens.slice(1).filter((_, i) => (i + 1) !== colourIdx);
  const cultivar = rest.length ? rest.map(titleCase).join(' ') : null;

  const known = !!TYPE_SYNONYMS[typeRaw];
  const confidence = known && colour ? 'med' : known ? 'low' : 'low';
  return { type, colour, size_cm: null, cultivar, confidence };
}

const c = new pg.Client({ connectionString: process.env.CLAUDE_RO_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const rows = await c.query(`
  WITH n AS (SELECT id, display_name, current_quantity FROM stock WHERE type_name IS NULL AND deleted_at IS NULL)
  SELECT DISTINCT n.id, n.display_name, n.current_quantity
  FROM n
  WHERE n.current_quantity <> 0
     OR EXISTS (SELECT 1 FROM order_lines ol JOIN orders o ON o.id = ol.order_id
                WHERE ol.stock_item_id = n.id::text AND ol.deleted_at IS NULL AND o.deleted_at IS NULL
                  AND o.status NOT IN ('Delivered','Picked Up','Cancelled'))
     OR EXISTS (SELECT 1 FROM premade_bouquet_lines pl WHERE pl.stock_id = n.id)
  ORDER BY n.current_quantity
`);

const proposals = [];
for (const r of rows.rows) {
  // Authoritative source: a PO line linked by stock_id with non-null attrs.
  const po = await c.query(
    `SELECT type_name, colour, size_cm, cultivar FROM stock_order_lines
     WHERE stock_id = $1 AND type_name IS NOT NULL
     ORDER BY id DESC LIMIT 1`, [r.id]);
  let proposal, source;
  if (po.rows[0]) {
    const p = po.rows[0];
    proposal = { type: p.type_name, colour: p.colour, size_cm: p.size_cm, cultivar: p.cultivar, confidence: 'high' };
    source = 'PO-line';
  } else {
    proposal = parseName(r.display_name);
    source = 'name-parse';
  }
  proposals.push({ id: r.id, display_name: r.display_name, qty: r.current_quantity, source, ...proposal });
}

console.log(`\n#329 Tier-1 proposals (${proposals.length} rows that MUST be backfilled):\n`);
console.log('qty  | conf | source     | proposed Type|Colour|Size|Cultivar         <= display_name');
console.log('-----|------|------------|--------------------------------------------------------------');
for (const p of proposals) {
  const key = [p.type ?? '', p.colour ?? '', p.size_cm ?? '', p.cultivar ?? ''].join('|');
  console.log(
    String(p.qty).padStart(4), '|',
    (p.confidence ?? '').padEnd(4), '|',
    p.source.padEnd(10), '|',
    key.padEnd(38), '<=', p.display_name);
}
console.log('\n--- JSON (for owner review / bulk apply) ---');
console.log(JSON.stringify(proposals, null, 2));
await c.end();
