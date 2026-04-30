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

  // Seed orders + lines + deliveries when ORDER_BACKEND uses Postgres.
  // The fixture's customer_id column holds the recXXX ids — Phase 5 migrates
  // those to a uuid FK; until then text is fine.
  const orderBackend = (process.env.ORDER_BACKEND || 'airtable').toLowerCase();
  let orderCount = 0, lineCount = 0, deliveryCount = 0;
  if (orderBackend === 'postgres') {
    const orderRows = [..._getTable(TABLES.ORDERS).values()];
    const orderIdMap = new Map(); // airtable rec → PG uuid
    for (const r of orderRows) {
      const [inserted] = await db.insert(orders).values({
        airtableId:          r.id,
        appOrderId:          r['App Order ID'],
        customerId:          (r.Customer?.[0]) || 'unknown',
        status:              r.Status || 'New',
        deliveryType:        r['Delivery Type'],
        orderDate:           r['Order Date'] || new Date().toISOString().split('T')[0],
        requiredBy:          r['Required By'] || null,
        deliveryTime:        r['Delivery Time'] || null,
        customerRequest:     r['Customer Request'] || null,
        notesOriginal:       r['Notes Original'] || null,
        floristNote:         r['Florist Note'] || null,
        greetingCardText:    r['Greeting Card Text'] || null,
        source:              r.Source || null,
        communicationMethod: r['Communication method'] || null,
        paymentStatus:       r['Payment Status'] || 'Unpaid',
        paymentMethod:       r['Payment Method'] || null,
        priceOverride:       r['Price Override'] != null ? String(r['Price Override']) : null,
        deliveryFee:         r['Delivery Fee'] != null ? String(r['Delivery Fee']) : null,
        createdBy:           r['Created By'] || null,
        payment1Amount:      r['Payment 1 Amount'] != null ? String(r['Payment 1 Amount']) : null,
        payment1Method:      r['Payment 1 Method'] || null,
      }).returning({ id: orders.id });
      orderIdMap.set(r.id, inserted.id);
      orderCount++;
    }

    const lineRows = [..._getTable(TABLES.ORDER_LINES).values()];
    for (const r of lineRows) {
      const orderRecId = r.Order?.[0];
      const orderUuid = orderIdMap.get(orderRecId);
      if (!orderUuid) continue;
      await db.insert(orderLines).values({
        airtableId:        r.id,
        orderId:           orderUuid,
        stockItemId:       r['Stock Item']?.[0] || null,
        flowerName:        r['Flower Name'] || '',
        quantity:          Number(r.Quantity ?? 0),
        costPricePerUnit:  r['Cost Price Per Unit'] != null ? String(r['Cost Price Per Unit']) : null,
        sellPricePerUnit:  r['Sell Price Per Unit'] != null ? String(r['Sell Price Per Unit']) : null,
        stockDeferred:     Boolean(r['Stock Deferred']),
      });
      lineCount++;
    }

    const deliveryRows = [..._getTable(TABLES.DELIVERIES).values()];
    for (const r of deliveryRows) {
      const orderRecId = r['Linked Order']?.[0];
      const orderUuid = orderIdMap.get(orderRecId);
      if (!orderUuid) continue;
      await db.insert(deliveries).values({
        airtableId:        r.id,
        orderId:           orderUuid,
        deliveryAddress:   r['Delivery Address'] || null,
        recipientName:     r['Recipient Name'] || null,
        recipientPhone:    r['Recipient Phone'] || null,
        deliveryDate:      r['Delivery Date'] || null,
        deliveryTime:      r['Delivery Time'] || null,
        assignedDriver:    r['Assigned Driver'] || null,
        deliveryFee:       r['Delivery Fee'] != null ? String(r['Delivery Fee']) : null,
        driverInstructions: r['Driver Instructions'] || null,
        deliveryMethod:    r['Delivery Method'] || null,
        driverPayout:      r['Driver Payout'] != null ? String(r['Driver Payout']) : null,
        status:            r.Status || 'Pending',
      });
      deliveryCount++;
    }
  }

  return { stock: stockInserts.length, orders: orderCount, lines: lineCount, deliveries: deliveryCount };
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
