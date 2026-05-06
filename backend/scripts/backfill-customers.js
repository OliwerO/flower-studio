// backend/scripts/backfill-customers.js
// Category: DESTRUCTIVE
// Reads all active rows from Airtable Clients (B2C), writes each to the PG
// `customers` table (preserving airtable_id = recXXX), and backfills up to
// two `key_people` rows per customer from Key person 1 / Key person 2 fields.
// Idempotent: upserts on airtable_id (safe to re-run).
//
// Requires owner approval phrase before running.
// Usage: APPROVE=yes node backend/scripts/backfill-customers.js

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const CUSTOMERS_TABLE = process.env.AIRTABLE_CUSTOMERS_TABLE;

const rows = [];
await base(CUSTOMERS_TABLE).select({
  fields: [
    'Name', 'Nickname', 'Phone', 'Email', 'Link', 'Language',
    'Home address', 'Sex / Business', 'Segment (client)',
    'Found us from', 'Communication method', 'Order Source',
    'Key person 1 (Name + Contact details)',
    'Key person 2 (Name + Contact details)',
    'Key person 1 (important DATE)',
    'Key person 2 (important DATE)',
  ],
}).eachPage((records, next) => {
  for (const r of records) rows.push(r);
  next();
});

console.log(`Fetched ${rows.length} Airtable customer records.`);

let custInserted = 0, custUpdated = 0, kpInserted = 0;

for (const r of rows) {
  try {
    const result = await pool.query(
      `INSERT INTO customers
         (airtable_id, name, nickname, phone, email, link, language, home_address,
          sex_business, segment, found_us_from, communication_method, order_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (airtable_id) DO UPDATE SET
         name = EXCLUDED.name, nickname = EXCLUDED.nickname, phone = EXCLUDED.phone,
         email = EXCLUDED.email, link = EXCLUDED.link, language = EXCLUDED.language,
         home_address = EXCLUDED.home_address, sex_business = EXCLUDED.sex_business,
         segment = EXCLUDED.segment, found_us_from = EXCLUDED.found_us_from,
         communication_method = EXCLUDED.communication_method,
         order_source = EXCLUDED.order_source
       RETURNING id, (xmax = 0) AS inserted`,
      [
        r.id,
        r.get('Name') || r.get('Nickname') || '(unnamed)',
        r.get('Nickname') || null,
        r.get('Phone') || null,
        r.get('Email') || null,
        r.get('Link') || null,
        r.get('Language') || null,
        r.get('Home address') || null,
        r.get('Sex / Business') || null,
        r.get('Segment (client)') || null,
        r.get('Found us from') || null,
        r.get('Communication method') || null,
        r.get('Order Source') || null,
      ],
    );
    const { id: custId, inserted } = result.rows[0];
    if (inserted) custInserted++; else custUpdated++;

    // Delete existing key_people for this customer before re-inserting (idempotent).
    await pool.query('DELETE FROM key_people WHERE customer_id = $1', [custId]);

    const kpSlots = [
      { name: r.get('Key person 1 (Name + Contact details)'), date: r.get('Key person 1 (important DATE)') },
      { name: r.get('Key person 2 (Name + Contact details)'), date: r.get('Key person 2 (important DATE)') },
    ];

    for (const kp of kpSlots) {
      if (!kp.name) continue;
      await pool.query(
        'INSERT INTO key_people (customer_id, name, important_date) VALUES ($1, $2, $3)',
        [custId, kp.name, kp.date || null],
      );
      kpInserted++;
    }
  } catch (err) {
    console.error(`Failed on customer ${r.id} (${r.get('Name') || '?'}):`, err.message);
  }
}

console.log(`customers: ${custInserted} inserted, ${custUpdated} updated.`);
console.log(`key_people: ${kpInserted} inserted.`);
await pool.end();
