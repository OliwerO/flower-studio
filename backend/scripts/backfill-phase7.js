#!/usr/bin/env node
// CATEGORY: DESTRUCTIVE — writes to prod Postgres. Idempotent (ON CONFLICT DO UPDATE).
//
// Backfills stock_orders, stock_order_lines, premade_bouquets, premade_bouquet_lines
// from the frozen Airtable snapshot. Run once before the Phase 7 deploy flips the
// code to PG-only.
//
// Usage:
//   AIRTABLE_API_KEY=... AIRTABLE_BASE_ID=... DATABASE_URL=... \
//   node backend/scripts/backfill-phase7.js [--dry-run]
//
// Idempotency: runs UPSERT on airtable_id. Safe to re-run if it errors mid-way.

import 'dotenv/config';
import Airtable from 'airtable';
import { db } from '../src/db/index.js';
import { stockOrders, stockOrderLines, premadeBouquets, premadeBouquetLines, stock } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

const DRY = process.argv.includes('--dry-run');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

async function fetchAll(tableId) {
  const out = [];
  await base(tableId).select({ pageSize: 100 }).eachPage((records, next) => {
    for (const r of records) out.push({ id: r.id, fields: r.fields });
    next();
  });
  return out;
}

async function findStockPgIdByAirtableId(atId) {
  if (!atId) return null;
  const [row] = await db.select({ id: stock.id }).from(stock).where(eq(stock.airtableId, atId)).limit(1);
  return row?.id || null;
}

async function backfillStockOrders() {
  console.log('[backfill] Fetching Stock Orders from Airtable…');
  const headers = await fetchAll(process.env.AIRTABLE_STOCK_ORDERS_TABLE);
  const lines   = await fetchAll(process.env.AIRTABLE_STOCK_ORDER_LINES_TABLE);
  console.log(`[backfill] ${headers.length} POs, ${lines.length} lines`);

  // Map Airtable PO id → PG uuid. Pre-populate from existing PG rows so a
  // re-run can resolve line links even when the header upsert is a no-op.
  const poIdMap = new Map();
  if (!DRY && headers.length > 0) {
    const existing = await db.select({ id: stockOrders.id, airtableId: stockOrders.airtableId }).from(stockOrders);
    for (const r of existing) if (r.airtableId) poIdMap.set(r.airtableId, r.id);
  }

  for (const h of headers) {
    const f = h.fields;
    const values = {
      airtableId:        h.id,
      poNumber:          f['Stock Order ID'] || '',
      status:            f.Status || 'Draft',
      createdDate:       f['Created Date'] || '',
      assignedDriver:    f['Assigned Driver'] || '',
      plannedDate:       f['Planned Date'] || null,
      notes:             f.Notes || '',
      supplierPayments:  String(f['Supplier Payments'] ?? ''),
      driverPayment:     String(f['Driver Payment'] ?? ''),
    };
    if (DRY) { console.log(`[dry] would upsert PO ${h.id} → ${values.poNumber}`); continue; }

    const updateSet = { ...values };
    delete updateSet.airtableId;  // do not overwrite key
    const [row] = await db.insert(stockOrders).values(values)
      .onConflictDoUpdate({
        target: stockOrders.airtableId,
        set: updateSet,
      })
      .returning();
    poIdMap.set(h.id, row.id);
  }

  for (const l of lines) {
    const f = l.fields;
    const poAirtableId = Array.isArray(f['Stock Orders']) ? f['Stock Orders'][0] : null;
    if (!poAirtableId) { console.warn(`[backfill] line ${l.id} has no PO link, skipping`); continue; }
    const poPgId = poIdMap.get(poAirtableId);
    if (!poPgId) { console.warn(`[backfill] line ${l.id} references missing PO ${poAirtableId}, skipping`); continue; }

    const stockAtId = Array.isArray(f['Stock Item']) ? f['Stock Item'][0] : null;
    const stockPgId = await findStockPgIdByAirtableId(stockAtId);

    const values = {
      airtableId:               l.id,
      poId:                     poPgId,
      stockId:                  stockPgId,
      stockAirtableId:          stockAtId || null,
      flowerName:               String(f['Flower Name'] || ''),
      quantityNeeded:           Number(f['Quantity Needed']) || 0,
      quantityFound:            Number(f['Quantity Found']) || 0,
      lotSize:                  Number(f['Lot Size']) || 0,
      driverStatus:             f['Driver Status'] || 'Pending',
      supplier:                 f.Supplier || '',
      costPrice:                String(Number(f['Cost Price']) || 0),
      sellPrice:                String(Number(f['Sell Price']) || 0),
      farmer:                   f.Farmer || '',
      notes:                    f.Notes || '',
      substituteFlowerName:     f['Alt Flower Name'] || '',
      substituteStatus:         f['Alt Flower Status'] || '',
      substituteQuantityFound:  Number(f['Alt Quantity Found']) || 0,
      substituteCost:           String(Number(f['Alt Cost']) || 0),
      substituteSupplier:       f['Alt Supplier'] || '',
      quantityAccepted:         Number(f['Quantity Accepted']) || 0,
      writeOffQty:              Number(f['Write Off Qty']) || 0,
      evalStatus:               f['Eval Status'] || '',
    };
    if (DRY) { console.log(`[dry] would upsert line ${l.id}`); continue; }

    const updateSet = { ...values };
    delete updateSet.airtableId;
    await db.insert(stockOrderLines).values(values)
      .onConflictDoUpdate({
        target: stockOrderLines.airtableId,
        set: updateSet,
      });
  }
  console.log(`[backfill] Stock Orders done.`);
}

