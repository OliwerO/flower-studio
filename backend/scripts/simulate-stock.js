// simulate-stock.js — "day in the life" of the stock subsystem against
// an ephemeral in-process Postgres (pglite). Owner-runnable: no DB
// install, no Airtable connection, no env vars. Just `node scripts/simulate-stock.js`.
//
// Walks through the same kinds of operations the dashboard / florist /
// driver apps trigger over a normal day, prints the stock state after
// each step, and dumps the audit log at the end. Use this to reason
// about whether the Phase 3 cutover behaves the way you expect BEFORE
// flipping STOCK_BACKEND on prod.
//
// Why it doesn't import stockRepo: the repo imports the production `db`
// singleton from db/index.js, which can't be redirected to pglite at
// runtime via monkey-patch (ESM exports are non-configurable). Instead
// we replicate the repo's transactional pattern inline — same audit
// behaviour, same atomic UPDATE semantics, just expressed directly.
// The repo's correctness is validated separately by stockRepo.integration.test.js.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

// ── ANSI helpers — make the printed walkthrough readable. ──
const fmt = {
  step: (n, t) => `\n\x1b[36m=== Step ${n}: ${t} ===\x1b[0m`,
  ok:   (s)    => `  \x1b[32m✓\x1b[0m ${s}`,
  info: (s)    => `  \x1b[90m· ${s}\x1b[0m`,
  warn: (s)    => `  \x1b[33m⚠\x1b[0m ${s}`,
  table: (rows, cols) => {
    if (rows.length === 0) return '  (empty)';
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
    const fmtRow = (r) => '  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ');
    const header = '  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  ');
    const sep    = '  ' + widths.map(w => '─'.repeat(w)).join('  ');
    return [header, sep, ...rows.map(fmtRow)].join('\n');
  },
};

// ── Boot ──
const pg = new PGlite();
await pg.waitReady;
for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
  const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
  for (const stmt of text.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
    await pg.exec(stmt);
  }
}
const db = drizzle(pg, { schema });
const { stock, auditLog } = schema;

// ── Inline repo operations ──
//
// Each op follows the same shape as stockRepo: transactional, with an
// audit row written inside the same tx so they commit together.

async function createStock(fields, actor) {
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(stock).values({
      displayName:      fields.displayName,
      category:         fields.category,
      currentQuantity:  fields.qty ?? 0,
      currentCostPrice: fields.cost != null ? String(fields.cost) : null,
      currentSellPrice: fields.sell != null ? String(fields.sell) : null,
      active:           fields.active ?? true,
    }).returning();
    await tx.insert(auditLog).values({
      entityType: 'stock', entityId: row.id, action: 'create',
      diff: { before: null, after: { 'Display Name': row.displayName, 'Current Quantity': row.currentQuantity } },
      ...actor,
    });
    return row;
  });
}

async function adjustQty(stockId, delta, actor) {
  return await db.transaction(async (tx) => {
    const [before] = await tx.select().from(stock).where(eq(stock.id, stockId));
    const [after] = await tx.update(stock).set({
      currentQuantity: sql`${stock.currentQuantity} + ${delta}`,
      updatedAt: new Date(),
    }).where(eq(stock.id, stockId)).returning();
    await tx.insert(auditLog).values({
      entityType: 'stock', entityId: stockId, action: 'update',
      diff: { before: { 'Current Quantity': before.currentQuantity }, after: { 'Current Quantity': after.currentQuantity } },
      ...actor,
    });
    return { previousQty: before.currentQuantity, newQty: after.currentQuantity };
  });
}

async function updateStock(stockId, patch, actor) {
  return await db.transaction(async (tx) => {
    const [before] = await tx.select().from(stock).where(eq(stock.id, stockId));
    const [after]  = await tx.update(stock).set({ ...patch, updatedAt: new Date() }).where(eq(stock.id, stockId)).returning();
    await tx.insert(auditLog).values({
      entityType: 'stock', entityId: stockId, action: 'update',
      diff: { before: pickChanged(before, after), after: pickChanged(after, before) },
      ...actor,
    });
    return after;
  });
}

