// Seeds representative POs + premade bouquets into pglite for E2E tests.
// Replaces the Phase 7 mock-Airtable seed (POs + premades migrated to PG).
//
// Used by /test/reset (routes/test.js) so the harness has Phase 7 fixtures
// after every spec resets state. Stock seed must be applied first — line
// stock_id references rows already in the stock table.

import { stockOrders, stockOrderLines, premadeBouquets, premadeBouquetLines, stock } from '../../db/schema.js';

export async function seedPhase7(db) {
  if (!db) return { stockOrders: 0, stockOrderLines: 0, premadeBouquets: 0, premadeBouquetLines: 0 };

  // Reference an existing stock row if any are present. Line FK is nullable —
  // null is acceptable for a stockless harness boot.
  const [r] = await db.select({ id: stock.id }).from(stock).limit(1);
  const sampleStockId = r?.id || null;

  // Two POs spanning lifecycle (boot invariant in scripts/e2e-test.js
  // expects exactly 2 rows here).
  const [po1] = await db.insert(stockOrders).values({
    airtableId:     'recE2EPO1',
    poNumber:       'PO-20260508-1',
    status:         'Draft',
    createdDate:    '2026-05-08',
    assignedDriver: 'Timur',
  }).returning();

  const [po2] = await db.insert(stockOrders).values({
    airtableId:  'recE2EPO2',
    poNumber:    'PO-20260507-1',
    status:      'Complete',
    createdDate: '2026-05-07',
  }).returning();

  await db.insert(stockOrderLines).values([
    {
      airtableId:     'recE2EPL1',
      poId:           po1.id,
      stockId:        sampleStockId,
      flowerName:     'Red Rose',
      quantityNeeded: 25,
      driverStatus:   'Pending',
      supplier:       'Market A',
      costPrice:      '3.5',
      sellPrice:      '12',
    },
    {
      airtableId:     'recE2EPL2',
      poId:           po2.id,
      stockId:        sampleStockId,
      flowerName:     'White Tulip',
      quantityNeeded: 30,
      quantityFound:  30,
      driverStatus:   'Pending',
      supplier:       'Market B',
      costPrice:      '2.5',
      sellPrice:      '8',
    },
  ]);

  const [b1] = await db.insert(premadeBouquets).values({
    airtableId: 'recE2EPB1',
    name:       'Spring Mix',
  }).returning();

  await db.insert(premadeBouquetLines).values({
    airtableId:        'recE2EPBL1',
    bouquetId:         b1.id,
    stockId:           sampleStockId,
    flowerName:        'Red Rose',
    quantity:          5,
    costPricePerUnit:  '3.5',
    sellPricePerUnit:  '12',
  });

  return { stockOrders: 2, stockOrderLines: 2, premadeBouquets: 1, premadeBouquetLines: 1 };
}
