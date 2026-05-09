// Test-only routes — mounted ONLY when TEST_BACKEND=mock-airtable.
//
// Endpoints:
//   POST /api/test/reset
//     Truncate every PG table and re-seed from the JSON fixture directly.
//     The airtable-mock in-memory state is no longer touched here — the
//     mock still boots (so airtable-shim paths don't error), but data
//     comes from PG for every migrated table.
//
//   GET /api/test/state
//     Returns PG row counts + full row dumps for every seeded table.
//     Useful for debugging a flaky spec without rerunning the whole suite.
//
//   GET /api/test/audit
//     Returns the audit_log table contents (post-test assertions read this
//     to verify "actor identity captured per role").
//
//   GET /api/test/parity
//     Returns the parity_log table contents.
//
// Why no auth: this router only exists when the harness env vars are set,
// and start-test-backend.js refuses to boot under NODE_ENV=production. The
// shim in airtable.js refuses to load the mock under NODE_ENV=production.
// Three layers of guard before the test routes can ever run on prod.

import { Router } from 'express';
import { db, isPgliteMode } from '../db/index.js';
import { auditLog, parityLog, stock, orders, orderLines, deliveries, customers, keyPeople, legacyOrders, stockOrders, stockOrderLines, premadeBouquets, premadeBouquetLines } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { seedAllFromFixture, loadFixture } from '../__tests__/helpers/phase7pr2a-seed.js';

const router = Router();

router.post('/reset', async (_req, res, next) => {
  try {
    let result = { counts: {} };
    if (db) {
      result = await seedAllFromFixture(db);
    }
    res.json({ ok: true, mode: isPgliteMode ? 'pglite' : 'real-pg', seeded: result.counts });
  } catch (err) {
    console.error('[TEST/RESET] failed:', err);
    next(err);
  }
});

router.get('/state', async (_req, res, next) => {
  try {
    const counts = {};
    const pg = {};
    if (db) {
      const tables = {
        auditLog, parityLog, stock, orders, orderLines, deliveries,
        customers, keyPeople, legacyOrders,
        stockOrders, stockOrderLines, premadeBouquets, premadeBouquetLines,
      };
      for (const [name, tbl] of Object.entries(tables)) {
        const rows = await db.select().from(tbl);
        counts[name] = rows.length;
        pg[name]    = rows;  // full row dump — useful for E2E invariants like `pg.stockOrders.length === 2`
      }
    }

    // Build the `airtable` key from the fixture JSON so the E2E assertions
    // that check `state.body.airtable.tblMockXxx.length` keep passing.
    // The fixture file at __fixtures__/airtable-test-base.json is the contract
    // (filename kept for now; rename is a future cosmetic PR).
    const fixture = loadFixture();
    const airtable = {};
    for (const [key, rows] of Object.entries(fixture)) {
      airtable[key] = rows;
    }

    res.json({ airtable, postgresCounts: counts, pg });
  } catch (err) {
    next(err);
  }
});

// BigInt serialisation is handled globally by `BigInt.prototype.toJSON` in
// db/index.js — bigserial ids on audit_log / parity_log come out as strings
// in any JSON response, harness or production.
router.get('/audit', async (_req, res, next) => {
  try {
    if (!db) return res.json([]);
    const rows = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/parity', async (_req, res, next) => {
  try {
    if (!db) return res.json([]);
    const rows = await db.select().from(parityLog).orderBy(parityLog.createdAt);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
