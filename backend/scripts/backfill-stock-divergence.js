#!/usr/bin/env node
// Category: DESTRUCTIVE — mutates prod Postgres `stock` + `audit_log`.
// Requires explicit owner approval phrase before run.
//
// Idempotent: runs in dry-run mode by default. Set APPLY=1 to write.
//
// Purpose: backfill stock-table divergence introduced by post-cutover code
// paths that bypassed `stockRepo` and wrote to Airtable only. After PRs
// #180/#181 fixed the code, the data still has:
//   Group A (7 rows) — return-to-stock increments that hit Airtable but not PG.
//                      Apply +diff via UPDATE on existing PG row.
//   Group B (≤14 rows) — stock cards created via PO flow on Airtable only.
//                        INSERT into PG with airtable_id matched. Skip rows
//                        that have no Display Name (BACKLOG-tracked orphans).
//
// Each write goes in its own transaction with an audit_log entry tagged
// `actor_role='system', actor_pin_label='backfill-2026-05-04'`. Re-runs are
// safe: Group A queries `WHERE airtable_id=$1 AND current_quantity<>$target`
// so a row already at target qty is a no-op; Group B uses `INSERT ... ON
// CONFLICT (airtable_id) DO NOTHING`.
//
// Usage:
//   AIRTABLE_API_KEY=... AIRTABLE_BASE_ID=... AIRTABLE_STOCK_TABLE=tblXXX \
//   DATABASE_PUBLIC_URL=postgres://... \
//   APPLY=1 node backend/scripts/backfill-stock-divergence.js

import pg from 'pg';
const { Client } = pg;

const DSN = process.env.DATABASE_PUBLIC_URL;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_STOCK_TABLE = process.env.AIRTABLE_STOCK_TABLE || 'Stock';
const APPLY = process.env.APPLY === '1';

if (!DSN) { console.error('DATABASE_PUBLIC_URL required'); process.exit(2); }
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) { console.error('AIRTABLE_API_KEY + AIRTABLE_BASE_ID required'); process.exit(2); }

// Hardcoded list confirmed by 2026-05-04 diagnose-stock-drift run.
// Re-running the diagnose script first will catch any new drift.
const GROUP_A = [
  { airtableId: 'recS40Yn6xlSN1ydY', displayName: 'Peony Pink',                  delta: 7 },
  { airtableId: 'rec87OUx7UhUZfgcB', displayName: 'Hydrangea verena (24.Apr.)',  delta: 2 },
  { airtableId: 'recN17WARGwizUGEM', displayName: 'Hydrangea White',             delta: 2 },
  { airtableId: 'recsghw6SLbkUEegK', displayName: 'Oxypetalum blue',             delta: 2 },
  { airtableId: 'recBsDhoK33S82ghb', displayName: 'Antirrhinum Yellow',          delta: 2 },
  { airtableId: 'recvhXV9sscwPEiVt', displayName: 'Hydrangea White',             delta: 1 },
  { airtableId: 'recxcCdvWiRRhq2by', displayName: 'Hydrangea Pink',              delta: 1 },
];

const GROUP_B_IDS = [
  'rec30DDlHi1IW4MVZ', 'rec7yTdWJQgQHhDvv', 'recMAZdPOQCz3MiLZ',
  'reci5k5OBr5NL3VkQ', 'recIKSFUGdEUaP3VE', 'recAZzDH0iR8xtYKZ',
  'recu65gJ2iXBkmT0Z', 'recjJRBpWpkJUsW8v', 'rec4sVoxdwiIiREzk',
  'rec9C5R2HsKkKlF4X', 'recixg3gDIT4DFrK7', 'recjUcU9FMa80f6O7',
  // Skipping recD6p1GbmrKV7mrl + recyLyXct64ksIMFY — orphans with no
  // Display Name, BACKLOG.md "Owner clean up the 2 orphan Airtable rows".
];

