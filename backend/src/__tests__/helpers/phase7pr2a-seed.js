// Seeds ALL fixture tables into Postgres directly from the JSON fixture file.
// Replaces the airtable-mock bridge in routes/test.js — reads JSON, inserts PG,
// returns ID maps so callers can do recXXX → uuid lookups if needed.
//
// Used by /test/reset (routes/test.js) so each E2E spec starts with a clean,
// consistent state. The field mapping here MUST match the mapping that
// routes/test.js used previously (via _getTable → PG insert) — the E2E
// suite's assertions depend on the exact fixture values.
//
// Insert order: stock → customers → orders → order_lines → deliveries.
// FK-safe TRUNCATE runs first with CASCADE so foreign-key constraints can't
// block the re-seed.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import {
  stock,
  customers,
  orders,
  orderLines,
  deliveries,
  appConfig,
  floristHours,
  marketingSpend,
  stockLossLog,
  stockPurchases,
  productConfig,
  syncLog,
  webhookLog,
  stockOrders,
  stockOrderLines,
  premadeBouquets,
  premadeBouquetLines,
} from '../../db/schema.js';
import { seedPhase7 } from './phase7-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '../../services/__fixtures__/airtable-test-base.json');

export function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
}

/**
 * Truncate every PG table and re-seed from the JSON fixture.
 *
 * Returns ID maps (recXXX → PG uuid) that callers may use for assertions.
 * Also calls seedPhase7(db) after seeding stock so Phase 7 PO + premade-bouquet
 * fixtures have real stock FK targets.
 */
