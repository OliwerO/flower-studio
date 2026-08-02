// DESTRUCTIVE — mutates prod Railway Postgres. Requires explicit owner approval.
//
// merge-duplicate-varieties.mjs — fold the duplicate Variety cards left behind
// before the entry-validation work (#562 → #603/#605/#610/#604) into one card
// each, and decompose the Types that are really whole flower names.
//
// WHY THIS EXISTS
// The create-a-flower door only started matching before it creates in #603, so
// everything typed before that could split one flower across several cards:
// `Peony Pin` beside `Peony Pink`, `Mattiola Pink` beside `Matthiola Pink`,
// `Oxypetalum blue` beside `Oxypetalum Blue`. Stock then shows a fraction of
// the truth on each. New duplicates can no longer be created; these are the
// ones already stored.
//
// WHAT IT DOES, in order (the order matters):
//   Phase 1 — RETYPE. A card whose Type contains a space is a whole flower
//     name jammed into the Type field (`Pink Peonies` typed `Pink Peonies`).
//     Decompose it against Types and Colours that ALREADY exist. This runs
//     FIRST because it moves cards INTO their real Variety group, creating the
//     duplicates that phase 2 then folds together.
//   Phase 2 — MERGE. Within each Variety 4-tuple, keep the OLDEST undated card
//     and fold the other undated ones into it: re-point every reference, then
//     soft-delete. Dated rows are one delivery each, never duplicates — they
//     are left completely alone (pitfall `batch-variety-attrs`).
//
// SAFETY
//   - Dry run by default. Prints the full plan and writes nothing.
//   - `APPROVE=yes` is required to write, and is asked for per run.
//   - Losers are SOFT-deleted (`deleted_at`), never removed. A mistake is one
//     UPDATE to undo.
//   - One transaction per card: the re-point and the soft-delete commit
//     together, or not at all. A partial commit here would orphan exactly the
//     references this whole programme exists to protect.
//   - Refuses to touch a card with a non-zero quantity. Every duplicate found
//     on 2026-08-02 sat at 0; a non-zero one means stems are involved and the
//     owner should look at it, not a script.
//
// USAGE
//   node backend/scripts/merge-duplicate-varieties.mjs            # dry run
//   APPROVE=yes node backend/scripts/merge-duplicate-varieties.mjs
//
// Reads DATABASE_URL (write) — for a dry run, CLAUDE_RO_URL is enough and is
// preferred, since it physically cannot write.

import pg from 'pg';

const APPLY = process.env.APPROVE === 'yes';
const DSN = APPLY
  ? process.env.DATABASE_URL
  : (process.env.CLAUDE_RO_URL || process.env.DATABASE_URL);

if (!DSN) {
  console.error('[merge] No DSN. Set CLAUDE_RO_URL for a dry run, DATABASE_URL to apply.');
  process.exit(1);
}
if (APPLY && !process.env.DATABASE_URL) {
  console.error('[merge] APPROVE=yes needs DATABASE_URL (a write-capable DSN).');
  process.exit(1);
}

// Both date-tag forms — see backend/src/utils/varietyIdentity.js. A card whose
// name carries one is a single delivery, not the Variety's canonical card.
const DATED = /\((\d{1,2}\.\w{3,4}\.?|\d{4}-\d{2}-\d{2})\)$/;

// Every column that points at stock(id). There are no FK constraints on stock,
// so this list is the only thing standing between a merge and an orphan —
// re-derive it with the information_schema query in the PR body if the schema
// moves.
const SCALAR_REFS = [
  ['order_lines',           'stock_item_id'],
  ['premade_bouquet_lines', 'stock_id'],
  ['stock_loss_log',        'stock_id'],
  ['stock_order_lines',     'stock_id'],
  ['stock_purchases',       'stock_id'],
];

const norm = (v) => String(v ?? '').trim().toLowerCase();