async function fetchAirtableRecord(id) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_STOCK_TABLE)}/${id}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
  if (!r.ok) throw new Error(`Airtable ${id} → ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { id: j.id, fields: j.fields };
}

function airtableToPgInsertColumns(rec) {
  const f = rec.fields;
  return {
    airtable_id:        rec.id,
    display_name:       f['Display Name'] || '',
    purchase_name:      f['Purchase Name'] || null,
    category:           f['Category'] || null,
    current_quantity:   Number(f['Current Quantity'] || 0),
    unit:               f['Unit'] || null,
    current_cost_price: f['Current Cost Price'] != null ? String(f['Current Cost Price']) : null,
    current_sell_price: f['Current Sell Price'] != null ? String(f['Current Sell Price']) : null,
    supplier:           f['Supplier'] || null,
    reorder_threshold:  f['Reorder Threshold'] != null ? Number(f['Reorder Threshold']) : null,
    active:             f['Active'] !== false,
    supplier_notes:     f['Supplier Notes'] || null,
    dead_stems:         Number(f['Dead/Unsold Stems'] || 0),
    lot_size:           f['Lot Size'] != null ? Number(f['Lot Size']) : null,
    farmer:             f['Farmer'] || null,
    last_restocked:     f['Last Restocked'] || null,
    substitute_for:     Array.isArray(f['Substitute For']) ? f['Substitute For'] : null,
  };
}

const ACTOR = { role: 'system', label: 'backfill-2026-05-04' };

async function applyGroupA(client, row) {
  const sel = await client.query(
    'SELECT id, current_quantity FROM stock WHERE airtable_id = $1 AND deleted_at IS NULL',
    [row.airtableId]
  );
  if (sel.rowCount !== 1) {
    return { ok: false, reason: `expected 1 PG row for ${row.airtableId}, got ${sel.rowCount}` };
  }
  const before = sel.rows[0].current_quantity;
  const after = before + row.delta;
  if (!APPLY) {
    return { ok: true, dryRun: true, before, after, delta: row.delta };
  }
  await client.query('BEGIN');
  try {
    const upd = await client.query(
      'UPDATE stock SET current_quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING current_quantity',
      [after, sel.rows[0].id]
    );
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, diff, actor_role, actor_pin_label)
       VALUES ('stock', $1, 'update', $2::jsonb, $3, $4)`,
      [
        sel.rows[0].id,
        JSON.stringify({ before: { 'Current Quantity': before }, after: { 'Current Quantity': after } }),
        ACTOR.role,
        ACTOR.label,
      ]
    );
    await client.query('COMMIT');
    return { ok: true, applied: true, before, after: upd.rows[0].current_quantity, delta: row.delta };
  } catch (e) {
    await client.query('ROLLBACK');
    return { ok: false, reason: e.message };
  }
}

async function applyGroupB(client, airtableId) {
  const exists = await client.query(
    'SELECT id FROM stock WHERE airtable_id = $1',
    [airtableId]
  );
  if (exists.rowCount > 0) {
    return { ok: true, skipped: 'already exists in PG' };
  }
  const rec = await fetchAirtableRecord(airtableId);
  const cols = airtableToPgInsertColumns(rec);
  if (!cols.display_name) {
    return { ok: false, reason: 'no Display Name on Airtable record (orphan)' };
  }
  if (!APPLY) {
    return { ok: true, dryRun: true, willInsert: { airtable_id: cols.airtable_id, display_name: cols.display_name, current_quantity: cols.current_quantity } };
  }
  await client.query('BEGIN');
  try {
    const fields = Object.keys(cols);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const values = fields.map(f => cols[f]);
    const ins = await client.query(
      `INSERT INTO stock (${fields.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (airtable_id) DO NOTHING
       RETURNING id, current_quantity, display_name`,
      values
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: true, skipped: 'race: row appeared between SELECT and INSERT' };
    }
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, diff, actor_role, actor_pin_label)
       VALUES ('stock', $1, 'create', $2::jsonb, $3, $4)`,
      [
        ins.rows[0].id,
        JSON.stringify({ before: null, after: cols }),
        ACTOR.role,
        ACTOR.label,
      ]
    );
    await client.query('COMMIT');
    return { ok: true, applied: true, inserted: { id: ins.rows[0].id, displayName: ins.rows[0].display_name, qty: ins.rows[0].current_quantity } };
  } catch (e) {
    await client.query('ROLLBACK');
    return { ok: false, reason: e.message };
  }
}

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (read-only)'}`);
  console.log('Tip: re-run with APPLY=1 to commit changes.\n');

  const c = new Client({ connectionString: DSN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    console.log('── Group A: increment existing PG rows ──');
    for (const row of GROUP_A) {
      const r = await applyGroupA(c, row);
      console.log(`  ${row.airtableId} ${row.displayName.padEnd(34)} → ${JSON.stringify(r)}`);
    }
    console.log('\n── Group B: insert missing rows from Airtable ──');
    for (const id of GROUP_B_IDS) {
      const r = await applyGroupB(c, id);
      console.log(`  ${id} → ${JSON.stringify(r)}`);
    }
  } finally {
    await c.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
