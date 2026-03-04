// setup-dev-base.js — Populates an empty "Blossom Dev" base with the same table
// structure as production. Run once.
//
// Run from backend/ dir:  node ../scripts/setup-dev-base.js

import 'dotenv/config';

const API_KEY  = process.env.AIRTABLE_API_KEY;
const PROD_BASE = process.env.AIRTABLE_BASE_ID;
const DEV_BASE  = 'appcidaoQofrTFsVb';

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

// Field types we can create — skip computed/linked (linked added in step 2)
const SKIP_TYPES = new Set([
  'multipleRecordLinks', 'multipleLookupValues', 'rollup',
  'count', 'autoNumber', 'createdTime', 'lastModifiedTime',
  'formula', 'externalSyncSource',
]);

// Strip internal IDs from select choices — new base needs fresh options
function cleanChoices(choices) {
  if (!Array.isArray(choices)) return choices;
  return choices.map(({ name, color }) => {
    const c = { name };
    if (color) c.color = color;
    return c;
  });
}

function buildFieldPayload(field) {
  const p = { name: field.name, type: field.type };
  if (field.options) {
    const opts = { ...field.options };
    // Remove read-only / link-specific properties
    delete opts.isReversed;
    delete opts.inverseLinkFieldId;
    delete opts.prefersSingleRecordLink;
    delete opts.linkedTableId;
    delete opts.result;
    delete opts.fieldIdInLinkedTable;
    delete opts.recordLinkFieldId;
    // Strip IDs from select choices
    if (opts.choices) opts.choices = cleanChoices(opts.choices);
    if (Object.keys(opts).length > 0) p.options = opts;
  }
  return p;
}

