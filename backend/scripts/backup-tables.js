// backup-tables.js — exports key Airtable tables to CSV files.
// Run from backend/ dir: node scripts/backup-tables.js
// Saves to backend/backups/<date>/<tablename>.csv

import 'dotenv/config';
import Airtable from 'airtable';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const TABLES = [
  { name: 'Stock Order Lines', envKey: 'AIRTABLE_STOCK_ORDER_LINES_TABLE' },
  { name: 'Stock Orders',      envKey: 'AIRTABLE_STOCK_ORDERS_TABLE' },
  { name: 'Stock',             envKey: 'AIRTABLE_STOCK_TABLE' },
  { name: 'Clients (B2C) - MASTER', envKey: 'AIRTABLE_CUSTOMERS_TABLE' },
];

const date = new Date().toISOString().split('T')[0];
const outDir = join(__dirname, '..', 'backups', date);
mkdirSync(outDir, { recursive: true });

function escapeCsv(val) {
  if (val == null) return '';
  const s = Array.isArray(val) ? val.join(', ') : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function exportTable(tableId, label) {
  const records = [];
  await base(tableId).select({ pageSize: 100 }).eachPage((page, next) => {
    for (const r of page) records.push({ id: r.id, ...r.fields });
    next();
  });

  if (records.length === 0) {
    console.log(`  ${label}: 0 records (skipped)`);
    return;
  }

  // Collect all field names across all records
  const cols = ['id'];
  const seen = new Set(cols);
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }

  const lines = [cols.map(escapeCsv).join(',')];
  for (const r of records) {
    lines.push(cols.map(c => escapeCsv(r[c])).join(','));
  }

  const filename = label.replace(/[^a-zA-Z0-9]/g, '_') + '.csv';
  writeFileSync(join(outDir, filename), lines.join('\n'), 'utf8');
  console.log(`  ${label}: ${records.length} records → ${filename}`);
}

console.log(`Backing up to: backups/${date}/\n`);

for (const t of TABLES) {
  const tableId = process.env[t.envKey] || t.name;
  await exportTable(tableId, t.name);
}

console.log('\nDone!');
