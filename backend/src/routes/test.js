// Test-only routes — mounted ONLY when TEST_BACKEND=mock-airtable.
//
// Endpoints:
//   POST /api/test/reset
//     Reset the mock Airtable in-memory state to the JSON fixture AND
//     truncate every PG table (audit_log, parity_log, stock, orders,
//     order_lines, deliveries) so the next spec starts clean.
//
//   GET /api/test/state
//     Returns a snapshot of the mock Airtable tables + PG row counts.
//     Useful for debugging a flaky spec without rerunning the whole suite.
//
//   GET /api/test/audit
//     Returns the audit_log table contents (post-test assertions read this
//     to verify "actor identity captured per role").
//
// Why no auth: this router only exists when the harness env vars are set,
// and start-test-backend.js refuses to boot under NODE_ENV=production. The
// shim in airtable.js refuses to load the mock under NODE_ENV=production.
// Three layers of guard before the test routes can ever run on prod.

import { Router } from 'express';
import { resetToFixture, _snapshotAllTables, _getTable } from '../services/airtable-mock.js';
import { db, isPgliteMode } from '../db/index.js';
import { auditLog, parityLog, stock, orders, orderLines, deliveries } from '../db/schema.js';
import { TABLES } from '../config/airtable.js';
import { sql } from 'drizzle-orm';

const router = Router();

// Seed Postgres from the mock Airtable fixture so STOCK_BACKEND=postgres
// (and the future ORDER_BACKEND=postgres) have rows to read. This mirrors
// what backfill-stock.js does against real prod, but on a tiny in-memory
// dataset and without the Airtable rate-limit dance.
//
// Stock is the only table seeded today — once orderRepo's PG path lands
// (Phase 4), we'll seed orders + lines + deliveries here too. Customers
// stay in the mock until Phase 5.
async function seedPgFromFixture() {
  if (!db) return { stock: 0, orders: 0, lines: 0, deliveries: 0 };

  const stockRows = [..._getTable(TABLES.STOCK).values()];
  const stockInserts = stockRows.map(r => ({
    airtableId:        r.id,
    displayName:       r['Display Name'],
    purchaseName:      r['Purchase Name'] || null,
    category:          r.Category || null,
    currentQuantity:   Number(r['Current Quantity'] ?? 0),
    unit:              r.Unit || null,
    currentCostPrice:  r['Current Cost Price'] != null ? String(r['Current Cost Price']) : null,
    currentSellPrice:  r['Current Sell Price'] != null ? String(r['Current Sell Price']) : null,
    supplier:          r.Supplier || null,
    reorderThreshold:  r['Reorder Threshold'] != null ? Number(r['Reorder Threshold']) : null,
    active:            Boolean(r.Active),
    deadStems:         Number(r['Dead/Unsold Stems'] ?? 0),
    lotSize:           r['Lot Size'] != null ? Number(r['Lot Size']) : null,
    farmer:            r.Farmer || null,
    lastRestocked:     r['Last Restocked'] || null,
  }));
  if (stockInserts.length) {
    await db.insert(stock).values(stockInserts);
  }
  return { stock: stockInserts.length, orders: 0, lines: 0, deliveries: 0 };
}

router.post('/reset', async (_req, res, next) => {
  try {
    resetToFixture();

    let seeded = { stock: 0, orders: 0, lines: 0, deliveries: 0 };
    if (db) {
      // Truncate PG tables so each spec starts with empty audit/parity logs
      // and zero rows in the migrated tables. The mock Airtable side is
      // already wiped + reseeded by resetToFixture above.
      await db.execute(sql`TRUNCATE TABLE audit_log, parity_log, stock, orders, order_lines, deliveries RESTART IDENTITY CASCADE`);
      seeded = await seedPgFromFixture();
    }

    res.json({ ok: true, mode: isPgliteMode ? 'pglite' : 'real-pg', seeded });
  } catch (err) {
    next(err);
  }
});

router.get('/state', async (_req, res, next) => {
  try {
    const airtableState = _snapshotAllTables();
    const counts = {};
    if (db) {
      const tables = { auditLog, parityLog, stock, orders, orderLines, deliveries };
      for (const [name, tbl] of Object.entries(tables)) {
        const rows = await db.select().from(tbl);
        counts[name] = rows.length;
      }
    }
    res.json({ airtable: airtableState, postgresCounts: counts });
  } catch (err) {
    next(err);
  }
});

// audit_log.id and parity_log.id are bigserial → drizzle returns them as
// JS BigInt. Express's res.json() can't serialize BigInt; coerce to
// strings on the way out so the test client can parse them.
function bigintSafe(rows) {
  return rows.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = typeof v === 'bigint' ? v.toString() : v;
    }
    return out;
  });
}

router.get('/audit', async (_req, res, next) => {
  try {
    if (!db) return res.json([]);
    const rows = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    res.json(bigintSafe(rows));
  } catch (err) {
    next(err);
  }
});

router.get('/parity', async (_req, res, next) => {
  try {
    if (!db) return res.json([]);
    const rows = await db.select().from(parityLog).orderBy(parityLog.createdAt);
    res.json(bigintSafe(rows));
  } catch (err) {
    next(err);
  }
});

export default router;
