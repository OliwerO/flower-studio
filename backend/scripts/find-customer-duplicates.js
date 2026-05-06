// backend/scripts/find-customer-duplicates.js
// Category: SAFE
// Reads Clients (B2C) from Airtable (no writes). Groups by exact-match phone
// then exact-match email to surface likely duplicate pairs. Owner reviews
// and merges in the Airtable UI. Re-run until output says "0 suspected pairs".
//
// Usage: node backend/scripts/find-customer-duplicates.js

import 'dotenv/config';
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const CUSTOMERS_TABLE = process.env.AIRTABLE_CUSTOMERS_TABLE;
if (!CUSTOMERS_TABLE) {
  console.error('AIRTABLE_CUSTOMERS_TABLE env var required');
  process.exit(1);
}

async function fetchAll() {
  const rows = [];
  await base(CUSTOMERS_TABLE).select({
    fields: ['Name', 'Nickname', 'Phone', 'Email'],
  }).eachPage((records, next) => {
    for (const r of records) {
      rows.push({ id: r.id, name: r.get('Name') || r.get('Nickname') || '(unnamed)', phone: r.get('Phone') || '', email: r.get('Email') || '' });
    }
    next();
  });
  return rows;
}

function findDuplicates(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

const rows = await fetchAll();
console.log(`Fetched ${rows.length} customer records.\n`);

const byPhone = findDuplicates(rows, r => {
  const digits = r.phone.replace(/\D/g, '');
  // normalize common Polish prefixes: +48, 0048, 48 prefix on 9-digit numbers
  if (digits.startsWith('0048')) return digits.slice(4);
  if (digits.startsWith('48') && digits.length === 11) return digits.slice(2);
  return digits;
});
const byEmail = findDuplicates(rows, r => r.email.trim().toLowerCase());

let total = 0;

if (byPhone.length) {
  console.log('=== Duplicate phone numbers ===');
  for (const group of byPhone) {
    console.log(`  Phone: ${group[0].phone}`);
    for (const r of group) console.log(`    ${r.id}  ${r.name}`);
    total += group.length - 1;
  }
}

if (byEmail.length) {
  console.log('\n=== Duplicate emails ===');
  for (const group of byEmail) {
    console.log(`  Email: ${group[0].email}`);
    for (const r of group) console.log(`    ${r.id}  ${r.name}`);
    total += group.length - 1;
  }
}

if (total === 0) {
  console.log('✓ 0 suspected duplicate pairs. Safe to backfill.');
} else {
  console.log(`\n⚠️  ${total} suspected duplicate record(s). Merge in Airtable UI before backfilling.`);
}
