// DESTRUCTIVE — writes Variety attrs to 11 prod stock rows (Tier-1 of #329).
//
// Owner-confirmed mapping from PR #349 comment (2026-05-29 review, post-corrections).
// Reads DATABASE_URL from env (use `railway run` so the prod write DSN is injected).
//
// Dry-run by default. Live run requires: --apply --confirm "APPLY TIER1 329 BACKFILL"
// Refuses under NODE_ENV=production (consistent with the Tier-2 script — Railway
// services run with NODE_ENV=production at runtime, so this script is meant to be
// invoked from the dev machine via `railway run`, which does NOT set NODE_ENV).
import pg from 'pg';

const APPLY   = process.argv.includes('--apply');
const CONFIRM = 'APPLY TIER1 329 BACKFILL';
const confirmIdx = process.argv.indexOf('--confirm');
const passedConfirm = confirmIdx >= 0 ? process.argv[confirmIdx + 1] : null;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run under NODE_ENV=production. Invoke via `railway run` from the dev machine.');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Run via `railway run node backend/scripts/apply_tier1_variety_backfill.mjs ...`');
  process.exit(2);
}

if (APPLY && passedConfirm !== CONFIRM) {
  console.error(`--apply requires --confirm "${CONFIRM}"`);
  process.exit(2);
}

// Owner-confirmed mapping (PR #349 comment, 2026-05-29).
const TIER1 = [
  { id: '513ad9b0-a90d-487c-877c-a2d8eada68c9', name: 'Paeonia Pink Hawaiian Coral', type: 'Peony',      colour: 'Pink',  cultivar: 'Hawaiian Coral' },
  { id: '781e82f7-5c91-4554-84c3-acd0e0a43c23', name: 'Oxypetalum tanioka pure blue', type: 'Oxypetalum', colour: 'Blue',  cultivar: 'Tanioka Pure'   },
  { id: 'ed4b6c4b-80c1-4965-a93a-a7a6d4a9cd96', name: 'Paeonia sarah bernhard',       type: 'Peony',      colour: 'Pink',  cultivar: 'Sarah Bernhardt'},
  { id: '295ad66a-6e90-4e76-b840-6e04b1811c89', name: 'Hydrangea verena Pink',        type: 'Hydrangea',  colour: 'Pink',  cultivar: 'Verena'         },
  { id: '3d819e6a-b69f-4838-818f-f35be176f9d5', name: 'Hydrangea White (29.May.)',    type: 'Hydrangea',  colour: 'White', cultivar: null             },
  { id: '9380013d-8f2f-43fb-ba9d-0c600c70179c', name: 'Hydrangea Pink (18.May.)',     type: 'Hydrangea',  colour: 'Pink',  cultivar: null             },
  { id: 'a7fdfbf0-85dc-4679-bfb8-5146cf9f1c08', name: 'Coral Peonies (29.May.)',      type: 'Peony',      colour: 'Pink',  cultivar: null             },
  { id: 'c4745a9b-9682-41bc-8bf1-e092c1467473', name: 'Peony Pink (29.May.)',         type: 'Peony',      colour: 'Pink',  cultivar: null             },
  { id: 'c8472441-f144-4079-8b6a-65ff8eac5bff', name: 'Oxypetalum blue (27.May.)',    type: 'Oxypetalum', colour: 'Blue',  cultivar: null             },
  { id: 'ad5083fb-e29d-4d45-9773-f4e4ae369167', name: 'Peony Pink (27.May.)',         type: 'Peony',      colour: 'Pink',  cultivar: null             },
  { id: '09d546bd-22f8-41b8-b1f2-6c8e478bb442', name: 'oxypetalum blue (29.May.)',    type: 'Oxypetalum', colour: 'Blue',  cultivar: null             },
];

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

console.log(`Tier-1 backfill — ${TIER1.length} rows, mode: ${APPLY ? 'APPLY (LIVE)' : 'dry-run'}`);
console.log('');

const { rows: pre } = await client.query(
  `SELECT id, display_name, type_name, colour, size_cm, cultivar FROM stock WHERE id = ANY($1::uuid[])`,
  [TIER1.map((r) => r.id)]
);
const preById = new Map(pre.map((r) => [r.id, r]));

if (pre.length !== TIER1.length) {
  console.error(`Found ${pre.length} of ${TIER1.length} rows in stock. Missing:`,
    TIER1.filter((r) => !preById.has(r.id)).map((r) => r.id));
  await client.end();
  process.exit(3);
}

const nonNullBefore = pre.filter((r) => r.type_name !== null);
if (nonNullBefore.length > 0) {
  console.error('REFUSING — some rows already have type_name set (mapping outdated):');
  nonNullBefore.forEach((r) => console.error(`  ${r.id} type=${r.type_name} colour=${r.colour} cultivar=${r.cultivar} (${r.display_name})`));
  await client.end();
  process.exit(4);
}

console.log('Plan (id → display_name → Type | Colour | Cultivar):');
TIER1.forEach((r) => {
  console.log(`  ${r.id.slice(0, 8)}  ${r.name.padEnd(38)} → ${r.type} | ${r.colour} | ${r.cultivar || '—'}`);
});
console.log('');

if (!APPLY) {
  console.log('Dry-run complete. Re-run with: --apply --confirm "APPLY TIER1 329 BACKFILL"');
  await client.end();
  process.exit(0);
}

await client.query('BEGIN');
try {
  for (const r of TIER1) {
    const before = preById.get(r.id);
    const beforeSnap = { Type: before.type_name, Colour: before.colour, Size: before.size_cm, Cultivar: before.cultivar };
    const afterSnap  = { Type: r.type,           Colour: r.colour,      Size: null,           Cultivar: r.cultivar };

    await client.query(
      `UPDATE stock SET type_name = $1, colour = $2, cultivar = $3, updated_at = NOW() WHERE id = $4`,
      [r.type, r.colour, r.cultivar, r.id]
    );

    // Minimal diff — same shape as audit.js minimalDiff but inline (only changed keys).
    const diff = {};
    if (beforeSnap.Type !== afterSnap.Type)         diff.Type     = { before: beforeSnap.Type,     after: afterSnap.Type };
    if (beforeSnap.Colour !== afterSnap.Colour)     diff.Colour   = { before: beforeSnap.Colour,   after: afterSnap.Colour };
    if (beforeSnap.Cultivar !== afterSnap.Cultivar) diff.Cultivar = { before: beforeSnap.Cultivar, after: afterSnap.Cultivar };

    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, diff, actor_role, actor_pin_label)
       VALUES ('stock', $1, 'variety_backfill', $2::jsonb, 'system', NULL)`,
      [r.id, JSON.stringify(diff)]
    );
  }
  await client.query('COMMIT');
  console.log(`✅ Applied ${TIER1.length} Tier-1 backfill rows in one transaction.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('❌ Rolled back:', err.message);
  await client.end();
  process.exit(5);
}

const { rows: post } = await client.query(
  `SELECT count(*)::int AS n FROM stock WHERE type_name IS NULL AND deleted_at IS NULL`
);
console.log(`Post-state: ${post[0].n} stock rows still have type_name=NULL (active). Target after Tier-2: 0.`);

await client.end();
