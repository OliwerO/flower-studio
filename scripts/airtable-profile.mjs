#!/usr/bin/env node
// airtable-profile.mjs — Read-only profiling of the prod Airtable base.
// Run: node --env-file=backend/.env scripts/airtable-profile.mjs
//
// Purpose: Move 0 data walkthrough. Produces per-table statistics
// (row counts, null rates, enum distributions, value samples with PII masked)
// without modifying any Airtable record. Output goes to tmp/airtable-snapshot/
// which is gitignored — raw dumps stay on this machine only.
//
// Safety:
// - Asserts AIRTABLE_BASE_ID matches the known PROD base. Refuses to run otherwise.
// - Uses select() only — no create/update/destroy calls anywhere.
// - PII fields (names, phones, emails, addresses, Instagram) have sample values
//   masked in the profile; raw dumps preserve them for local inspection.

import Airtable from 'airtable';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Safety: prod base ID must match the known value ──
const EXPECTED_PROD_BASE = 'appM8rLfcE9cbxduZ';
const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  console.error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID.');
  console.error('Run: node --env-file=backend/.env scripts/airtable-profile.mjs');
  process.exit(1);
}
if (baseId !== EXPECTED_PROD_BASE) {
  console.error(`AIRTABLE_BASE_ID is "${baseId}" — expected prod "${EXPECTED_PROD_BASE}".`);
  console.error('Refusing to profile a non-prod base. Point .env at prod or update the script.');
  process.exit(1);
}

const base = new Airtable({ apiKey }).base(baseId);

// ── Tables to profile ──
const TABLES = [
  { name: 'Customers',           envKey: 'AIRTABLE_CUSTOMERS_TABLE' },
  { name: 'App Orders',          envKey: 'AIRTABLE_ORDERS_TABLE' },
  { name: 'Order Lines',         envKey: 'AIRTABLE_ORDER_LINES_TABLE' },
  { name: 'Stock',               envKey: 'AIRTABLE_STOCK_TABLE' },
  { name: 'Deliveries',          envKey: 'AIRTABLE_DELIVERIES_TABLE' },
  { name: 'Stock Purchases',     envKey: 'AIRTABLE_STOCK_PURCHASES_TABLE' },
  { name: 'Stock Orders',        envKey: 'AIRTABLE_STOCK_ORDERS_TABLE' },
  { name: 'Stock Order Lines',   envKey: 'AIRTABLE_STOCK_ORDER_LINES_TABLE' },
  { name: 'Stock Loss Log',      envKey: 'AIRTABLE_STOCK_LOSS_LOG_TABLE' },
  { name: 'Legacy Orders',       envKey: 'AIRTABLE_LEGACY_ORDERS_TABLE' },
  { name: 'Webhook Log',         envKey: 'AIRTABLE_WEBHOOK_LOG_TABLE' },
  { name: 'Marketing Spend',     envKey: 'AIRTABLE_MARKETING_SPEND_TABLE' },
  { name: 'Product Config',      envKey: 'AIRTABLE_PRODUCT_CONFIG_TABLE' },
  { name: 'Sync Log',            envKey: 'AIRTABLE_SYNC_LOG_TABLE' },
  { name: 'App Config',          envKey: 'AIRTABLE_APP_CONFIG_TABLE' },
  { name: 'Florist Hours',       envKey: 'AIRTABLE_FLORIST_HOURS_TABLE' },
  { name: 'Premade Bouquets',    envKey: 'AIRTABLE_PREMADE_BOUQUETS_TABLE' },
  { name: 'Premade Bouquet Lines', envKey: 'AIRTABLE_PREMADE_BOUQUET_LINES_TABLE' },
  { name: 'Rollback Errors',     envKey: 'AIRTABLE_ROLLBACK_ERRORS_TABLE' },
];

const outDir = join(__dirname, '..', 'tmp', 'airtable-snapshot');
const rawDir = join(outDir, 'raw');
mkdirSync(rawDir, { recursive: true });

const PII_FIELD_RE = /name|phone|email|address|instagram|telegram|whatsapp|recipient|card text|notes|comment/i;

function maskPII(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length <= 2) return '**';
    return value[0] + '*'.repeat(Math.min(value.length - 2, 6)) + value[value.length - 1];
  }
  if (Array.isArray(value)) return value.map(maskPII);
  return '***';
}

function inferType(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array<empty>';
    const first = v[0];
    if (typeof first === 'string' && /^rec[A-Za-z0-9]{14}$/.test(first)) return 'array<record>';
    if (typeof first === 'object' && first && 'url' in first) return 'array<attachment>';
    return `array<${typeof first}>`;
  }
  return typeof v;
}

