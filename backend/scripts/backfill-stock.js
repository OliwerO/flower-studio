// backfill-stock.js — copies every active Airtable Stock row into Postgres.
//
// Run BEFORE flipping STOCK_BACKEND from 'airtable' to 'shadow'. Without
// the backfill, shadow-mode writes would only capture rows that change
// during the cutover window — old static rows would never appear in PG.
//
// Run from backend/ dir:
//   node --env-file=.env scripts/backfill-stock.js
//
// Idempotent: re-runs UPSERT on airtable_id so you can re-execute safely
// after fixing data issues. Soft-deleted PG rows are not touched (the
// owner intentionally hid them).
//
// Outputs a one-line summary per row + a final tally so the operator can
// spot anomalies (e.g. rows with negative qty, missing prices) before
// flipping the backend mode.

import * as airtable from '../src/services/airtable.js';
import { TABLES } from '../src/config/airtable.js';
import { db, pool } from '../src/db/index.js';
import { stock } from '../src/db/schema.js';
import { responseToPg } from '../src/repos/stockRepo.js';
import { eq, sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  console.error('[backfill] DATABASE_URL not set. Aborting.');
  process.exit(1);
}

console.log('[backfill] Pulling Stock rows from Airtable…');
// Pull EVERYTHING — even Active=false rows. Inactive rows still have history
// referenced by orders + POs, so we want them in PG too. The repo's read
// queries auto-filter `active = true` by default, so this just ensures the
// data is there for audit/admin tooling.
const rows = await airtable.list(TABLES.STOCK, {
  // No filterByFormula → all rows. Sort by Display Name so log output is browsable.
  sort: [{ field: 'Display Name', direction: 'asc' }],
});
console.log(`[backfill] Fetched ${rows.length} rows.`);

let inserted = 0;
let updated = 0;
let skipped = 0;
const issues = [];

for (const r of rows) {
  if (!r['Display Name']) {
    issues.push({ id: r.id, reason: 'missing Display Name — skipped' });
    skipped++;
    continue;
  }
  const pgFields = responseToPg(r);
  // Always include `active` — Airtable's default is true, but missing field == falsy in PG.
  if (!('active' in pgFields)) pgFields.active = r.Active !== false;

  try {
    // Look up existing PG row by airtable_id.
    const [existing] = await db.select().from(stock)
      .where(eq(stock.airtableId, r.id))
      .limit(1);

    if (existing) {
      await db.update(stock).set({
        ...pgFields,
        updatedAt: new Date(),
        // Don't touch deletedAt — let the operator restore intentionally.
      }).where(eq(stock.id, existing.id));
      updated++;
      process.stdout.write(`. updated ${r.id} ${r['Display Name']}\n`);
    } else {
      await db.insert(stock).values({
        airtableId: r.id,
        ...pgFields,
      });
      inserted++;
      process.stdout.write(`+ inserted ${r.id} ${r['Display Name']}\n`);
    }
  } catch (err) {
    issues.push({ id: r.id, name: r['Display Name'], reason: err.message });
    console.error(`[backfill] FAILED ${r.id} (${r['Display Name']}):`, err.message);
  }
}

// Sanity counters: how many PG rows exist now? Negative-qty rows? Missing-price?
const [{ count: pgTotal }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM stock WHERE deleted_at IS NULL`)
  .then(r => r.rows ?? r);
const [{ count: pgNegative }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM stock WHERE deleted_at IS NULL AND current_quantity < 0`)
  .then(r => r.rows ?? r);

console.log('\n[backfill] Summary:');
console.log(`  Airtable rows fetched:  ${rows.length}`);
console.log(`  PG rows inserted:       ${inserted}`);
console.log(`  PG rows updated:        ${updated}`);
console.log(`  Skipped (missing name): ${skipped}`);
console.log(`  Issues encountered:     ${issues.length}`);
console.log(`  PG active rows now:     ${pgTotal}`);
console.log(`  PG rows with qty < 0:   ${pgNegative}  (these are demand backlog, not errors)`);

if (issues.length) {
  console.log('\n[backfill] Issues:');
  for (const i of issues) console.log(`  - ${i.id} ${i.name || ''}: ${i.reason}`);
}

console.log('\n[backfill] Done. Next step: deploy with STOCK_BACKEND=shadow and watch parity_log.');

await pool.end();
process.exit(issues.length > 0 ? 1 : 0);