export async function seedAllFromFixture(db) {
  if (!db) return {};

  const fixture = loadFixture();

  // Truncate in FK-safe order. CASCADE handles all child rows automatically.
  await db.execute(sql`TRUNCATE TABLE
    deliveries, order_lines, orders,
    premade_bouquet_lines, premade_bouquets,
    stock_order_lines, stock_orders,
    stock_purchases, stock,
    legacy_orders, key_people, customers,
    florist_hours, marketing_spend, stock_loss_log,
    app_config,
    audit_log, parity_log, sync_log, webhook_log, product_config,
    feedback_sessions
    RESTART IDENTITY CASCADE`);

  // ── STOCK ──────────────────────────────────────────────────────────────────
  const stockIdMap = new Map(); // recXXX → PG uuid
  const stockRows = fixture.tblMockStock || [];
  for (const r of stockRows) {
    const [row] = await db.insert(stock).values({
      airtableId:       r.id,
      displayName:      r['Display Name'],
      purchaseName:     r['Purchase Name'] || null,
      category:         r.Category || null,
      currentQuantity:  Number(r['Current Quantity'] ?? 0),
      unit:             r.Unit || null,
      currentCostPrice: r['Current Cost Price'] != null ? String(r['Current Cost Price']) : null,
      currentSellPrice: r['Current Sell Price'] != null ? String(r['Current Sell Price']) : null,
      supplier:         r.Supplier || null,
      reorderThreshold: r['Reorder Threshold'] != null ? Number(r['Reorder Threshold']) : null,
      active:           Boolean(r.Active),
      deadStems:        Number(r['Dead/Unsold Stems'] ?? 0),
      lotSize:          r['Lot Size'] != null ? Number(r['Lot Size']) : null,
      farmer:           r.Farmer || null,
      lastRestocked:    r['Last Restocked'] || null,
    }).returning({ id: stock.id });
    stockIdMap.set(r.id, row.id);
  }

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  const customerIdMap = new Map(); // recXXX → PG uuid
  const customerRows = fixture.tblMockCustomers || [];
  for (const r of customerRows) {
    const [row] = await db.insert(customers).values({
      airtableId:          r.id,
      name:                r.Name || r.Nickname || '(unnamed)',
      nickname:            r.Nickname || null,
      phone:               r.Phone || null,
      email:               r.Email || null,
      language:            r.Language || null,
      homeAddress:         r['Home address'] || null,
      sexBusiness:         r['Sex / Business'] || null,
      segment:             r['Segment (client)'] || null,
      communicationMethod: r['Communication method'] || null,
      orderSource:         r['Order Source'] || null,
    }).returning({ id: customers.id });
    customerIdMap.set(r.id, row.id);
  }

  // ── ORDERS ─────────────────────────────────────────────────────────────────
  const orderIdMap = new Map(); // recXXX → PG uuid
  const orderRows = fixture.tblMockOrders || [];
  for (const r of orderRows) {
    // Map the customer recXXX → PG uuid (fall back to the recXXX string if
    // the customer wasn't in the fixture — keeps FK as text during cutover).
    const customerRecId = r.Customer?.[0];
    const customerUuid  = customerIdMap.get(customerRecId) || customerRecId || 'unknown';

    const [row] = await db.insert(orders).values({
      airtableId:          r.id,
      appOrderId:          r['App Order ID'],
      customerId:          customerUuid,
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
    orderIdMap.set(r.id, row.id);
  }

  // ── ORDER LINES ────────────────────────────────────────────────────────────
  let lineCount = 0;
  const lineRows = fixture.tblMockOrderLines || [];
  for (const r of lineRows) {
    const orderRecId = r.Order?.[0];
    const orderUuid  = orderIdMap.get(orderRecId);
    if (!orderUuid) continue; // orphan line — skip gracefully

    await db.insert(orderLines).values({
      airtableId:       r.id,
      orderId:          orderUuid,
      stockItemId:      r['Stock Item']?.[0] || null,
      flowerName:       r['Flower Name'] || '',
      quantity:         Number(r.Quantity ?? 0),
      costPricePerUnit: r['Cost Price Per Unit'] != null ? String(r['Cost Price Per Unit']) : null,
      sellPricePerUnit: r['Sell Price Per Unit'] != null ? String(r['Sell Price Per Unit']) : null,
      stockDeferred:    Boolean(r['Stock Deferred']),
    });
    lineCount++;
  }

  // ── DELIVERIES ─────────────────────────────────────────────────────────────
  let deliveryCount = 0;
  const deliveryRows = fixture.tblMockDeliveries || [];
  for (const r of deliveryRows) {
    const orderRecId = r['Linked Order']?.[0];
    const orderUuid  = orderIdMap.get(orderRecId);
    if (!orderUuid) continue; // orphan delivery — skip gracefully

    await db.insert(deliveries).values({
      airtableId:         r.id,
      orderId:            orderUuid,
      deliveryAddress:    r['Delivery Address'] || null,
      recipientName:      r['Recipient Name'] || null,
      recipientPhone:     r['Recipient Phone'] || null,
      deliveryDate:       r['Delivery Date'] || null,
      deliveryTime:       r['Delivery Time'] || null,
      assignedDriver:     r['Assigned Driver'] || null,
      deliveryFee:        r['Delivery Fee'] != null ? String(r['Delivery Fee']) : null,
      driverInstructions: r['Driver Instructions'] || null,
      deliveryMethod:     r['Delivery Method'] || null,
      driverPayout:       r['Driver Payout'] != null ? String(r['Driver Payout']) : null,
      status:             r.Status || 'Pending',
    });
    deliveryCount++;
  }

  // ── APP CONFIG ─────────────────────────────────────────────────────────────
  // Fixture records: { id, Key, Value } — stored as key/jsonb in PG.
  const configRows = fixture.tblMockAppConfig || [];
  for (const r of configRows) {
    if (!r.Key) continue;
    // Value from fixture is always a string — try to parse as JSON, fall back to
    // wrapping in a string so the jsonb column gets valid JSON.
    let pgValue;
    try {
      pgValue = JSON.parse(r.Value);
    } catch {
      pgValue = r.Value;
    }
    await db.insert(appConfig).values({ key: r.Key, value: pgValue })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: pgValue } });
  }

  // ── FLORIST HOURS (empty in fixture) ──────────────────────────────────────
  const hoursRows = fixture.tblMockFloristHours || [];
  for (const r of hoursRows) {
    await db.insert(floristHours).values({
      airtableId:    r.id,
      name:          r.Name || '',
      date:          r.Date || new Date().toISOString().split('T')[0],
      hours:         r.Hours != null ? String(r.Hours) : '0',
      hourlyRate:    r['Hourly Rate'] != null ? String(r['Hourly Rate']) : '0',
      rateType:      r['Rate Type'] || null,
      bonus:         r.Bonus != null ? String(r.Bonus) : '0',
      deduction:     r.Deduction != null ? String(r.Deduction) : '0',
      notes:         r.Notes || '',
      deliveryCount: Number(r['Delivery Count'] ?? 0),
    });
  }

  // ── MARKETING SPEND (empty in fixture) ────────────────────────────────────
  const marketingRows = fixture.tblMockMarketingSpend || [];
  for (const r of marketingRows) {
    await db.insert(marketingSpend).values({
      airtableId: r.id,
      month:      r.Month || new Date().toISOString().split('T')[0],
      channel:    r.Channel || '',
      amount:     String(r.Amount ?? 0),
      notes:      r.Notes || '',
    });
  }

  // ── STOCK LOSS LOG (empty in fixture) ─────────────────────────────────────
  const lossRows = fixture.tblMockStockLossLog || [];
  for (const r of lossRows) {
    const stockUuid = stockIdMap.get(r['Stock Item']?.[0]) || null;
    await db.insert(stockLossLog).values({
      airtableId: r.id,
      date:       r.Date || new Date().toISOString().split('T')[0],
      stockId:    stockUuid,
      quantity:   String(r.Quantity ?? 0),
      reason:     r.Reason || '',
      notes:      r.Notes || '',
    });
  }

  // ── STOCK PURCHASES (empty in fixture) ────────────────────────────────────
  const purchaseRows = fixture.tblMockStockPurchases || [];
  for (const r of purchaseRows) {
    const stockUuid = stockIdMap.get(r['Stock Item']?.[0]) || null;
    await db.insert(stockPurchases).values({
      airtableId:        r.id,
      purchaseDate:      r['Purchase Date'] || new Date().toISOString().split('T')[0],
      supplier:          r.Supplier || '',
      stockId:           stockUuid,
      stockAirtableId:   r['Stock Item']?.[0] || null,
      quantityPurchased: Number(r['Quantity Purchased'] ?? 0),
      pricePerUnit:      r['Price Per Unit'] != null ? String(r['Price Per Unit']) : null,
      notes:             r.Notes || '',
    });
  }

  // ── PRODUCT CONFIG (empty in fixture) ─────────────────────────────────────
  const productConfigRows = fixture.tblMockProductConfig || [];
  for (const r of productConfigRows) {
    await db.insert(productConfig).values({
      airtableId:   r.id,
      wixProductId: r['Wix Product ID'] || null,
      wixVariantId: r['Wix Variant ID'] || null,
      productName:  r['Product Name'] || '',
      variantName:  r['Variant Name'] || '',
      sortOrder:    Number(r['Sort Order'] ?? 0),
      imageUrl:     r['Image URL'] || '',
      price:        String(r.Price ?? 0),
      leadTimeDays: Number(r['Lead Time Days'] ?? 1),
      active:       r.Active !== false,
      visibleInWix: r['Visible in Wix'] !== false,
      productType:  r['Product Type'] || null,
      minStems:     Number(r['Min Stems'] ?? 0),
      description:  r.Description || '',
      category:     r.Category || null,
      keyFlower:    r['Key Flower'] || null,
      quantity:     r.Quantity != null ? Number(r.Quantity) : null,
      availableFrom: r['Available From'] || null,
      availableTo:   r['Available To'] || null,
      translations:  r.Translations || {},
    });
  }

  // ── SYNC LOG (empty in fixture) ────────────────────────────────────────────
  const syncLogRows = fixture.tblMockSyncLog || [];
  for (const r of syncLogRows) {
    await db.insert(syncLog).values({
      timestamp:    r.Timestamp ? new Date(r.Timestamp) : new Date(),
      status:       r.Status || '',
      newProducts:  Number(r['New Products'] ?? 0),
      updated:      Number(r.Updated ?? 0),
      deactivated:  Number(r.Deactivated ?? 0),
      priceSyncs:   Number(r['Price Syncs'] ?? 0),
      stockSyncs:   Number(r['Stock Syncs'] ?? 0),
      errorMessage: r['Error Message'] || '',
    });
  }

  // ── WEBHOOK LOG (empty in fixture) ────────────────────────────────────────
  const webhookLogRows = fixture.tblMockWebhookLog || [];
  for (const r of webhookLogRows) {
    await db.insert(webhookLog).values({
      wixOrderId:  r['Wix Order ID'] || '',
      status:      r.Status || '',
      timestamp:   r.Timestamp ? new Date(r.Timestamp) : new Date(),
      appOrderId:  r['App Order ID'] || null,
      error:       r.Error || null,
    });
  }

  // ── PHASE 7: Stock Orders + Premade Bouquets ───────────────────────────────
  // These tables are PG-only (no tblMock fixture keys). seedPhase7 creates
  // representative harness rows — two POs + one premade bouquet — so the
  // E2E invariants that check for exactly 2 POs keep passing.
  const phase7Seeded = await seedPhase7(db);

  return {
    stockIdMap,
    customerIdMap,
    orderIdMap,
    counts: {
      stock:     stockRows.length,
      customers: customerRows.length,
      orders:    orderRows.length,
      lines:     lineCount,
      deliveries: deliveryCount,
      ...phase7Seeded,
    },
  };
}