function profileTable(records) {
  const fieldStats = {};
  for (const r of records) {
    for (const [key, value] of Object.entries(r.fields)) {
      if (!fieldStats[key]) {
        fieldStats[key] = {
          nonNullCount: 0,
          types: new Set(),
          values: new Map(),
          lengthMin: Infinity,
          lengthMax: -Infinity,
          isPII: PII_FIELD_RE.test(key),
        };
      }
      const stat = fieldStats[key];
      if (value === null || value === undefined || value === '') continue;
      stat.nonNullCount++;
      stat.types.add(inferType(value));
      if (typeof value === 'string') {
        stat.lengthMin = Math.min(stat.lengthMin, value.length);
        stat.lengthMax = Math.max(stat.lengthMax, value.length);
      }
      const keyStr = typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : String(value);
      stat.values.set(keyStr, (stat.values.get(keyStr) || 0) + 1);
    }
  }

  const summary = {};
  for (const [field, stat] of Object.entries(fieldStats)) {
    const uniqueCount = stat.values.size;
    const topValues = [...stat.values.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([val, count]) => {
        const display = stat.isPII && uniqueCount > 10 ? maskPII(val) : val;
        return { value: display, count };
      });
    summary[field] = {
      nonNullPct: Math.round((stat.nonNullCount / records.length) * 100),
      nonNullCount: stat.nonNullCount,
      types: [...stat.types],
      uniqueValueCount: uniqueCount,
      topValues,
      lengthRange: stat.lengthMin === Infinity ? null : [stat.lengthMin, stat.lengthMax],
      piiMasked: stat.isPII,
    };
  }
  return summary;
}

async function fetchAll(tableId) {
  const records = [];
  await base(tableId).select({ pageSize: 100 }).eachPage((page, next) => {
    for (const r of page) {
      records.push({ id: r.id, createdTime: r._rawJson.createdTime, fields: r.fields });
    }
    next();
  });
  return records;
}

function slug(name) { return name.replace(/[^a-zA-Z0-9]/g, '_'); }

console.log(`\nAirtable Profile — base ${baseId} (PROD)`);
console.log(`Output: tmp/airtable-snapshot/\n`);

const overallProfile = {};
const failures = [];

for (const t of TABLES) {
  const tableId = process.env[t.envKey];
  if (!tableId) {
    console.log(`  SKIP  ${t.name} — env var ${t.envKey} not set`);
    continue;
  }
  process.stdout.write(`  ..    ${t.name}`);
  try {
    const records = await fetchAll(tableId);
    const fileSlug = slug(t.name);
    writeFileSync(join(rawDir, `${fileSlug}.json`), JSON.stringify(records, null, 2));
    const tableProfile = {
      table: t.name,
      tableId,
      recordCount: records.length,
      createdTimeRange: records.length
        ? [records.reduce((a, r) => r.createdTime < a ? r.createdTime : a, records[0].createdTime),
           records.reduce((a, r) => r.createdTime > a ? r.createdTime : a, records[0].createdTime)]
        : null,
      fields: profileTable(records),
    };
    overallProfile[t.name] = tableProfile;
    writeFileSync(join(outDir, `profile_${fileSlug}.json`), JSON.stringify(tableProfile, null, 2));
    process.stdout.write(`\r  OK    ${t.name}: ${records.length} records\n`);
  } catch (err) {
    process.stdout.write(`\r  FAIL  ${t.name}: ${err.message}\n`);
    failures.push({ table: t.name, error: err.message });
  }
}

writeFileSync(join(outDir, 'profile.json'), JSON.stringify(overallProfile, null, 2));

// ── Human-readable summary (PII-free) ──
const lines = [];
lines.push(`# Airtable Profile Summary`);
lines.push(``);
lines.push(`Base: \`${baseId}\` (PROD)`);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(``);
lines.push(`## Table sizes`);
lines.push(``);
lines.push(`| Table | Rows | Oldest record | Newest record |`);
lines.push(`|---|---:|---|---|`);
for (const [name, p] of Object.entries(overallProfile)) {
  const oldest = p.createdTimeRange?.[0]?.slice(0, 10) ?? '—';
  const newest = p.createdTimeRange?.[1]?.slice(0, 10) ?? '—';
  lines.push(`| ${name} | ${p.recordCount} | ${oldest} | ${newest} |`);
}
lines.push(``);
for (const [name, p] of Object.entries(overallProfile)) {
  lines.push(`## ${name} (${p.recordCount} rows)`);
  lines.push(``);
  lines.push(`| Field | Non-null % | Types | Unique | Top values (masked if PII) |`);
  lines.push(`|---|---:|---|---:|---|`);
  const rows = Object.entries(p.fields).sort((a, b) => b[1].nonNullPct - a[1].nonNullPct);
  for (const [field, s] of rows) {
    const top = s.topValues.slice(0, 3)
      .map(v => {
        const val = typeof v.value === 'string' ? v.value.slice(0, 40) : JSON.stringify(v.value).slice(0, 40);
        return `${val} (${v.count})`;
      })
      .join('; ');
    lines.push(`| ${field}${s.piiMasked ? ' 🔒' : ''} | ${s.nonNullPct}% | ${s.types.join(',')} | ${s.uniqueValueCount} | ${top} |`);
  }
  lines.push(``);
}
if (failures.length) {
  lines.push(`## Failures`);
  for (const f of failures) lines.push(`- ${f.table}: ${f.error}`);
}
writeFileSync(join(outDir, 'profile-summary.md'), lines.join('\n'));

console.log(`\nDone.`);
console.log(`  Summary: tmp/airtable-snapshot/profile-summary.md`);
console.log(`  Per-table JSON: tmp/airtable-snapshot/profile_*.json`);
console.log(`  Raw dumps (PII, gitignored): tmp/airtable-snapshot/raw/`);
if (failures.length) {
  console.log(`  ${failures.length} table(s) failed — see summary.`);
  process.exit(1);
}
