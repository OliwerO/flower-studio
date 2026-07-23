#!/usr/bin/env node
// Category: DESTRUCTIVE (writes prod when --apply). Default --dry-run is SAFE.
// Requires explicit owner approval phrase before --apply, per CLAUDE.md's
// Production Scripts rule.
//
// Repairs the pre-#556 landmines: Demand Entries that were soft-deleted by
// the #516 settlement code (deleted_at set) but are still referenced by a
// live order_line.stock_item_id on a terminal Order (Delivered / Picked Up).
// Those rows are exactly what Task A3 fixed the crash for going forward —
// this script un-does the retroactive damage: it clears deleted_at and
// stamps settled_at = the old deleted_at, converting the legacy soft-delete
// into the new ADR-0013 settled marker (kept visible, deleted_at NULL).
//
// Idempotent: only touches rows with deleted_at IS NOT NULL AND
// settled_at IS NULL; re-running after a successful --apply finds 0 rows.
//
// The approval phrase's count (34) was measured against prod pre-deploy of
// migration 0022 (settled_at didn't exist yet, so it was measured via the
// equivalent deleted_at-only join, dry-run PR review, 2026-07-23). Re-run the
// dry-run right before --apply — if the live count differs, the phrase will
// not match and the script refuses; that mismatch is a feature, not a bug —
// it forces a fresh review rather than blindly re-using a stale confirm.
//
// Usage:
//   Dry-run (default, read-only):
//     CLAUDE_RO_URL='postgresql://claude_ro:...@...rlwy.net:PORT/railway' \
//       node backend/scripts/undelete-settled-des.mjs
//
//   (CLAUDE_RO_URL: `railway variables -s Postgres --kv | grep CLAUDE_RO_URL`)
//
//   Live apply (owner-approved, needs WRITE DSN):
//     DATABASE_URL=<write dsn> node backend/scripts/undelete-settled-des.mjs \
//       --apply --confirm "UNDELETE 34 SETTLED DEMAND ENTRIES"

import pg from 'pg';

const APPROVAL = 'UNDELETE 34 SETTLED DEMAND ENTRIES';
const apply = process.argv.includes('--apply');
const confirmIdx = process.argv.indexOf('--confirm');
const confirmPhrase = confirmIdx >= 0 ? process.argv[confirmIdx + 1] : null;

// Every soft-deleted stock row still referenced by a non-deleted order_line
// on a non-deleted, terminal Order. stock_item_id is text; cast the uuid
// side to text so legacy recXXX-bound lines don't abort the join (matches
// the dataQueryPack / getUsageByExactId convention elsewhere in this repo).
const SELECT_LANDMINES = `
  SELECT DISTINCT s.id, s.display_name, s.deleted_at
  FROM stock s
  JOIN order_lines ol ON ol.stock_item_id = s.id::text AND ol.deleted_at IS NULL
  JOIN orders o ON o.id = ol.order_id AND o.deleted_at IS NULL
  WHERE s.deleted_at IS NOT NULL
    AND s.settled_at IS NULL
    AND o.status IN ('Delivered', 'Picked Up')
  ORDER BY s.display_name
`;

if (!apply) {
  const url = process.env.CLAUDE_RO_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('undelete-settled-des: set CLAUDE_RO_URL (read-only DSN) for a dry-run.');
    console.error('  railway variables -s Postgres --kv | grep CLAUDE_RO_URL');
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(SELECT_LANDMINES);
  console.log(`\n[DRY-RUN] ${rows.length} settled Demand Entries to repair:\n`);
  for (const r of rows) console.log(`  ${r.id}  ${r.display_name}  (deleted_at ${r.deleted_at.toISOString()})`);
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
const { rows } = await c.query(`
  UPDATE stock
  SET settled_at = deleted_at, deleted_at = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM (${SELECT_LANDMINES}) sub)
  RETURNING id, display_name
`);
console.log(`[APPLIED] Repaired ${rows.length} settled Demand Entries (deleted_at cleared, settled_at stamped).`);
for (const r of rows) console.log('  ', r.display_name);
console.log('\nVerify: SELECT count(*) FROM stock WHERE deleted_at IS NOT NULL AND settled_at IS NULL;');
await c.end();