async function main() {
  console.log('=== Setting Up Blossom Dev Base ===');
  console.log(`Production: ${PROD_BASE}`);
  console.log(`Dev:        ${DEV_BASE}\n`);

  // Step 1: Read production schema
  console.log('1. Reading production schema...');
  const schema = await api('GET', `meta/bases/${PROD_BASE}/tables`);
  const prodTables = schema.tables.filter(t => NEEDED_TABLES.includes(t.name));
  console.log(`   Found ${prodTables.length} tables\n`);

  // Step 2: Read dev base schema (has a default table we'll need to work around)
  console.log('2. Reading dev base current schema...');
  const devSchema = await api('GET', `meta/bases/${DEV_BASE}/tables`);
  console.log(`   Dev base has ${devSchema.tables.length} table(s): ${devSchema.tables.map(t => t.name).join(', ')}\n`);

  // Build map of existing dev tables
  const devTableMap = {}; // table name → dev table ID
  const existingDevTables = {};
  devSchema.tables.forEach(t => { existingDevTables[t.name] = t; });

  // Clean up junk default fields from the first table
  const firstDevTable = devSchema.tables[0];
  if (firstDevTable) {
    const prodFieldNames = new Set();
    prodTables.forEach(pt => pt.fields.forEach(f => prodFieldNames.add(f.name)));
    // Also keep "Name" since it's a valid field
    prodFieldNames.add('Name');

    const junkFields = firstDevTable.fields.filter(f =>
      !prodFieldNames.has(f.name) && f.name !== 'Name'
    );

    if (junkFields.length > 0) {
      console.log(`   Cleaning ${junkFields.length} default fields from "${firstDevTable.name}"...`);
      for (const jf of junkFields) {
        await sleep(300);
        try {
          // Can't delete the primary field, just skip it
          await api('DELETE', `meta/bases/${DEV_BASE}/tables/${firstDevTable.id}/fields/${jf.id}`);
          console.log(`   Deleted: ${jf.name}`);
        } catch (err) {
          console.log(`   WARN: could not delete ${jf.name}: ${err.message}`);
        }
      }
    }
  }

  for (let i = 0; i < prodTables.length; i++) {
    const pt = prodTables[i];
    const simpleFields = pt.fields
      .filter(f => !SKIP_TYPES.has(f.type))
      .map(buildFieldPayload);

    // Check if this table already exists in dev
    const existingTable = existingDevTables[pt.name];

    if (existingTable) {
      // Table exists — just add missing fields
      console.log(`${i + 3}. Table "${pt.name}" exists, adding missing fields...`);
      const existingFieldNames = new Set(existingTable.fields.map(f => f.name));

      for (const field of simpleFields) {
        if (existingFieldNames.has(field.name)) continue; // already exists
        await sleep(300);
        try {
          await api('POST', `meta/bases/${DEV_BASE}/tables/${existingTable.id}/fields`, field);
          console.log(`   + ${field.name}`);
        } catch (err) {
          console.log(`   WARN: ${field.name}: ${err.message}`);
        }
      }
      devTableMap[pt.name] = existingTable.id;
      console.log(`   OK: ${pt.name} → ${existingTable.id}\n`);
    } else {
      // Create new table
      console.log(`${i + 3}. Creating table "${pt.name}"...`);
      const fields = simpleFields.length > 0 ? simpleFields : [{ name: 'Name', type: 'singleLineText' }];

      await sleep(300);
      const newTable = await api('POST', `meta/bases/${DEV_BASE}/tables`, {
        name: pt.name,
        fields,
      });
      devTableMap[pt.name] = newTable.id;
      console.log(`   OK: ${pt.name} → ${newTable.id} (${fields.length} fields)\n`);
    }
  }

  // Step 3: Add linked record fields
  console.log('Adding linked record fields...');

  // Map old prod table IDs → new dev table IDs
  const idMap = {};
  prodTables.forEach(pt => {
    if (devTableMap[pt.name]) idMap[pt.id] = devTableMap[pt.name];
  });

  for (const prodTable of prodTables) {
    const linkFields = prodTable.fields.filter(f => f.type === 'multipleRecordLinks');
    for (const field of linkFields) {
      const newLinkedTableId = idMap[field.options.linkedTableId];
      if (!newLinkedTableId) {
        console.log(`  SKIP ${prodTable.name}.${field.name} (links outside our tables)`);
        continue;
      }

      const devTableId = devTableMap[prodTable.name];
      await sleep(300);
      try {
        await api('POST', `meta/bases/${DEV_BASE}/tables/${devTableId}/fields`, {
          name: field.name,
          type: 'multipleRecordLinks',
          options: { linkedTableId: newLinkedTableId },
        });
        console.log(`  OK ${prodTable.name}.${field.name}`);
      } catch (err) {
        console.log(`  FAIL ${prodTable.name}.${field.name}: ${err.message}`);
      }
    }
  }

  // Step 4: Print .env.dev values
  console.log('\n=== SUCCESS ===\n');
  console.log('backend/.env.dev values:\n');
  console.log(`AIRTABLE_API_KEY=${API_KEY}`);
  console.log(`AIRTABLE_BASE_ID=${DEV_BASE}`);
  console.log(`AIRTABLE_CUSTOMERS_TABLE=${devTableMap['Clients (B2C)']}`);
  console.log(`AIRTABLE_ORDERS_TABLE=${devTableMap['App Orders']}`);
  console.log(`AIRTABLE_ORDER_LINES_TABLE=${devTableMap['Order Lines']}`);
  console.log(`AIRTABLE_STOCK_TABLE=${devTableMap['Stock']}`);
  console.log(`AIRTABLE_DELIVERIES_TABLE=${devTableMap['Deliveries']}`);
  console.log(`AIRTABLE_STOCK_PURCHASES_TABLE=${devTableMap['Stock Purchases']}`);
  console.log(`\nANTHROPIC_API_KEY=`);
  console.log(`WIX_WEBHOOK_SECRET=`);
  console.log(`PIN_OWNER=1234`);
  console.log(`PIN_FLORIST=5678`);
  console.log(`PIN_DRIVER=9012`);
  console.log(`PORT=3001`);
  console.log(`NODE_ENV=development`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
