// DESTRUCTIVE — mutates prod Railway PG when run with --apply.
// Requires explicit owner approval phrase. Dry-run is the default.
//
// #329 Tier-2: soft-delete the cleared dead Stock rows that block the Y-model
// cutover (#291) — rows with NULL type_name that carry no live signal:
//   type_name IS NULL AND deleted_at IS NULL AND current_quantity = 0
//   AND no active (non-terminal) order consumer
//   AND no premade reservation line.
// These are spent historical Batches. Soft-deleting (deleted_at = now()) drops
// them from /stock?grouped=true and the cutover's "NULL count = 0" gate WITHOUT
// inventing Variety attrs for flowers no longer in play. Reversible (sets a
// timestamp; recover with deleted_at = NULL). Trace-by-id still resolves for
// any past order that referenced them (the usage join does not re-read the
// stock row's deleted_at).
//
// Tier-1 rows (nonzero qty / active order / premade) are EXCLUDED here — they
// are backfilled with real Variety attrs via the Variety Backfill UI instead
// (see propose_variety_backfill.mjs).
//
// Usage:
//   Dry-run (default, read-only):
//     CLAUDE_RO_URL=... node backend/scripts/soft_delete_cleared_null_rows.mjs
//   Live apply (owner-approved, needs WRITE DSN):
//     DATABASE_URL=<write> node backend/scripts/soft_delete_cleared_null_rows.mjs \
//       --apply --confirm "SOFT DELETE 329 CLEARED ROWS"
import pg from 'pg';

const APPROVAL = 'SOFT DELETE 329 CLEARED ROWS';
const apply = process.argv.includes('--apply');
const confirmIdx = process.argv.indexOf('--confirm');
const confirmPhrase = confirmIdx >= 0 ? process.argv[confirmIdx + 1] : null;

const SELECT_CLEARED = `
  SELECT id, display_name
  FROM stock s
  WHERE s.type_name IS NULL
    AND s.deleted_at IS NULL
    AND s.current_quantity = 0
    AND NOT EXISTS (
      SELECT 1 FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE ol.stock_item_id = s.id::text AND ol.deleted_at IS NULL AND o.deleted_at IS NULL
        AND o.status NOT IN ('Delivered','Picked Up','Cancelled'))
    AND NOT EXISTS (
      SELECT 1 FROM premade_bouquet_lines pl WHERE pl.stock_id = s.id)
  ORDER BY s.display_name
`;

if (!apply) {
  const dsn = process.env.CLAUDE_RO_URL || process.env.DATABASE_URL;
  const c = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(SELECT_CLEARED);
  console.log(`\n[DRY-RUN] ${r.rows.length} cleared NULL-type rows WOULD be soft-deleted:\n`);
  for (const row of r.rows) console.log('  ', row.display_name);
  console.log(`\nNo changes made. To apply: --apply --confirm "${APPROVAL}" with a WRITE DATABASE_URL.`);
  await c.end();
  process.exit(0);
}

// ── Live apply path ──
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing: do not run with NODE_ENV=production set locally; pass the prod DATABASE_URL explicitly instead.');
  process.exit(1);
}
if (confirmPhrase !== APPROVAL) {
  console.error(`Refusing: --apply requires --confirm "${APPROVAL}". Got: ${JSON.stringify(confirmPhrase)}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Refusing: --apply needs a WRITE DATABASE_URL (claude_ro cannot write).');
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  UPDATE stock SET deleted_at = now()
  WHERE id IN (SELECT id FROM (${SELECT_CLEARED}) sub)
  RETURNING id, display_name
`);
console.log(`[APPLIED] Soft-deleted ${r.rows.length} cleared NULL-type rows.`);
for (const row of r.rows) console.log('  ', row.display_name);
console.log('\nVerify: SELECT count(*) FROM stock WHERE type_name IS NULL AND deleted_at IS NULL;');
await c.end();
