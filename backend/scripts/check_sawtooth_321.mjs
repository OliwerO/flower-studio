// SAFE — read-only via claude_ro DSN. #321 diagnose Phase 0.
// Hunts the audit-log signature of non-atomic read-modify-write on stock rows:
//   actor_role='system', successive updates on the same stock id within a
//   short window where the after of event N equals the before of event N+1.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.CLAUDE_RO_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const TARGET = 'c2fd6fd5-c409-4063-b2a5-b46a476d0df7';

console.log('=== full audit trail for the issue-#321 example row ===');
const a = await c.query(
  `SELECT id, action, actor_role, actor_pin_label, created_at,
          (diff->'before'->>'Current Quantity') AS before_q,
          (diff->'after'->>'Current Quantity')  AS after_q,
          diff
   FROM audit_log WHERE entity_type='stock' AND entity_id=$1
   ORDER BY created_at ASC`, [TARGET]);
for (const r of a.rows) {
  console.log(`${r.created_at.toISOString()}  ${r.actor_role.padEnd(7)} ${(r.actor_pin_label||'').padEnd(10)}  ${r.action.padEnd(6)} qty ${r.before_q ?? '∅'} → ${r.after_q ?? '∅'}`);
}

console.log('\n=== other stock rows showing the same sawtooth pattern (last 30 days) ===');
// Pairs of system updates on the same stock row within 10 seconds where
// after of the earlier event equals before of the later event.
const pairs = await c.query(`
  WITH s AS (
    SELECT entity_id, created_at,
           (diff->'before'->>'Current Quantity')::int AS before_q,
           (diff->'after'->>'Current Quantity')::int  AS after_q
    FROM audit_log
    WHERE entity_type='stock' AND action='update' AND actor_role='system'
      AND created_at > now() - interval '30 days'
      AND (diff->'before'->>'Current Quantity') IS NOT NULL
      AND (diff->'after'->>'Current Quantity')  IS NOT NULL
  ),
  paired AS (
    SELECT a.entity_id,
           a.created_at AS t1, a.before_q AS b1, a.after_q AS a1,
           b.created_at AS t2, b.before_q AS b2, b.after_q AS a2,
           EXTRACT(EPOCH FROM (b.created_at - a.created_at)) AS gap_sec
    FROM s a JOIN s b
      ON b.entity_id = a.entity_id AND b.created_at > a.created_at
     AND b.created_at <= a.created_at + interval '10 seconds'
     AND b.before_q = a.after_q
  )
  SELECT entity_id, count(*)::int AS sawtooth_pairs,
         min(t1) AS first_seen, max(t2) AS last_seen
  FROM paired GROUP BY entity_id
  ORDER BY sawtooth_pairs DESC LIMIT 20`);
for (const r of pairs.rows) {
  // resolve display_name for context.
  const n = await c.query('SELECT display_name FROM stock WHERE id=$1', [r.entity_id]);
  console.log(`${r.entity_id}  pairs=${r.sawtooth_pairs}  ${r.first_seen.toISOString().slice(0,16)} → ${r.last_seen.toISOString().slice(0,16)}  ${n.rows[0]?.display_name ?? '(?)'}`);
}

console.log('\n=== distinct diff "before" key-sets on system stock updates (last 14 days) ===');
const keys = await c.query(`
  SELECT keyset, count(*)::int AS n FROM (
    SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(diff->'before') k) AS keyset
    FROM audit_log
    WHERE entity_type='stock' AND action='update' AND actor_role='system'
      AND created_at > now() - interval '14 days'
  ) s GROUP BY keyset ORDER BY n DESC LIMIT 10`);
for (const r of keys.rows) console.log('  n=' + r.n + '  before-keys: ' + r.keyset);

await c.end();
