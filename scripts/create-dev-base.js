// create-dev-base.js — Creates a clean "Blossom Dev" base with the same table
// structure as production, but NO data. Run once.
//
// Run from backend/ dir:  node ../scripts/create-dev-base.js

import 'dotenv/config';

const API_KEY = process.env.AIRTABLE_API_KEY;
const PROD_BASE = process.env.AIRTABLE_BASE_ID;

const NEEDED_TABLES = [
  'Clients (B2C)',
  'App Orders',
  'Order Lines',
  'Stock',
  'Deliveries',
  'Stock Purchases',
];

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, url, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.airtable.com/v0/${url}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`API ${method} /${url} → ${res.status}:`);
    console.error(JSON.stringify(data, null, 2));
    throw new Error(`API error ${res.status}`);
  }
  return data;
}

// Fields we can create directly — exclude computed/linked types
const SKIP_TYPES = new Set([
  'multipleRecordLinks', 'multipleLookupValues', 'rollup',
  'count', 'autoNumber', 'createdTime', 'lastModifiedTime',
  'formula', 'externalSyncSource',
]);

function buildFieldPayload(field) {
  const p = { name: field.name, type: field.type };
  if (field.options) {
    const opts = { ...field.options };
    // Remove read-only properties that can't be set on creation
    delete opts.isReversed;
    delete opts.inverseLinkFieldId;
    delete opts.prefersSingleRecordLink;
    delete opts.linkedTableId;
    delete opts.result;       // for rollup/formula
    delete opts.fieldIdInLinkedTable;
    delete opts.recordLinkFieldId;
    if (Object.keys(opts).length > 0) p.options = opts;
  }
  return p;
}

async function main() {
  console.log('=== Creating Blossom Dev Base ===\n');

  // 1. Read production schema
  console.log('1. Reading production schema...');
  const schema = await api('GET', `meta/bases/${PROD_BASE}/tables`);
  const prodTables = schema.tables.filter(t => NEEDED_TABLES.includes(t.name));
  console.log(`   ${prodTables.length} tables found\n`);

  // 2. Build table definitions (simple fields only)
  const tableDefs = prodTables.map(t => {
    const fields = t.fields
      .filter(f => !SKIP_TYPES.has(f.type))
      .map(buildFieldPayload);

    // Airtable requires at least one field per table
    if (fields.length === 0) {
      fields.push({ name: 'Name', type: 'singleLineText' });
    }

    return { name: t.name, fields };
  });

  // Debug: show what we're creating
  for (const td of tableDefs) {
    console.log(`   ${td.name}: ${td.fields.length} fields`);
    td.fields.forEach(f => console.log(`     - ${f.name} (${f.type})`));
  }

  // 3. Create the base
  console.log('\n2. Creating base...');
  let newBase;
  try {
    newBase = await api('POST', 'meta/bases', {
      name: 'Blossom Dev',
      tables: tableDefs,
    });
  } catch (err) {
    console.error('\nFailed to create base. Your API token may need the');
    console.error('"schema.bases:write" scope. Check token permissions at:');
    console.error('https://airtable.com/create/tokens\n');
    throw err;
  }

  console.log(`   Created: ${newBase.id} ("Blossom Dev")\n`);

  // Map: table name → new table ID
  const tableMap = {};
  newBase.tables.forEach(t => { tableMap[t.name] = t.id; });

  // Map: old table ID → new table ID (for resolving links)
  const idMap = {};
  prodTables.forEach(pt => {
    if (tableMap[pt.name]) idMap[pt.id] = tableMap[pt.name];
  });

  // 4. Add linked record fields
  console.log('3. Adding linked record fields...');
  for (const prodTable of prodTables) {
    const linkFields = prodTable.fields.filter(f => f.type === 'multipleRecordLinks');
    for (const field of linkFields) {
      const newLinkedTableId = idMap[field.options.linkedTableId];
      if (!newLinkedTableId) {
        console.log(`   SKIP ${prodTable.name}.${field.name} (links outside our tables)`);
        continue;
      }

      const newTableId = tableMap[prodTable.name];
      await sleep(300);
      try {
        await api('POST', `meta/bases/${newBase.id}/tables/${newTableId}/fields`, {
          name: field.name,
          type: 'multipleRecordLinks',
          options: { linkedTableId: newLinkedTableId },
        });
        console.log(`   OK ${prodTable.name}.${field.name}`);
      } catch (err) {
        console.log(`   FAIL ${prodTable.name}.${field.name}: ${err.message}`);
      }
    }
  }

  // 5. Print results
  console.log('\n=== SUCCESS ===\n');
  console.log('Paste these into backend/.env.dev:\n');
  console.log(`AIRTABLE_API_KEY=${API_KEY}`);
  console.log(`AIRTABLE_BASE_ID=${newBase.id}`);
  console.log(`AIRTABLE_CUSTOMERS_TABLE=${tableMap['Clients (B2C)']}`);
  console.log(`AIRTABLE_ORDERS_TABLE=${tableMap['App Orders']}`);
  console.log(`AIRTABLE_ORDER_LINES_TABLE=${tableMap['Order Lines']}`);
  console.log(`AIRTABLE_STOCK_TABLE=${tableMap['Stock']}`);
  console.log(`AIRTABLE_DELIVERIES_TABLE=${tableMap['Deliveries']}`);
  console.log(`AIRTABLE_STOCK_PURCHASES_TABLE=${tableMap['Stock Purchases']}`);

  console.log('\n\nProduction values (already in .env — DO NOT CHANGE):');
  console.log(`AIRTABLE_BASE_ID=${PROD_BASE}`);
  for (const name of NEEDED_TABLES) {
    const pt = prodTables.find(t => t.name === name);
    if (pt) console.log(`  ${name} → ${pt.id}`);
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