async function softDelete(stockId, actor) {
  return await db.transaction(async (tx) => {
    const [before] = await tx.select().from(stock).where(eq(stock.id, stockId));
    const [after]  = await tx.update(stock).set({ deletedAt: new Date(), active: false, updatedAt: new Date() }).where(eq(stock.id, stockId)).returning();
    await tx.insert(auditLog).values({
      entityType: 'stock', entityId: stockId, action: 'delete',
      diff: { before: { 'Display Name': before.displayName, 'Current Quantity': before.currentQuantity }, after: null },
      ...actor,
    });
    return after;
  });
}

async function restore(stockId, actor) {
  return await db.transaction(async (tx) => {
    const [before] = await tx.select().from(stock).where(eq(stock.id, stockId));
    const [after]  = await tx.update(stock).set({ deletedAt: null, active: true, updatedAt: new Date() }).where(eq(stock.id, stockId)).returning();
    await tx.insert(auditLog).values({
      entityType: 'stock', entityId: stockId, action: 'restore',
      diff: { before: { active: before.active }, after: { active: after.active } },
      ...actor,
    });
    return after;
  });
}

function pickChanged(before, after) {
  const out = {};
  for (const k of Object.keys(before)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = before[k];
  }
  return out;
}

// ── Walkthrough ──

console.log(fmt.step(1, 'Morning backfill — seed 5 stock rows'));
const SEED = [
  { displayName: 'Red Rose',     category: 'Roses',  qty: 50, cost: 4.5, sell: 15 },
  { displayName: 'Pink Tulip',   category: 'Tulips', qty: 30, cost: 3.0, sell: 10 },
  { displayName: 'White Lily',   category: 'Lilies', qty: 20, cost: 6.0, sell: 22 },
  { displayName: 'Yellow Daisy', category: 'Other',  qty: 40, cost: 2.0, sell: 8  },
  { displayName: 'Blue Iris',    category: 'Other',  qty: 15, cost: 5.5, sell: 18 },
];
const items = {};
for (const s of SEED) {
  items[s.displayName] = await createStock(s, { actorRole: 'system' });
}
console.log(fmt.ok(`Inserted ${SEED.length} rows.`));
await dumpStockState();

console.log(fmt.step(2, "Florist composes a bouquet for Maria's order — deduct 12 Red Roses + 5 White Lilies"));
await adjustQty(items['Red Rose'].id, -12, { actorRole: 'florist' });
await adjustQty(items['White Lily'].id, -5, { actorRole: 'florist' });
console.log(fmt.info('Expected: Red Rose 50→38, White Lily 20→15'));
await assertQty('Red Rose', 38);
await assertQty('White Lily', 15);

console.log(fmt.step(3, "Driver delivers Maria's order — no stock movement (pure status change in real app)"));
console.log(fmt.info('Stock subsystem sees nothing here.'));

console.log(fmt.step(4, 'Owner edits the Ready bouquet — swaps 2 Red Roses for 2 Pink Tulips'));
await adjustQty(items['Red Rose'].id, +2, { actorRole: 'owner' });    // return
await adjustQty(items['Pink Tulip'].id, -2, { actorRole: 'owner' });   // deduct
console.log(fmt.info('Expected: Red Rose 38→40, Pink Tulip 30→28'));
await assertQty('Red Rose', 40);
await assertQty('Pink Tulip', 28);

console.log(fmt.step(5, "Owner cancels Maria's order — return 10 Red Roses + 5 White Lilies + 2 Pink Tulips to stock"));
await adjustQty(items['Red Rose'].id, +10, { actorRole: 'owner' });
await adjustQty(items['White Lily'].id, +5, { actorRole: 'owner' });
await adjustQty(items['Pink Tulip'].id, +2, { actorRole: 'owner' });
console.log(fmt.info('Expected back to seed: Red Rose 50, White Lily 20, Pink Tulip 30'));
await assertQty('Red Rose', 50);
await assertQty('White Lily', 20);
await assertQty('Pink Tulip', 30);

console.log(fmt.step(6, 'PO delivery received — Yellow Daisy +30, Blue Iris +20'));
await adjustQty(items['Yellow Daisy'].id, +30, { actorRole: 'driver', actorPinLabel: 'Timur' });
await adjustQty(items['Blue Iris'].id, +20, { actorRole: 'driver', actorPinLabel: 'Timur' });
await assertQty('Yellow Daisy', 70);
await assertQty('Blue Iris', 35);

