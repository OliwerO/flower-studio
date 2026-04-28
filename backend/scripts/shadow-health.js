// shadow-health.js — read-only daily check during the Phase 3+4
// shadow-write windows. Reports parity_log status, audit_log activity,
// and PG row counts so the owner can confirm at a glance that
// shadow-write is healthy before flipping to STOCK_BACKEND=postgres
// (and later ORDER_BACKEND=postgres).
//
// Connects via the claude_ro DSN — read-only, can't accidentally
// mutate prod. Safe to run any time.
//
// Usage:
//   CLAUDE_RO_URL='postgresql://claude_ro:...@shuttle.proxy.rlwy.net:28897/railway' \
//     node scripts/shadow-health.js
//
//   (CLAUDE_RO_URL is in Railway: `railway variables --service Postgres | grep CLAUDE_RO`,
//    or in the local memory file at ~/.claude/projects/.../memory/project_postgres_access.md)

import pg from 'pg';

const url = process.env.CLAUDE_RO_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('[shadow-health] No DSN found. Set CLAUDE_RO_URL or DATABASE_URL.');
  console.error('[shadow-health] CLAUDE_RO_URL lives in Railway (`railway variables --service Postgres`)');
  console.error('[shadow-health]   or in memory at ~/.claude/projects/<project>/memory/project_postgres_access.md');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

// ── ANSI helpers ──
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  dim:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
};

function fmtTable(rows, cols) {
  if (rows.length === 0) return c.dim('  (none)');
  const widths = cols.map(col => Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)));
  const header = '  ' + cols.map((col, i) => c.dim(col.padEnd(widths[i]))).join('  ');
  const sep    = '  ' + widths.map(w => c.dim('─'.repeat(w))).join('  ');
  const body   = rows.map(r => '  ' + cols.map((col, i) => String(r[col] ?? '').padEnd(widths[i])).join('  '));
  return [header, sep, ...body].join('\n');
}

console.log(c.cyan(c.bold('\n═══ Shadow-Write Health Check ═══\n')));
console.log(`  Time:    ${new Date().toISOString()}`);

// Confirm we're on the read-only role.
const { rows: [{ user, db: dbName }] } = await pool.query(
  `SELECT current_user AS user, current_database() AS db`,
);
console.log(`  Role:    ${user} on ${dbName}`);
console.log();

// ── Table row counts ──
console.log(c.bold('Tables (active rows):'));
const tableCounts = await Promise.all([
  pool.query(`SELECT 'stock' AS t, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE current_quantity < 0)::int AS neg FROM stock WHERE deleted_at IS NULL`),
  pool.query(`SELECT 'orders' AS t, COUNT(*)::int AS n, NULL::int AS neg FROM orders WHERE deleted_at IS NULL`),
  pool.query(`SELECT 'order_lines' AS t, COUNT(*)::int AS n, NULL::int AS neg FROM order_lines WHERE deleted_at IS NULL`),
  pool.query(`SELECT 'deliveries' AS t, COUNT(*)::int AS n, NULL::int AS neg FROM deliveries WHERE deleted_at IS NULL`),
  pool.query(`SELECT 'audit_log' AS t, COUNT(*)::int AS n, NULL::int AS neg FROM audit_log`),
  pool.query(`SELECT 'parity_log' AS t, COUNT(*)::int AS n, NULL::int AS neg FROM parity_log`),
]);
const tableRows = tableCounts.map(({ rows: [r] }) => ({
  table: r.t,
  rows:  r.n,
  notes: r.t === 'stock' && r.neg > 0 ? c.amber(`${r.neg} with qty < 0 (demand backlog)`) : '',
}));
console.log(fmtTable(tableRows, ['table', 'rows', 'notes']));
console.log();

// ── Parity status ──
console.log(c.bold('Parity log (all-time):'));
const { rows: parityKinds } = await pool.query(`
  SELECT entity_type, kind, COUNT(*)::int AS n
  FROM parity_log
  GROUP BY entity_type, kind
  ORDER BY entity_type, kind
`);
if (parityKinds.length === 0) {
  console.log(c.green('  ✓ Zero mismatches — shadow-write is clean.'));
} else {
  console.log(c.red('  ⚠ Mismatches found — investigate before flipping to postgres mode:'));
  console.log(fmtTable(parityKinds, ['entity_type', 'kind', 'n']));
}
console.log();

// ── Recent parity events (last 5) ──
const { rows: recentParity } = await pool.query(`
  SELECT entity_type, entity_id, kind, field, created_at
  FROM parity_log
  ORDER BY created_at DESC
  LIMIT 5
`);
if (recentParity.length > 0) {
  console.log(c.bold('Latest 5 parity events:'));
  console.log(fmtTable(recentParity.map(r => ({
    when:    r.created_at.toISOString().slice(0, 19).replace('T', ' '),
    entity:  r.entity_type,
    kind:    r.kind,
    field:   r.field || '',
    id:      r.entity_id,
  })), ['when', 'entity', 'kind', 'field', 'id']));
  console.log();
}

// ── Audit activity (last 24h) ──
console.log(c.bold('Audit activity (last 24h):'));
const { rows: auditByEntity } = await pool.query(`
  SELECT entity_type, action, COUNT(*)::int AS n
  FROM audit_log
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY entity_type, action
  ORDER BY entity_type, action
`);
console.log(fmtTable(auditByEntity, ['entity_type', 'action', 'n']));
console.log();

// ── Latest 5 audit events ──
console.log(c.bold('Latest 5 audit events:'));
const { rows: recentAudits } = await pool.query(`
  SELECT entity_type, action, actor_role, actor_pin_label, diff, created_at
  FROM audit_log
  ORDER BY id DESC
  LIMIT 5
`);
if (recentAudits.length === 0) {
  console.log(c.dim('  (no audit rows yet — no PG-side writes have happened)'));
} else {
  for (const a of recentAudits) {
    const when = a.created_at.toISOString().slice(0, 19).replace('T', ' ');
    const actor = a.actor_pin_label ? `${a.actor_role}/${a.actor_pin_label}` : a.actor_role;
    let summary = a.action;
    if (a.action === 'update' && a.diff?.after) {
      const changes = Object.entries(a.diff.after).slice(0, 2)
        .map(([k, v]) => `${k}=${v}`).join(', ');
      if (changes) summary = `update (${changes})`;
    }
    console.log(`  ${c.dim(when)}  ${actor.padEnd(16)} ${a.entity_type.padEnd(10)} ${summary}`);
  }
}
console.log();

// ── Quick verdict ──
const totalParity = parityKinds.reduce((sum, r) => sum + r.n, 0);
if (totalParity === 0) {
  console.log(c.green(c.bold('✓ Shadow-write is healthy. No parity issues to investigate.')));
} else {
  console.log(c.red(c.bold(`⚠ ${totalParity} parity event(s) recorded — review before cutover.`)));
}
console.log();

await pool.end();
