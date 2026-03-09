// Deletes all orders from today that have "pink roses" or "test" as Customer Request
// Run: node scripts/cleanup-test-orders.js

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appM8rLfcE9cbxduZ';
const ORDERS_TABLE = process.env.AIRTABLE_ORDERS_TABLE || 'tbljPQgczS1zglRE3';

if (!API_KEY) {
  console.error('Missing AIRTABLE_API_KEY. Run with: AIRTABLE_API_KEY=pat_xxx node scripts/cleanup-test-orders.js');
  process.exit(1);
}

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return res.json();
}

async function airtableDelete(tableId, recordId) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  return res.json();
}

async function main() {
  console.log('Fetching orders...');
  const today = new Date().toISOString().split('T')[0];

  const data = await airtableGet(`${ORDERS_TABLE}?filterByFormula=NOT(IS_BEFORE({Order Date},'${today}'))`);
  const records = data.records || [];

  console.log(`Found ${records.length} orders from today:\n`);
  records.forEach(r => {
    console.log(`  [${r.id}] "${r.fields['Customer Request'] || '—'}" | Customer: ${r.fields['Customer'] || 'none'}`);
  });

  const toDelete = records.filter(r => {
    const req = (r.fields['Customer Request'] || '').toLowerCase();
    return req === 'pink roses' || req === 'test' || req === '';
  });

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log(`\nDeleting ${toDelete.length} test/duplicate records...`);
  for (const r of toDelete) {
    await airtableDelete(ORDERS_TABLE, r.id);
    console.log(`  ✓ Deleted ${r.id} ("${r.fields['Customer Request'] || '—'}")`);
  }
  console.log('\nDone.');
}

main().catch(console.error);