console.log(fmt.step(7, 'Florist write-off: 4 wilted Yellow Daisies'));
await updateStock(items['Yellow Daisy'].id, { currentQuantity: 70 - 4, deadStems: 4 }, { actorRole: 'florist' });
await assertQty('Yellow Daisy', 66);

console.log(fmt.step(8, 'Concurrent burst — 10 simultaneous -3 deductions on Red Rose'));
const beforeBurst = (await db.select().from(stock).where(eq(stock.id, items['Red Rose'].id)))[0].currentQuantity;
const burst = Array.from({ length: 10 }, () =>
  adjustQty(items['Red Rose'].id, -3, { actorRole: 'florist' })
);
await Promise.all(burst);
const afterBurst = (await db.select().from(stock).where(eq(stock.id, items['Red Rose'].id)))[0].currentQuantity;
console.log(fmt.info(`Before: ${beforeBurst}, After: ${afterBurst}, Expected: ${beforeBurst - 30}`));
if (afterBurst === beforeBurst - 30) {
  console.log(fmt.ok('Atomicity holds — no lost updates.'));
} else {
  console.log(fmt.warn(`LOST UPDATES: expected ${beforeBurst - 30}, got ${afterBurst}`));
  process.exit(1);
}

console.log(fmt.step(9, 'Soft-delete Blue Iris (owner discontinues) → restore it (mistake)'));
await softDelete(items['Blue Iris'].id, { actorRole: 'owner' });
const irisAfterDelete = (await db.select().from(stock).where(eq(stock.id, items['Blue Iris'].id)))[0];
console.log(fmt.info(`Blue Iris after soft-delete: deleted_at=${irisAfterDelete.deletedAt ? 'SET' : 'null'}, active=${irisAfterDelete.active}`));

await restore(items['Blue Iris'].id, { actorRole: 'owner' });
const irisAfterRestore = (await db.select().from(stock).where(eq(stock.id, items['Blue Iris'].id)))[0];
console.log(fmt.info(`Blue Iris after restore:  deleted_at=${irisAfterRestore.deletedAt ? 'SET' : 'null'}, active=${irisAfterRestore.active}, qty=${irisAfterRestore.currentQuantity}`));

console.log(fmt.step(10, 'Final state + audit log summary'));
await dumpStockState();
await dumpAuditSummary();

await pg.close();
console.log('\n\x1b[32mSimulation complete — all assertions held.\x1b[0m\n');

// ── helpers ──
async function dumpStockState() {
  const rows = await db.select().from(stock);
  const rendered = rows.map(r => ({
    name: r.displayName,
    cat: r.category,
    qty: r.currentQuantity,
    cost: r.currentCostPrice,
    sell: r.currentSellPrice,
    active: String(r.active),
    deleted: r.deletedAt ? '✗' : '',
  }));
  console.log(fmt.table(rendered, ['name', 'cat', 'qty', 'cost', 'sell', 'active', 'deleted']));
}

async function assertQty(name, expected) {
  const item = items[name];
  const [fresh] = await db.select().from(stock).where(eq(stock.id, item.id));
  const got = fresh.currentQuantity;
  if (got !== expected) {
    console.log(fmt.warn(`${name}: expected ${expected}, got ${got}`));
    process.exit(1);
  }
  console.log(fmt.ok(`${name}: ${got} (expected ${expected})`));
}

async function dumpAuditSummary() {
  const audits = await db.select().from(auditLog);
  const byActorAction = {};
  for (const a of audits) {
    const k = `${a.actorRole}:${a.action}`;
    byActorAction[k] = (byActorAction[k] || 0) + 1;
  }
  const rows = Object.entries(byActorAction)
    .map(([k, c]) => { const [actor, action] = k.split(':'); return { actor, action, count: c }; })
    .sort((a, b) => b.count - a.count);
  console.log('\n  Audit log by actor + action:');
  console.log(fmt.table(rows, ['actor', 'action', 'count']));
  console.log(fmt.info(`Total audit rows: ${audits.length}`));
}