async function backfillPremadeBouquets() {
  console.log('[backfill] Fetching Premade Bouquets from Airtable…');
  const headers = await fetchAll(process.env.AIRTABLE_PREMADE_BOUQUETS_TABLE);
  const lines   = await fetchAll(process.env.AIRTABLE_PREMADE_BOUQUET_LINES_TABLE);
  console.log(`[backfill] ${headers.length} bouquets, ${lines.length} lines`);

  const bouquetIdMap = new Map();
  if (!DRY && headers.length > 0) {
    const existing = await db.select({ id: premadeBouquets.id, airtableId: premadeBouquets.airtableId }).from(premadeBouquets);
    for (const r of existing) if (r.airtableId) bouquetIdMap.set(r.airtableId, r.id);
  }

  for (const h of headers) {
    const f = h.fields;
    const values = {
      airtableId:    h.id,
      name:          (f.Name || '').trim(),
      createdBy:     f['Created By'] || '',
      priceOverride: f['Price Override'] != null ? String(f['Price Override']) : null,
      notes:         f.Notes || '',
    };
    if (DRY) { console.log(`[dry] would upsert premade ${h.id} → ${values.name}`); continue; }
    const updateSet = { ...values };
    delete updateSet.airtableId;
    const [row] = await db.insert(premadeBouquets).values(values)
      .onConflictDoUpdate({
        target: premadeBouquets.airtableId,
        set: updateSet,
      })
      .returning();
    bouquetIdMap.set(h.id, row.id);
  }

  for (const l of lines) {
    const f = l.fields;
    const bouquetAtId = Array.isArray(f['Premade Bouquets']) ? f['Premade Bouquets'][0] : null;
    if (!bouquetAtId) continue;
    const bouquetPgId = bouquetIdMap.get(bouquetAtId);
    if (!bouquetPgId) { console.warn(`[backfill] premade line ${l.id} references missing bouquet`); continue; }

    const stockAtId = Array.isArray(f['Stock Item']) ? f['Stock Item'][0] : null;
    const stockPgId = await findStockPgIdByAirtableId(stockAtId);

    const values = {
      airtableId:        l.id,
      bouquetId:         bouquetPgId,
      stockId:           stockPgId,
      stockAirtableId:   stockAtId || null,
      flowerName:        String(f['Flower Name'] || ''),
      quantity:          Number(f.Quantity) || 0,
      costPricePerUnit:  String(Number(f['Cost Price Per Unit']) || 0),
      sellPricePerUnit:  String(Number(f['Sell Price Per Unit']) || 0),
    };
    if (DRY) continue;
    const updateSet = { ...values };
    delete updateSet.airtableId;
    await db.insert(premadeBouquetLines).values(values)
      .onConflictDoUpdate({
        target: premadeBouquetLines.airtableId,
        set: updateSet,
      });
  }
  console.log(`[backfill] Premade Bouquets done.`);
}

async function main() {
  if (DRY) console.log('[backfill] DRY-RUN. No PG writes.');
  await backfillStockOrders();
  await backfillPremadeBouquets();

  if (!DRY) {
    const [poCount]  = await db.select({ c: sql`count(*)::int` }).from(stockOrders);
    const [polCount] = await db.select({ c: sql`count(*)::int` }).from(stockOrderLines);
    const [pbCount]  = await db.select({ c: sql`count(*)::int` }).from(premadeBouquets);
    const [pblCount] = await db.select({ c: sql`count(*)::int` }).from(premadeBouquetLines);
    console.log(`[backfill] PG row counts — stock_orders=${poCount.c}, stock_order_lines=${polCount.c}, premade_bouquets=${pbCount.c}, premade_bouquet_lines=${pblCount.c}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