const client = new pg.Client({ connectionString: DSN, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log(APPLY
  ? '[merge] APPLYING — writing to the database.\n'
  : '[merge] DRY RUN — nothing will be written. Set APPROVE=yes to apply.\n');

// ---------------------------------------------------------------- helpers

async function referencesTo(id) {
  const out = [];
  for (const [table, column] of SCALAR_REFS) {
    const { rows } = await client.query(
      `select count(*)::int n from ${table} where ${column}::text = $1`, [id]);
    if (rows[0].n) out.push({ table, column, n: rows[0].n, array: false });
  }
  // substitute_for is text[] (#376) — a card can be listed as the original for
  // several substitutes, so it needs element replacement, not assignment.
  const { rows } = await client.query(
    `select count(*)::int n from stock where $1 = any(substitute_for::text[])`, [id]);
  if (rows[0].n) out.push({ table: 'stock', column: 'substitute_for', n: rows[0].n, array: true });
  return out;
}

async function repointAndRetire(tx, loser, winner, refs) {
  for (const ref of refs) {
    if (ref.array) {
      await tx.query(
        `update stock set substitute_for = array_replace(substitute_for, $1, $2)
         where $1 = any(substitute_for::text[])`, [loser, winner]);
    } else {
      await tx.query(
        `update ${ref.table} set ${ref.column} = $2 where ${ref.column}::text = $1`,
        [loser, winner]);
    }
  }
  await tx.query(`update stock set deleted_at = now() where id = $1`, [loser]);
}

// ------------------------------------------------------- phase 1: retype

// Owner-supplied decompositions, for names inference cannot reach. `Pink
// Peonies` is `Peony` / `Pink` — obvious to a florist, not to a prefix match
// (`peonies` does not start with `peony`). Owner, 2026-08-02: "besides the pink
// peonies slash pink, this is just a peony slash pink".
const TYPE_REWRITES = {
  'pink peonies': { type: 'Peony', colour: 'Pink' },
};

async function planRetype() {
  const { rows: known } = await client.query(`
    select distinct type_name t, colour c from stock
    where deleted_at is null and type_name is not null and type_name !~ '\\s'`);
  const types   = [...new Set(known.map(r => r.t).filter(Boolean))];
  const colours = [...new Set(known.map(r => r.c).filter(Boolean))];

  const { rows: bad } = await client.query(`
    select id, display_name, type_name, colour, size_cm, cultivar, current_quantity qty
    from stock where deleted_at is null and type_name ~ '\\s' order by type_name, created_at`);

  const plan = [];
  for (const row of bad) {
    const explicit = TYPE_REWRITES[norm(row.type_name)];
    if (explicit) {
      plan.push({ ...row, newType: explicit.type, newColour: explicit.colour ?? row.colour ?? null });
      continue;
    }
    // Otherwise decompose against values that ALREADY exist — never invent one.
    // The longest matching known Type wins. Anything this cannot resolve is
    // SKIPPED and reported, not guessed at: a wrong Type moves a card into the
    // wrong flower, which is the very failure being cleaned up here.
    const words = norm(row.type_name).split(/\s+/);
    const type = types
      .filter(t => words.some(w => w.startsWith(norm(t)) || norm(t).startsWith(w)))
      .sort((a, b) => b.length - a.length)[0] || null;
    const colour = row.colour
      || colours.find(c => words.includes(norm(c)))
      || null;
    plan.push({ ...row, newType: type, newColour: colour });
  }
  return plan;
}

// -------------------------------------------------------- phase 2: merge

async function planMerge() {
  const { rows: groups } = await client.query(`
    select lower(btrim(type_name)) t,
           lower(btrim(coalesce(colour,'')))   c,
           coalesce(size_cm, -1)               s,
           lower(btrim(coalesce(cultivar,''))) cv,
           json_agg(json_build_object(
             'id', id, 'name', display_name, 'qty', current_quantity,
             'created', created_at::date) order by created_at) rows
    from stock
    where deleted_at is null and type_name is not null
    group by 1,2,3,4 having count(*) > 1
    order by 1,2,3,4`);

  const plan = [];
  for (const g of groups) {
    const undated = g.rows.filter(r => !DATED.test(r.name || ''));
    if (undated.length < 2) continue;             // canonical + deliveries: normal
    const [winner, ...losers] = undated;          // oldest first, from the ORDER BY
    plan.push({
      label: `${g.t} / ${g.c || '—'} / ${g.s < 0 ? '—' : g.s} / ${g.cv || '—'}`,
      winner,
      losers,
      datedLeftAlone: g.rows.length - undated.length,
    });
  }
  return plan;
}

// ------------------------------------------------------------------ run

let retyped = 0, merged = 0, skipped = 0;

console.log('=== Phase 1 — Types that are really whole flower names ===\n');
for (const row of await planRetype()) {
  if (!row.newType) {
    console.log(`  SKIP  ${row.display_name} — no existing Type matches "${row.type_name}"`);
    skipped++;
    continue;
  }
  console.log(`  RETYPE ${row.display_name}`);
  console.log(`         "${row.type_name}" / ${row.colour ?? '—'}  →  "${row.newType}" / ${row.newColour ?? '—'}`);
  if (APPLY) {
    await client.query(
      `update stock set type_name = $2, colour = $3, updated_at = now() where id = $1`,
      [row.id, row.newType, row.newColour]);
    retyped++;
  }
}

console.log('\n=== Phase 2 — duplicate cards for one Variety ===\n');
for (const group of await planMerge()) {
  console.log(`### ${group.label}`);
  console.log(`  KEEP   ${group.winner.name}  qty=${group.winner.qty}  ${group.winner.created}`);
  for (const loser of group.losers) {
    const refs = await referencesTo(loser.id);
    const summary = refs.length
      ? refs.map(r => `${r.table}.${r.column}=${r.n}`).join(', ')
      : 'no references';
    if (Number(loser.qty) !== 0) {
      console.log(`  SKIP   ${loser.name} — qty=${loser.qty}, stems are involved. Owner decision.`);
      skipped++;
      continue;
    }
    console.log(`  MERGE  ${loser.name}  qty=0  ${loser.created}  → ${summary}`);
    if (APPLY) {
      const tx = client;
      await tx.query('begin');
      try {
        await repointAndRetire(tx, loser.id, group.winner.id, refs);
        await tx.query('commit');
        merged++;
      } catch (err) {
        await tx.query('rollback');
        console.error(`  FAILED ${loser.name}: ${err.message} — rolled back, nothing changed.`);
        throw err;
      }
    }
  }
  if (group.datedLeftAlone) {
    console.log(`         (${group.datedLeftAlone} dated delivery row(s) left alone)`);
  }
  console.log('');
}

// ---------------------------------------------------- phase 3: supplier

// Owner decision 2026-08-02: `Pan Zbigniew Dalie` and `Pan Zbigniew` are one
// person, and `Pan Zbigniew` is the name to keep. Free-typed supplier fields
// are what let one person become two (fixed going forward in #610 by making
// every supplier field a picker); this folds the rows already stored.
const SUPPLIER_RENAMES = [
  { from: 'Pan Zbigniew Dalie', to: 'Pan Zbigniew' },
];

// Plain text columns holding a supplier name.
const SUPPLIER_COLUMNS = [
  ['stock',             'supplier'],
  ['stock_order_lines', 'supplier'],
  ['stock_order_lines', 'substitute_supplier'],
  ['stock_purchases',   'supplier'],
];

console.log('=== Phase 3 — suppliers that are one person under two names ===\n');
let supplierRows = 0;
for (const { from, to } of SUPPLIER_RENAMES) {
  console.log(`### "${from}"  →  "${to}"`);

  for (const [table, column] of SUPPLIER_COLUMNS) {
    const { rows } = await client.query(
      `select count(*)::int n from ${table} where ${column} = $1`, [from]);
    if (!rows[0].n) continue;
    console.log(`  ${table}.${column}: ${rows[0].n} row(s)`);
    if (APPLY) {
      await client.query(
        `update ${table} set ${column} = $2 where ${column} = $1`, [from, to]);
      supplierRows += rows[0].n;
    }
  }

  // supplier_payments is a JSON object KEYED by supplier name — this is money,
  // not a label. Rename the key, and if the target key already exists on the
  // same order, ADD the two rather than letting one overwrite the other.
  // supplier_payments is a TEXT column holding a JSON object, so the jsonb `?`
  // operator is unavailable — match on the text, then parse in JS.
  const { rows: orders } = await client.query(
    `select id, supplier_payments from stock_orders
     where supplier_payments like '%' || $1 || '%'`, [from]);
  if (orders.length) {
    console.log(`  stock_orders.supplier_payments: ${orders.length} order(s)`);
    for (const o of orders) {
      let parsed;
      try {
        parsed = JSON.parse(o.supplier_payments || '{}');
      } catch (err) {
        console.error(`    order ${o.id}: supplier_payments is not valid JSON — left alone (${err.message})`);
        skipped++;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(parsed, from)) continue;  // name appeared inside another value
      const payments = { ...parsed };
      const moved = Number(payments[from]) || 0;
      const existing = Number(payments[to]) || 0;
      delete payments[from];
      payments[to] = existing + moved;
      console.log(`    order ${o.id}: ${moved} zł${existing ? ` + ${existing} zł already under "${to}"` : ''} → ${payments[to]} zł`);
      if (APPLY) {
        await client.query(
          `update stock_orders set supplier_payments = $2 where id = $1`,
          [o.id, JSON.stringify(payments)]);
        supplierRows++;
      }
    }
  }

  // The settings list the pickers read from.
  // app_config.value IS jsonb (unlike supplier_payments), so jsonb_set applies.
  const { rows: cfg } = await client.query(
    `select key, value from app_config where key = 'config'`);
  for (const row of cfg) {
    const value = row.value || {};
    const list = Array.isArray(value.suppliers) ? value.suppliers : null;
    if (!list || !list.includes(from)) continue;
    const next = [...new Set(list.map(s => (s === from ? to : s)))];
    console.log(`  app_config.config.suppliers: ${list.length} → ${next.length} entries`);
    if (APPLY) {
      await client.query(
        `update app_config set value = jsonb_set(value::jsonb, '{suppliers}', $2::jsonb) where key = $1`,
        [row.key, JSON.stringify(next)]);
      supplierRows++;
    }
  }
  console.log('');
}

console.log(APPLY
  ? `\n[merge] Done. Retyped ${retyped}, merged ${merged}, supplier rows ${supplierRows}, skipped ${skipped}.`
  : `\n[merge] Dry run complete. ${skipped} would be skipped. Re-run with APPROVE=yes to apply.`);

await client.end();
