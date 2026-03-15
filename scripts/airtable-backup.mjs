#!/usr/bin/env node
// airtable-backup.mjs — Full Airtable base backup to JSON files.
// Run: node --env-file=backend/.env.dev scripts/airtable-backup.mjs
//
// Saves each table as a JSON file under backups/YYYY-MM-DD/<TableName>.json
// Think of this as a warehouse inventory snapshot — captures the state of every
// storage area so you can restore or audit later.

import Airtable from 'airtable';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Validate credentials ──
const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  console.error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID.');
  console.error('Run with: node --env-file=backend/.env.dev scripts/airtable-backup.mjs');
  process.exit(1);
}

const base = new Airtable({ apiKey }).base(baseId);

// ── Tables to back up ──
// Each entry maps a human-readable name to the env var holding the Airtable table ID.
const TABLES = [
  { name: 'Customers',         envKey: 'AIRTABLE_CUSTOMERS_TABLE' },
  { name: 'App Orders',        envKey: 'AIRTABLE_ORDERS_TABLE' },
  { name: 'Order Lines',       envKey: 'AIRTABLE_ORDER_LINES_TABLE' },
  { name: 'Stock',             envKey: 'AIRTABLE_STOCK_TABLE' },
  { name: 'Deliveries',        envKey: 'AIRTABLE_DELIVERIES_TABLE' },
  { name: 'Stock Purchases',   envKey: 'AIRTABLE_STOCK_PURCHASES_TABLE' },
  { name: 'Stock Loss Log',    envKey: 'AIRTABLE_STOCK_LOSS_LOG_TABLE' },
  { name: 'Stock Orders',      envKey: 'AIRTABLE_STOCK_ORDERS_TABLE' },
  { name: 'Stock Order Lines', envKey: 'AIRTABLE_STOCK_ORDER_LINES_TABLE' },
  { name: 'App Config',        envKey: 'AIRTABLE_APP_CONFIG_TABLE' },
];

// ── Output directory ──
const date = new Date().toISOString().split('T')[0];
const outDir = join(__dirname, '..', 'backups', date);
mkdirSync(outDir, { recursive: true });

// ── Fetch and save each table ──
async function backupTable(tableId, label) {
  if (!tableId) {
    console.log(`  SKIP  ${label} — env var not set`);
    return 0;
  }

  const records = [];
  await base(tableId).select({ pageSize: 100 }).eachPage((page, next) => {
    for (const r of page) {
      records.push({ id: r.id, createdTime: r._rawJson.createdTime, fields: r.fields });
    }
    next();
  });

  const filename = label.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
  const filepath = join(outDir, filename);
  writeFileSync(filepath, JSON.stringify(records, null, 2), 'utf8');
  console.log(`  OK    ${label}: ${records.length} records → ${filename}`);
  return records.length;
}

// ── Main ──
console.log(`\nAirtable Backup — ${date}`);
console.log(`Output: backups/${date}/\n`);

let totalRecords = 0;
for (const t of TABLES) {
  const tableId = process.env[t.envKey];
  try {
    totalRecords += await backupTable(tableId, t.name);
  } catch (err) {
    console.error(`  FAIL  ${t.name}: ${err.message}`);
  }
}

console.log(`\nDone! ${totalRecords} total records backed up.`);
console.log(`\nTo restore: use Airtable's CSV import or the Airtable API to re-create records.`);
console.log(`Each JSON file contains { id, createdTime, fields } per record.`);
console.log(`You can POST to https://api.airtable.com/v0/{baseId}/{tableId} with the fields object.\n`);
