#!/usr/bin/env node
// Category: SAFE — read-only. Pulls Airtable Stock snapshot + Postgres stock
// snapshot via CLAUDE_RO_URL, prints rows where the two diverge.
//
// Usage:
//   AIRTABLE_API_KEY=... AIRTABLE_BASE_ID=... AIRTABLE_STOCK_TABLE=... \
//   CLAUDE_RO_URL=... node backend/scripts/diagnose-stock-drift.js
//
// Output: TSV — airtable_id  display_name  airtable_qty  pg_qty  diff
// Diff sign: positive = Airtable higher than PG (likely missed bypassed-write
// increment, e.g. premade return-to-stock); negative = PG higher (legit PG
// write since cutover that Airtable didn't get, or premade-create deduct that
// only landed on Airtable).

import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

const CLAUDE_RO_URL = process.env.CLAUDE_RO_URL;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_STOCK_TABLE = process.env.AIRTABLE_STOCK_TABLE || 'Stock';

if (!CLAUDE_RO_URL) { console.error('CLAUDE_RO_URL required'); process.exit(2); }
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) { console.error('AIRTABLE_API_KEY + AIRTABLE_BASE_ID required'); process.exit(2); }

async function fetchAirtableStock() {
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_STOCK_TABLE)}?${params}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j = await r.json();
    for (const rec of j.records) {
      out.push({
        id: rec.id,
        displayName: rec.fields['Display Name'] || '',
        qty: Number(rec.fields['Current Quantity'] || 0),
      });
    }
    offset = j.offset;
  } while (offset);
  return out;
}

async function fetchPgStock() {
  const c = new Client({ connectionString: CLAUDE_RO_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(
      'select airtable_id, display_name, current_quantity from stock where deleted_at is null'
    );
    return rows.map(r => ({
      id: r.airtable_id,
      displayName: r.display_name || '',
      qty: Number(r.current_quantity || 0),
    }));
  } finally {
    await c.end();
  }
}

(async () => {
  const [at, pgRows] = await Promise.all([fetchAirtableStock(), fetchPgStock()]);
  const pgById = new Map(pgRows.map(r => [r.id, r]));
  const atById = new Map(at.map(r => [r.id, r]));
  const allIds = new Set([...pgById.keys(), ...atById.keys()]);

  const drifted = [];
  for (const id of allIds) {
    const a = atById.get(id);
    const p = pgById.get(id);
    if (!a) { drifted.push({ id, displayName: p.displayName, atQty: null, pgQty: p.qty, diff: 'pg-only' }); continue; }
    if (!p) { drifted.push({ id, displayName: a.displayName, atQty: a.qty, pgQty: null, diff: 'at-only' }); continue; }
    if (a.qty !== p.qty) drifted.push({ id, displayName: p.displayName || a.displayName, atQty: a.qty, pgQty: p.qty, diff: a.qty - p.qty });
  }

  drifted.sort((x, y) => {
    const dx = typeof x.diff === 'number' ? x.diff : -Infinity;
    const dy = typeof y.diff === 'number' ? y.diff : -Infinity;
    return dy - dx;
  });

  console.log('airtable_id\tdisplay_name\tat_qty\tpg_qty\tdiff');
  for (const r of drifted) {
    console.log(`${r.id}\t${r.displayName}\t${r.atQty ?? ''}\t${r.pgQty ?? ''}\t${r.diff}`);
  }
  console.log(`\n# total airtable rows: ${at.length}`);
  console.log(`# total pg rows:       ${pgRows.length}`);
  console.log(`# divergent rows:      ${drifted.length}`);
  console.log(`# rows where at>pg:    ${drifted.filter(r => typeof r.diff === 'number' && r.diff > 0).length}`);
  console.log(`# rows where pg>at:    ${drifted.filter(r => typeof r.diff === 'number' && r.diff < 0).length}`);
})().catch(e => { console.error(e); process.exit(1); });
