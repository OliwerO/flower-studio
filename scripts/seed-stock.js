// seed-stock.js — one-time script to populate Stock table with realistic test data.
// Run from backend/ dir: node --env-file=.env.dev ../scripts/seed-stock.js
// Deletes all existing stock first, then creates fresh items.

import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const TABLE = process.env.AIRTABLE_STOCK_TABLE;

const STOCK_ITEMS = [
  // Roses
  { 'Display Name': 'Red roses',       'Purchase Name': 'Roses red',      Category: 'Roses',       'Current Quantity': 120, 'Current Cost Price': 1.20, 'Current Sell Price': 3.50, Supplier: 'Stojek',  'Reorder Threshold': 20, Active: true },
  { 'Display Name': 'Pink roses',      'Purchase Name': 'Roses pink',     Category: 'Roses',       'Current Quantity':  80, 'Current Cost Price': 1.20, 'Current Sell Price': 3.50, Supplier: 'Stojek',  'Reorder Threshold': 20, Active: true },
  { 'Display Name': 'White roses',     'Purchase Name': 'Roses white',    Category: 'Roses',       'Current Quantity':  60, 'Current Cost Price': 1.30, 'Current Sell Price': 3.50, Supplier: 'Stojek',  'Reorder Threshold': 15, Active: true },
  { 'Display Name': 'Yellow roses',    'Purchase Name': 'Roses yellow',   Category: 'Roses',       'Current Quantity':  40, 'Current Cost Price': 1.20, 'Current Sell Price': 3.50, Supplier: 'Stefan',  'Reorder Threshold': 10, Active: true },

  // Tulips
  { 'Display Name': 'Pink tulips',     'Purchase Name': 'Tulips pink',    Category: 'Tulips',      'Current Quantity': 100, 'Current Cost Price': 0.80, 'Current Sell Price': 2.50, Supplier: '4f',      'Reorder Threshold': 20, Active: true },
  { 'Display Name': 'White tulips',    'Purchase Name': 'Tulips white',   Category: 'Tulips',      'Current Quantity':  70, 'Current Cost Price': 0.80, 'Current Sell Price': 2.50, Supplier: '4f',      'Reorder Threshold': 15, Active: true },
  { 'Display Name': 'Purple tulips',   'Purchase Name': 'Tulips purple',  Category: 'Tulips',      'Current Quantity':  50, 'Current Cost Price': 0.80, 'Current Sell Price': 2.50, Supplier: '4f',      'Reorder Threshold': 10, Active: true },
  { 'Display Name': 'Yellow tulips',   'Purchase Name': 'Tulips yellow',  Category: 'Tulips',      'Current Quantity':  30, 'Current Cost Price': 0.80, 'Current Sell Price': 2.50, Supplier: 'Mateusz', 'Reorder Threshold': 10, Active: true },

  // Seasonal
  { 'Display Name': 'Peonies',         'Purchase Name': 'Peony mix',      Category: 'Seasonal',    'Current Quantity':  45, 'Current Cost Price': 3.50, 'Current Sell Price': 9.00, Supplier: 'Stefan',  'Reorder Threshold':  8, Active: true },
  { 'Display Name': 'Ranunculus',      'Purchase Name': 'Ranunculus mix', Category: 'Seasonal',    'Current Quantity':  35, 'Current Cost Price': 2.80, 'Current Sell Price': 7.00, Supplier: 'Stefan',  'Reorder Threshold':  8, Active: true },
  { 'Display Name': 'Freesia',         'Purchase Name': 'Freesia mix',    Category: 'Seasonal',    'Current Quantity':  25, 'Current Cost Price': 1.60, 'Current Sell Price': 4.00, Supplier: 'Stojek',  'Reorder Threshold':  5, Active: true },

  // Greenery
  { 'Display Name': 'Eucalyptus',      'Purchase Name': 'Eucalyptus',     Category: 'Greenery',    'Current Quantity':  60, 'Current Cost Price': 1.00, 'Current Sell Price': 2.50, Supplier: 'Mateusz', 'Reorder Threshold': 10, Active: true },
  { 'Display Name': 'Ruscus',          'Purchase Name': 'Ruscus',         Category: 'Greenery',    'Current Quantity':  80, 'Current Cost Price': 0.50, 'Current Sell Price': 1.50, Supplier: 'Mateusz', 'Reorder Threshold': 15, Active: true },
  { 'Display Name': 'Fern',            'Purchase Name': 'Fern',           Category: 'Greenery',    'Current Quantity':  40, 'Current Cost Price': 0.60, 'Current Sell Price': 1.50, Supplier: 'Mateusz', 'Reorder Threshold': 10, Active: true },

  // Accessories
  { 'Display Name': 'Kraft paper',     'Purchase Name': 'Kraft paper',    Category: 'Accessories', 'Current Quantity': 200, 'Current Cost Price': 0.30, 'Current Sell Price': 0.00, Supplier: 'Other',   'Reorder Threshold': 30, Active: true },
  { 'Display Name': 'Ribbon (white)',  'Purchase Name': 'Ribbon white',   Category: 'Accessories', 'Current Quantity': 150, 'Current Cost Price': 0.20, 'Current Sell Price': 0.00, Supplier: 'Other',   'Reorder Threshold': 20, Active: true },
];

async function clearStock() {
  const records = [];
  // eachPage is callback-based — must wrap in a Promise to actually await it
  await new Promise((resolve, reject) => {
    base(TABLE).select({ fields: ['Display Name'] }).eachPage(
      (page, next) => { page.forEach(r => records.push(r.id)); next(); },
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
  if (!records.length) { console.log('No existing stock to clear.'); return; }

  // Airtable delete max 10 at a time
  for (let i = 0; i < records.length; i += 10) {
    await base(TABLE).destroy(records.slice(i, i + 10));
    console.log(`  Deleted batch ${i/10 + 1}`);
  }
  console.log(`Cleared ${records.length} existing stock records.`);
}

async function seedStock() {
  for (let i = 0; i < STOCK_ITEMS.length; i += 10) {
    const batch = STOCK_ITEMS.slice(i, i + 10).map(fields => ({ fields }));
    await base(TABLE).create(batch, { typecast: true });
    console.log(`  Created batch ${i/10 + 1}`);
  }
  console.log(`Seeded ${STOCK_ITEMS.length} stock items.`);
}

console.log('=== Seeding stock ===');
console.log(`Base: ${process.env.AIRTABLE_BASE_ID}`);
console.log(`Table: ${TABLE}`);
console.log('');

try {
  console.log('Step 1: Clearing existing stock...');
  await clearStock();
  console.log('Step 2: Creating new stock items...');
  await seedStock();
  console.log('\nDone!');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
