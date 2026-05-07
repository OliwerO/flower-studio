// Order repository — the persistence boundary for Orders, Order Lines,
// and Deliveries (the trio that always migrates together).
//
// Phase 4 of the SQL migration. See docs/migration/phase-4-orders-design.md
// for the full rationale.
//
// Three modes selectable via ORDER_BACKEND (independent of STOCK_BACKEND):
//
//   'airtable' (default) → today's behaviour. orderService still talks
//                          to airtable.js directly; this repo's stubs at
//                          the top of each method are no-ops.
//   'shadow'             → write Airtable first (source of truth), then
//                          mirror order + lines + delivery to PG in one
//                          transaction (best-effort; failures land in
//                          parity_log). Reads from Airtable.
//   'postgres'           → write to PG only (one tx for order + lines +
//                          delivery + stock adjustments). Airtable
//                          becomes a frozen legacy snapshot for orders.
//
// The headline architectural win, made concrete in createOrder:
//   - Today: 538-line manual try/catch with explicit unwinding of
//     created lines + reversed stock adjustments + deleted order.
//   - After this file: a single db.transaction(...) that wraps everything.
//     Any throw rolls every write back automatically — no manual
//     bookkeeping, no half-torn-down state.

import * as airtable from '../services/airtable.js';
import * as stockRepo from './stockRepo.js';
import * as stockLossRepo from './stockLossRepo.js';
import { TABLES } from '../config/airtable.js';
import { db } from '../db/index.js';
import { orders, orderLines, deliveries } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';
import { and, or, eq, isNull, inArray, gte, lte, sql, desc, asc } from 'drizzle-orm';

// ── Backend mode ──
const VALID_MODES = new Set(['airtable', 'shadow', 'postgres']);
function readMode() {
  const m = (process.env.ORDER_BACKEND || 'airtable').toLowerCase();
  return VALID_MODES.has(m) ? m : 'airtable';
}
let MODE = readMode();
export function getBackendMode() { return MODE; }
export function _setMode(m) {
  if (!VALID_MODES.has(m)) throw new Error(`Invalid ORDER_BACKEND: ${m}`);
  MODE = m;
}
export function _resetMode() { MODE = readMode(); }

// ── PATCH allowlists ──
export const ORDER_WRITE_ALLOWED = [
  'Customer', 'Customer Request', 'Source', 'Delivery Type',
  'Order Date', 'Required By', 'Delivery Time',
  'Notes Original', 'Florist Note', 'Greeting Card Text',
  'Payment Status', 'Payment Method', 'Payment 1 Amount', 'Payment 1 Method',
  'Delivery Fee', 'Price Override', 'App Order ID',
  'Status', 'Created By', 'Communication method',
  'Image URL',
];

export const LINE_WRITE_ALLOWED = [
  'Order', 'Stock Item', 'Flower Name', 'Quantity',
  'Cost Price Per Unit', 'Sell Price Per Unit', 'Stock Deferred',
];

export const DELIVERY_WRITE_ALLOWED = [
  'Linked Order', 'Delivery Address', 'Recipient Name', 'Recipient Phone',
  'Delivery Date', 'Delivery Time', 'Assigned Driver', 'Delivery Fee',
  'Driver Instructions', 'Delivery Method', 'Driver Payout', 'Status',
];

// ── Wire-format ↔ PG-row mapping ──
//
// Methods always return Airtable-shaped records ({ id, 'Customer': [...],
// 'Order Lines': [...], 'Status', ... }) so the route layer's existing
// enrichment logic works unchanged across the cutover.

export function pgOrderToResponse(row, lineIds = [], deliveryId = null) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    Customer:             row.customerId ? [row.customerId] : [],
    'App Order ID':       row.appOrderId,
    'Wix Order ID':       row.wixOrderId ?? null,
    Status:               row.status,
    'Delivery Type':      row.deliveryType,
    'Order Date':         row.orderDate,
    'Required By':        row.requiredBy ?? null,
    'Delivery Time':      row.deliveryTime ?? null,
    'Customer Request':   row.customerRequest ?? null,
    'Notes Original':     row.notesOriginal ?? null,
    'Florist Note':       row.floristNote ?? null,
    'Greeting Card Text': row.greetingCardText ?? null,
    Source:               row.source ?? null,
    'Communication method': row.communicationMethod ?? null,
    'Payment Status':     row.paymentStatus,
    'Payment Method':     row.paymentMethod ?? null,
    'Price Override':     row.priceOverride != null ? Number(row.priceOverride) : null,
    'Delivery Fee':       row.deliveryFee != null ? Number(row.deliveryFee) : null,
    'Created By':         row.createdBy ?? null,
    'Payment 1 Amount':   row.payment1Amount != null ? Number(row.payment1Amount) : null,
    'Payment 1 Method':   row.payment1Method ?? null,
    'Image URL':          row.imageUrl ?? null,
    keyPersonId:          row.keyPersonId ?? null,
    'Order Lines':        lineIds,
    Deliveries:           deliveryId ? [deliveryId] : [],
  };
}

export function pgLineToResponse(row) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    Order:                row.orderId ? [row.orderId] : [],
    'Stock Item':         row.stockItemId ? [row.stockItemId] : [],
    'Flower Name':        row.flowerName,
    Quantity:             row.quantity,
    'Cost Price Per Unit': row.costPricePerUnit != null ? Number(row.costPricePerUnit) : null,
    'Sell Price Per Unit': row.sellPricePerUnit != null ? Number(row.sellPricePerUnit) : null,
    'Stock Deferred':     row.stockDeferred,
  };
}

export function pgDeliveryToResponse(row) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    'Linked Order':        row.orderId ? [row.orderId] : [],
    'Delivery Address':    row.deliveryAddress ?? null,
    'Recipient Name':      row.recipientName ?? null,
    'Recipient Phone':     row.recipientPhone ?? null,
    'Delivery Date':       row.deliveryDate ?? null,
    'Delivery Time':       row.deliveryTime ?? null,
    'Assigned Driver':     row.assignedDriver ?? null,
    'Delivery Fee':        row.deliveryFee != null ? Number(row.deliveryFee) : null,
    'Driver Instructions': row.driverInstructions ?? null,
    'Delivery Method':     row.deliveryMethod ?? null,
    'Driver Payout':       row.driverPayout != null ? Number(row.driverPayout) : null,
    Status:                row.status,
    'Delivered At':        row.deliveredAt ? new Date(row.deliveredAt).toISOString() : null,
  };
}

// Convert Airtable-shaped order fields to PG column object.
function orderResponseToPg(fields) {
  const out = {};
  if ('App Order ID' in fields)   out.appOrderId = fields['App Order ID'];
  if ('Wix Order ID' in fields)   out.wixOrderId = fields['Wix Order ID'] || null;
  if ('Customer' in fields)       out.customerId = Array.isArray(fields.Customer) ? fields.Customer[0] : fields.Customer;
  if ('Status' in fields)         out.status = fields.Status;
  if ('Delivery Type' in fields)  out.deliveryType = fields['Delivery Type'];
  if ('Order Date' in fields)     out.orderDate = fields['Order Date'];
  if ('Required By' in fields)    out.requiredBy = fields['Required By'] || null;
  if ('Delivery Time' in fields)  out.deliveryTime = fields['Delivery Time'] || null;
  if ('Customer Request' in fields) out.customerRequest = fields['Customer Request'] || null;
  if ('Notes Original' in fields) out.notesOriginal = fields['Notes Original'] || null;
  if ('Florist Note' in fields)   out.floristNote = fields['Florist Note'] || null;
  if ('Greeting Card Text' in fields) out.greetingCardText = fields['Greeting Card Text'] || null;
  if ('Source' in fields)         out.source = fields.Source || null;
  if ('Communication method' in fields) out.communicationMethod = fields['Communication method'] || null;
  if ('Payment Status' in fields) out.paymentStatus = fields['Payment Status'];
  if ('Payment Method' in fields) out.paymentMethod = fields['Payment Method'] || null;
  if ('Price Override' in fields) out.priceOverride = fields['Price Override'] != null ? String(fields['Price Override']) : null;
  if ('Delivery Fee' in fields)   out.deliveryFee = fields['Delivery Fee'] != null ? String(fields['Delivery Fee']) : null;
  if ('Created By' in fields)     out.createdBy = fields['Created By'] || null;
  if ('Payment 1 Amount' in fields) out.payment1Amount = fields['Payment 1 Amount'] != null ? String(fields['Payment 1 Amount']) : null;
  if ('Payment 1 Method' in fields) out.payment1Method = fields['Payment 1 Method'] || null;
  if ('Image URL' in fields)        out.imageUrl = fields['Image URL'] || null;
  if ('keyPersonId' in fields)      out.keyPersonId = fields.keyPersonId || null;
  return out;
}

function lineResponseToPg(fields) {
  const out = {};
  if ('Order' in fields)        out.orderId = Array.isArray(fields.Order) ? fields.Order[0] : fields.Order;
  if ('Stock Item' in fields)   out.stockItemId = Array.isArray(fields['Stock Item']) ? fields['Stock Item'][0] : (fields['Stock Item'] || null);
  if ('Flower Name' in fields)  out.flowerName = fields['Flower Name'];
  if ('Quantity' in fields)     out.quantity = Number(fields.Quantity) || 0;
  if ('Cost Price Per Unit' in fields) out.costPricePerUnit = fields['Cost Price Per Unit'] != null ? String(fields['Cost Price Per Unit']) : null;
  if ('Sell Price Per Unit' in fields) out.sellPricePerUnit = fields['Sell Price Per Unit'] != null ? String(fields['Sell Price Per Unit']) : null;
  if ('Stock Deferred' in fields) out.stockDeferred = Boolean(fields['Stock Deferred']);
  return out;
}

function deliveryResponseToPg(fields) {
  const out = {};
  if ('Linked Order' in fields)    out.orderId = Array.isArray(fields['Linked Order']) ? fields['Linked Order'][0] : fields['Linked Order'];
  if ('Delivery Address' in fields) out.deliveryAddress = fields['Delivery Address'] || null;
  if ('Recipient Name' in fields)  out.recipientName = fields['Recipient Name'] || null;
  if ('Recipient Phone' in fields) out.recipientPhone = fields['Recipient Phone'] || null;
  if ('Delivery Date' in fields)   out.deliveryDate = fields['Delivery Date'] || null;
  if ('Delivery Time' in fields)   out.deliveryTime = fields['Delivery Time'] || null;
  if ('Assigned Driver' in fields) out.assignedDriver = fields['Assigned Driver'] || null;
  if ('Delivery Fee' in fields)    out.deliveryFee = fields['Delivery Fee'] != null ? String(fields['Delivery Fee']) : null;
  if ('Driver Instructions' in fields) out.driverInstructions = fields['Driver Instructions'] || null;
  if ('Delivery Method' in fields) out.deliveryMethod = fields['Delivery Method'] || null;
  if ('Driver Payout' in fields)   out.driverPayout = fields['Driver Payout'] != null ? String(fields['Driver Payout']) : null;
  if ('Status' in fields)          out.status = fields.Status;
  if ('Delivered At' in fields)    out.deliveredAt = fields['Delivered At'] ? new Date(fields['Delivered At']) : null;
  return out;
}

// ── Internal helpers ──

async function findOrderById(id, handle = db) {
  if (!id || !handle) return null;
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const where = isAirtableId
    ? and(eq(orders.airtableId, id), isNull(orders.deletedAt))
    : and(eq(orders.id, id), isNull(orders.deletedAt));
  const [row] = await handle.select().from(orders).where(where).limit(1);
  return row ?? null;
}

async function loadChildren(orderRows, handle = db) {
  const orderIds = orderRows.map(o => o.id);
  if (orderIds.length === 0) {
    return { linesByOrderId: new Map(), deliveryByOrderId: new Map() };
  }
  const [lineRows, deliveryRows] = await Promise.all([
    handle.select().from(orderLines)
      .where(and(inArray(orderLines.orderId, orderIds), isNull(orderLines.deletedAt))),
    handle.select().from(deliveries)
      .where(and(inArray(deliveries.orderId, orderIds), isNull(deliveries.deletedAt))),
  ]);
  const linesByOrderId = new Map();
  for (const l of lineRows) {
    const arr = linesByOrderId.get(l.orderId) || [];
    arr.push(l);
    linesByOrderId.set(l.orderId, arr);
  }
  const deliveryByOrderId = new Map();
  for (const d of deliveryRows) deliveryByOrderId.set(d.orderId, d);
  return { linesByOrderId, deliveryByOrderId };
}

function renderOrderRow(orderRow, linesByOrderId, deliveryByOrderId) {
  const lines = linesByOrderId.get(orderRow.id) || [];
  const lineIds = lines.map(l => l.airtableId || l.id);
  const delivery = deliveryByOrderId.get(orderRow.id);
  const deliveryId = delivery ? (delivery.airtableId || delivery.id) : null;
  const resp = pgOrderToResponse(orderRow, lineIds, deliveryId);
  // Embed line + delivery sub-records so callers in postgres mode can skip a
  // round-trip through airtable.list (which would target PG ids the mock /
  // Airtable doesn't know about). Frontends never see these — routes strip
  // them after consuming.
  resp._lines = lines.map(pgLineToResponse);
  if (delivery) resp._delivery = pgDeliveryToResponse(delivery);
  return resp;
}

async function tryAudit(tx, args) {
  try {
    await recordAudit(tx, args);
  } catch (err) {
    console.error('[orderRepo] audit write failed:', err.message);
  }
}

// ── Read paths ──

export async function list(options = {}) {
  if (MODE === 'postgres') return listFromPg(options);
  return airtable.list(TABLES.ORDERS, options);
}

async function listFromPg(options = {}) {
  if (!db) throw new Error('orderRepo.list: postgres backend selected but DATABASE_URL not configured');
  const pg = options.pg || {};

  const filters = [isNull(orders.deletedAt)];
  if (Array.isArray(pg.statuses) && pg.statuses.length) {
    filters.push(inArray(orders.status, pg.statuses));
  }
  if (Array.isArray(pg.excludeStatuses) && pg.excludeStatuses.length) {
    for (const s of pg.excludeStatuses) filters.push(sql`${orders.status} != ${s}`);
  }
  if (pg.customerId)        filters.push(eq(orders.customerId, String(pg.customerId)));
  if (pg.dateFrom)          filters.push(gte(orders.orderDate, pg.dateFrom));
  if (pg.dateTo)            filters.push(lte(orders.orderDate, pg.dateTo));
  if (pg.requiredByFrom)    filters.push(gte(orders.requiredBy, pg.requiredByFrom));
  if (pg.requiredByTo)      filters.push(lte(orders.requiredBy, pg.requiredByTo));
  if (pg.deliveryType)      filters.push(eq(orders.deliveryType, pg.deliveryType));
  if (pg.paymentStatus)     filters.push(eq(orders.paymentStatus, pg.paymentStatus));
  if (pg.paymentMethodNotRecorded) filters.push(or(isNull(orders.paymentMethod), eq(orders.paymentMethod, '')));
  else if (pg.paymentMethod) filters.push(eq(orders.paymentMethod, pg.paymentMethod));
  if (pg.sourceOther)       filters.push(or(eq(orders.source, 'Other'), isNull(orders.source)));
  else if (pg.source)       filters.push(eq(orders.source, pg.source));
  if (pg.forDate)           filters.push(or(eq(orders.orderDate, pg.forDate), eq(orders.requiredBy, pg.forDate)));
  if (pg.orderDateFrom)     filters.push(gte(orders.orderDate, pg.orderDateFrom));
  if (pg.completedSinceFallback) {
    // "Completed in last N days" — prefer Required By; fall back to Order Date
    // when Required By is null (legacy imports).
    filters.push(or(
      gte(orders.requiredBy, pg.completedSinceFallback),
      and(isNull(orders.requiredBy), gte(orders.orderDate, pg.completedSinceFallback)),
    ));
  }

  const orderByCols = [];
  for (const s of (options.sort || [])) {
    const col = ORDER_SORT_COLS[s.field];
    if (col) orderByCols.push(s.direction === 'desc' ? desc(col) : asc(col));
  }
  if (orderByCols.length === 0) orderByCols.push(desc(orders.orderDate));

  let q = db.select().from(orders).where(and(...filters)).orderBy(...orderByCols);
  if (options.maxRecords || pg.limit) q = q.limit(Number(options.maxRecords || pg.limit));

  const orderRows = await q;
  const { linesByOrderId, deliveryByOrderId } = await loadChildren(orderRows);
  return orderRows.map(o => renderOrderRow(o, linesByOrderId, deliveryByOrderId));
}

const ORDER_SORT_COLS = {
  'Order Date':   orders.orderDate,
  'Required By':  orders.requiredBy,
  'Status':       orders.status,
};

export async function getById(id) {
  if (MODE !== 'postgres') return airtable.getById(TABLES.ORDERS, id);
  if (!db) throw new Error('orderRepo.getById: postgres backend not configured');

  const row = await findOrderById(id);
  if (!row) {
    const err = new Error(`Order not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  const { linesByOrderId, deliveryByOrderId } = await loadChildren([row]);
  return renderOrderRow(row, linesByOrderId, deliveryByOrderId);
}

// findByWixOrderId — used by the Wix webhook for idempotent dedup. In
// postgres mode the partial-unique index on wix_order_id makes this O(log n);
// the airtable path falls back to filterByFormula on the existing column.
export async function findByWixOrderId(wixOrderId) {
  if (!wixOrderId) return null;
  if (MODE !== 'postgres') {
    const matches = await airtable.list(TABLES.ORDERS, {
      filterByFormula: `{Wix Order ID} = '${wixOrderId.replace(/'/g, "\\'")}'`,
      maxRecords: 1,
    });
    return matches[0] || null;
  }
  if (!db) throw new Error('orderRepo.findByWixOrderId: postgres backend not configured');
  const [row] = await db.select().from(orders)
    .where(and(eq(orders.wixOrderId, wixOrderId), isNull(orders.deletedAt)))
    .limit(1);
  if (!row) return null;
  const { linesByOrderId, deliveryByOrderId } = await loadChildren([row]);
  return renderOrderRow(row, linesByOrderId, deliveryByOrderId);
}

// mirrorAirtableOrder — copies an Airtable-shaped order (plus its lines and
// delivery) into Postgres preserving the recXXX ids on `airtable_id`. Used
// during Phase 4 cutover by code paths that still write to Airtable first
// (Wix webhook, intake parser) so PG stays consistent with the airtable mock
// AND the eventual Railway PG. No-op in airtable mode.
export async function mirrorAirtableOrder({ order, lines = [], delivery = null }) {
  if (MODE !== 'postgres') return null;
  if (!db) throw new Error('orderRepo.mirrorAirtableOrder: postgres backend not configured');
  if (!order || !order.id) return null;

  return await db.transaction(async (tx) => {
    // Skip if already mirrored.
    const [existing] = await tx.select().from(orders)
      .where(eq(orders.airtableId, order.id))
      .limit(1);
    if (existing) return { skipped: true, orderId: existing.id };

    const orderInsert = orderResponseToPg(order);
    orderInsert.airtableId = order.id;
    if (!orderInsert.appOrderId) orderInsert.appOrderId = order['App Order ID'] || order.id;
    if (!orderInsert.customerId) orderInsert.customerId = order.Customer?.[0] || 'unknown';
    if (!orderInsert.deliveryType) orderInsert.deliveryType = order['Delivery Type'] || 'Pickup';
    if (!orderInsert.status) orderInsert.status = order.Status || ORDER_STATUS.NEW;
    if (!orderInsert.paymentStatus) orderInsert.paymentStatus = order['Payment Status'] || 'Unpaid';
    if (!orderInsert.orderDate) orderInsert.orderDate = order['Order Date'] || new Date().toISOString().split('T')[0];

    const [insertedOrder] = await tx.insert(orders).values(orderInsert).returning();

    for (const line of lines) {
      const lineInsert = lineResponseToPg(line);
      lineInsert.airtableId = line.id;
      lineInsert.orderId = insertedOrder.id;
      if (!lineInsert.flowerName) lineInsert.flowerName = line['Flower Name'] || '';
      await tx.insert(orderLines).values(lineInsert);
    }

    if (delivery) {
      const deliveryInsert = deliveryResponseToPg(delivery);
      deliveryInsert.airtableId = delivery.id;
      deliveryInsert.orderId = insertedOrder.id;
      if (!deliveryInsert.status) deliveryInsert.status = delivery.Status || DELIVERY_STATUS.PENDING;
      await tx.insert(deliveries).values(deliveryInsert);
    }

    return { skipped: false, orderId: insertedOrder.id };
  });
}

// listByIds — bulk-fetch orders by mixed Airtable / PG ids. Used by
// routes/deliveries.js to enrich linked-order info without N round-trips.
export async function listByIds(ids, { fields } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (MODE !== 'postgres') {
    return airtable.list(TABLES.ORDERS, {
      filterByFormula: `OR(${ids.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
      ...(fields ? { fields } : {}),
    });
  }
  if (!db) throw new Error('orderRepo.listByIds: postgres backend not configured');
  const airtableIds = ids.filter(id => typeof id === 'string' && id.startsWith('rec'));
  const uuidIds = ids.filter(id => !airtableIds.includes(id));
  const wheres = [];
  if (airtableIds.length) wheres.push(inArray(orders.airtableId, airtableIds));
  if (uuidIds.length)     wheres.push(inArray(orders.id, uuidIds));
  if (wheres.length === 0) return [];
  const filter = wheres.length === 1 ? wheres[0] : or(...wheres);
  const rows = await db.select().from(orders)
    .where(and(filter, isNull(orders.deletedAt)));
  const { linesByOrderId, deliveryByOrderId } = await loadChildren(rows);
  return rows.map(o => renderOrderRow(o, linesByOrderId, deliveryByOrderId));
}

// ── Deliveries: read paths ──

async function findDeliveryById(id, handle = db) {
  if (!id || !handle) return null;
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const where = isAirtableId
    ? and(eq(deliveries.airtableId, id), isNull(deliveries.deletedAt))
    : and(eq(deliveries.id, id), isNull(deliveries.deletedAt));
  const [row] = await handle.select().from(deliveries).where(where).limit(1);
  return row ?? null;
}

async function findOrderLineById(id, handle = db) {
  if (!id || !handle) return null;
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const where = isAirtableId
    ? and(eq(orderLines.airtableId, id), isNull(orderLines.deletedAt))
    : and(eq(orderLines.id, id), isNull(orderLines.deletedAt));
  const [row] = await handle.select().from(orderLines).where(where).limit(1);
  return row ?? null;
}

export async function listDeliveries(options = {}) {
  if (MODE !== 'postgres') return airtable.list(TABLES.DELIVERIES, options);
  if (!db) throw new Error('orderRepo.listDeliveries: postgres backend not configured');
  const pg = options.pg || {};

  const filters = [isNull(deliveries.deletedAt)];
  if (pg.date) {
    filters.push(or(eq(deliveries.deliveryDate, pg.date), isNull(deliveries.deliveryDate)));
  } else if (pg.from) {
    if (pg.to) {
      filters.push(and(gte(deliveries.deliveryDate, pg.from), lte(deliveries.deliveryDate, pg.to)));
    } else {
      filters.push(or(gte(deliveries.deliveryDate, pg.from), isNull(deliveries.deliveryDate)));
    }
  }
  if (pg.status) filters.push(eq(deliveries.status, pg.status));
  if (pg.driver) filters.push(eq(deliveries.assignedDriver, pg.driver));

  const rows = await db.select().from(deliveries)
    .where(and(...filters))
    .orderBy(asc(deliveries.deliveryDate));

  // Resolve linked order's airtable_id (or PG uuid) so callers see "Linked Order"
  // populated with whatever they would have gotten from Airtable.
  const orderIds = [...new Set(rows.map(r => r.orderId).filter(Boolean))];
  const orderMap = new Map();
  if (orderIds.length > 0) {
    const orderRows = await db.select().from(orders).where(inArray(orders.id, orderIds));
    for (const o of orderRows) orderMap.set(o.id, o.airtableId || o.id);
  }
  return rows.map(r => {
    const resp = pgDeliveryToResponse(r);
    const linkedId = orderMap.get(r.orderId) || null;
    resp['Linked Order'] = linkedId ? [linkedId] : [];
    return resp;
  });
}

export async function getDeliveryById(id) {
  if (MODE !== 'postgres') return airtable.getById(TABLES.DELIVERIES, id);
  if (!db) throw new Error('orderRepo.getDeliveryById: postgres backend not configured');

  const row = await findDeliveryById(id);
  if (!row) {
    const err = new Error(`Delivery not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  const resp = pgDeliveryToResponse(row);
  if (row.orderId) {
    const [linked] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1);
    if (linked) resp['Linked Order'] = [linked.airtableId || linked.id];
  }
  return resp;
}

// ── createOrder — the headline transactional rewrite ──

export async function createOrder(params, config, opts = {}) {
  const {
    customer, customerRequest, source, communicationMethod, deliveryType,
    orderLines: lines, delivery, notes, floristNote, paymentStatus, paymentMethod, priceOverride,
    requiredBy, cardText, deliveryTime, createdBy,
    payment1Amount, payment1Method, keyPersonId,
  } = params;
  const { getConfig, getDriverOfDay, generateOrderId } = config;
  const { skipStockDeduction = false, actor: rawActor } = opts;
  const actor = rawActor || { actorRole: 'system', actorPinLabel: null };

  if (MODE === 'airtable') {
    const err = new Error(
      'orderRepo.createOrder called in airtable mode — orderService.createOrder should run directly.',
    );
    err.statusCode = 500;
    throw err;
  }
  if (!db) throw new Error('orderRepo.createOrder: postgres backend not configured');

  const appOrderId = await generateOrderId();
  const resolvedDeliveryFee = deliveryType === 'Delivery'
    ? (delivery?.fee ?? getConfig('defaultDeliveryFee')) : 0;

  const flowerTotal = lines.reduce(
    (sum, l) => sum + (Number(l.sellPricePerUnit) || 0) * (Number(l.quantity) || 0), 0,
  );
  const finalPriceAtCreate = (Number(priceOverride) || flowerTotal) + resolvedDeliveryFee;
  const p1AmountBackfill = paymentStatus === 'Paid'
    && payment1Amount == null && finalPriceAtCreate > 0
    ? finalPriceAtCreate : null;
  const p1MethodBackfill = p1AmountBackfill != null && !payment1Method
    ? (paymentMethod || null) : null;

  return await db.transaction(async (tx) => {
    // 1. Insert order
    const orderFields = {
      Customer:             [customer],
      'Customer Request':   customerRequest,
      Source:               source || null,
      'Delivery Type':      deliveryType,
      'Order Date':         new Date().toISOString().split('T')[0],
      'Required By':        requiredBy || delivery?.date || null,
      'Notes Original':     notes || '',
      'Florist Note':       floristNote || '',
      'Greeting Card Text': cardText || delivery?.cardText || '',
      'Delivery Time':      deliveryTime || delivery?.time || '',
      'Payment Status':     paymentStatus,
      'Payment Method':     paymentMethod || null,
      'Delivery Fee':       resolvedDeliveryFee,
      'Price Override':     priceOverride || null,
      'App Order ID':       appOrderId,
      Status:               ORDER_STATUS.NEW,
      'Created By':         createdBy,
      'Communication method': communicationMethod || null,
      ...(payment1Amount != null ? { 'Payment 1 Amount': Number(payment1Amount) } : {}),
      ...(payment1Method ? { 'Payment 1 Method': payment1Method } : {}),
      ...(p1AmountBackfill != null ? { 'Payment 1 Amount': p1AmountBackfill } : {}),
      ...(p1MethodBackfill ? { 'Payment 1 Method': p1MethodBackfill } : {}),
      ...(keyPersonId ? { keyPersonId } : {}),
    };
    const [orderRow] = await tx.insert(orders).values(orderResponseToPg(orderFields)).returning();
    await tryAudit(tx, {
      entityType: 'order', entityId: orderRow.id, action: 'create',
      before: null, after: pgOrderToResponse(orderRow), ...actor,
    });

    // 2. Reject orphan lines
    const orphans = lines.filter(l => !l.stockItemId);
    if (orphans.length > 0) {
      const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
      const err = new Error(
        `Order line(s) without a Stock Item are not allowed: ${names}. Create the flower in Stock first.`,
      );
      err.statusCode = 400;
      throw err;  // PG transaction rolls back the order row.
    }

    // 3. Insert order lines
    const createdLines = [];
    for (const line of lines) {
      const [lineRow] = await tx.insert(orderLines).values({
        orderId:           orderRow.id,
        stockItemId:       line.stockItemId || null,
        flowerName:        line.flowerName,
        quantity:          Number(line.quantity) || 0,
        costPricePerUnit:  line.costPricePerUnit != null ? String(line.costPricePerUnit) : null,
        sellPricePerUnit:  line.sellPricePerUnit != null ? String(line.sellPricePerUnit) : null,
        stockDeferred:     line.stockDeferred === true,
      }).returning();
      createdLines.push(lineRow);
    }

    // 4. Adjust stock — via stockRepo with opts.tx so it participates in
    //    THIS transaction. Any throw rolls everything back.
    if (!skipStockDeduction) {
      for (const line of lines) {
        if (line.stockItemId && !line.stockDeferred) {
          await stockRepo.adjustQuantity(line.stockItemId, -line.quantity, { tx, actor });
        }
      }
    }

    // 5. Create delivery if needed
    let deliveryRow = null;
    if (deliveryType === 'Delivery' && delivery) {
      const [d] = await tx.insert(deliveries).values({
        orderId:            orderRow.id,
        deliveryAddress:    delivery.address || '',
        recipientName:      delivery.recipientName || '',
        recipientPhone:     delivery.recipientPhone || '',
        deliveryDate:       delivery.date || null,
        deliveryTime:       delivery.time || '',
        assignedDriver:     delivery.driver || getDriverOfDay() || null,
        deliveryFee:        delivery.fee != null ? String(delivery.fee) : String(getConfig('defaultDeliveryFee')),
        driverInstructions: delivery.driverInstructions || '',
        deliveryMethod:     'Driver',
        driverPayout:       String(getConfig('driverCostPerDelivery') || 0),
        status:             DELIVERY_STATUS.PENDING,
      }).returning();
      deliveryRow = d;
      await tryAudit(tx, {
        entityType: 'delivery', entityId: d.id, action: 'create',
        before: null, after: pgDeliveryToResponse(d), ...actor,
      });
    }

    return {
      order: pgOrderToResponse(
        orderRow,
        createdLines.map(l => l.id),
        deliveryRow?.id ?? null,
      ),
      orderLines: createdLines.map(pgLineToResponse),
      delivery: deliveryRow ? pgDeliveryToResponse(deliveryRow) : null,
    };
  });
}

// ── transitionStatus ──

const ALLOWED_TRANSITIONS = {
  [ORDER_STATUS.NEW]:              [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.IN_PROGRESS]:      [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY]:            [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]:        [],
  [ORDER_STATUS.PICKED_UP]:        [],
  [ORDER_STATUS.CANCELLED]:        [ORDER_STATUS.NEW],
};

export async function transitionStatus(orderId, newStatus, otherFields = {}, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE === 'airtable') {
    const err = new Error('orderRepo.transitionStatus called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  if (!db) throw new Error('orderRepo.transitionStatus: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findOrderById(orderId, tx);
    if (!before) {
      const err = new Error(`Order not found: ${orderId}`);
      err.statusCode = 404;
      throw err;
    }
    const currentStatus = before.status || ORDER_STATUS.NEW;
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (newStatus !== currentStatus && !allowed.includes(newStatus)) {
      const err = new Error(
        `Cannot move from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
      );
      err.statusCode = 400;
      throw err;
    }

    const orderPatch = orderResponseToPg({ Status: newStatus, ...otherFields });
    const [after] = await tx.update(orders)
      .set({ ...orderPatch, updatedAt: new Date() })
      .where(eq(orders.id, before.id))
      .returning();

    await tryAudit(tx, {
      entityType: 'order', entityId: after.id, action: 'update',
      before: { Status: before.status }, after: { Status: after.status },
      ...actor,
    });

    // Cascade order status → delivery status. Mirrors routes/orders.js rule.
    if (
      newStatus === ORDER_STATUS.OUT_FOR_DELIVERY ||
      newStatus === ORDER_STATUS.DELIVERED ||
      newStatus === ORDER_STATUS.CANCELLED
    ) {
      const [delivery] = await tx.select().from(deliveries)
        .where(and(eq(deliveries.orderId, after.id), isNull(deliveries.deletedAt)))
        .limit(1);
      if (delivery) {
        const cascadeStatus = newStatus === ORDER_STATUS.OUT_FOR_DELIVERY
          ? DELIVERY_STATUS.OUT_FOR_DELIVERY
          : newStatus === ORDER_STATUS.DELIVERED
            ? DELIVERY_STATUS.DELIVERED
            : DELIVERY_STATUS.CANCELLED;
        if (delivery.status !== cascadeStatus) {
          const cascadePatch = { status: cascadeStatus, updatedAt: new Date() };
          if (cascadeStatus === DELIVERY_STATUS.DELIVERED) {
            cascadePatch.deliveredAt = new Date();
          }
          const [updatedDelivery] = await tx.update(deliveries)
            .set(cascadePatch)
            .where(eq(deliveries.id, delivery.id))
            .returning();
          await tryAudit(tx, {
            entityType: 'delivery', entityId: updatedDelivery.id, action: 'update',
            before: { Status: delivery.status }, after: { Status: updatedDelivery.status },
            ...actor,
          });
        }
      }
    }

    const { linesByOrderId, deliveryByOrderId } = await loadChildren([after], tx);
    return renderOrderRow(after, linesByOrderId, deliveryByOrderId);
  });
}

// ── cancelWithStockReturn ──

export async function cancelWithStockReturn(orderId, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE === 'airtable') {
    const err = new Error('orderRepo.cancelWithStockReturn called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  if (!db) throw new Error('orderRepo.cancelWithStockReturn: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findOrderById(orderId, tx);
    if (!before) {
      const err = new Error(`Order not found: ${orderId}`);
      err.statusCode = 404;
      throw err;
    }
    if (before.status === ORDER_STATUS.CANCELLED) {
      const err = new Error('Order is already cancelled.');
      err.statusCode = 400;
      throw err;
    }

    const lineRows = await tx.select().from(orderLines)
      .where(and(eq(orderLines.orderId, before.id), isNull(orderLines.deletedAt)));

    const returnedItems = [];
    for (const line of lineRows) {
      if (line.stockItemId && line.quantity > 0) {
        const result = await stockRepo.adjustQuantity(line.stockItemId, line.quantity, { tx, actor });
        returnedItems.push({
          stockId:         result.stockId,
          flowerName:      line.flowerName || '?',
          quantityReturned: line.quantity,
          newStockQty:     result.newQty,
        });
      }
    }

    const [after] = await tx.update(orders)
      .set({ status: ORDER_STATUS.CANCELLED, updatedAt: new Date() })
      .where(eq(orders.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'order', entityId: after.id, action: 'update',
      before: { Status: before.status }, after: { Status: after.status },
      ...actor,
    });

    // Cascade to delivery.
    const [delivery] = await tx.select().from(deliveries)
      .where(and(eq(deliveries.orderId, after.id), isNull(deliveries.deletedAt)))
      .limit(1);
    if (delivery && delivery.status !== DELIVERY_STATUS.CANCELLED) {
      await tx.update(deliveries)
        .set({ status: DELIVERY_STATUS.CANCELLED, updatedAt: new Date() })
        .where(eq(deliveries.id, delivery.id));
      await tryAudit(tx, {
        entityType: 'delivery', entityId: delivery.id, action: 'update',
        before: { Status: delivery.status }, after: { Status: DELIVERY_STATUS.CANCELLED },
        ...actor,
      });
    }

    return { message: 'Order cancelled and stock returned.', returnedItems };
  });
}

// ── deleteOrder ──

export async function deleteOrder(orderId, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE === 'airtable') {
    const err = new Error('orderRepo.deleteOrder called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  if (!db) throw new Error('orderRepo.deleteOrder: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findOrderById(orderId, tx);
    if (!before) {
      const err = new Error(`Order not found: ${orderId}`);
      err.statusCode = 404;
      throw err;
    }
    const isTerminal = [
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.PICKED_UP,
      ORDER_STATUS.CANCELLED,
    ].includes(before.status);

    const returnedItems = [];
    if (!isTerminal) {
      const lineRows = await tx.select().from(orderLines)
        .where(and(eq(orderLines.orderId, before.id), isNull(orderLines.deletedAt)));
      for (const line of lineRows) {
        if (line.stockItemId && line.quantity > 0) {
          const result = await stockRepo.adjustQuantity(line.stockItemId, line.quantity, { tx, actor });
          returnedItems.push({
            stockId: result.stockId,
            flowerName: line.flowerName,
            quantityReturned: line.quantity,
          });
        }
      }
    }

    await tryAudit(tx, {
      entityType: 'order', entityId: before.id, action: 'delete',
      before: pgOrderToResponse(before), after: null, ...actor,
    });

    // Hard delete. ON DELETE CASCADE handles lines + delivery.
    await tx.delete(orders).where(eq(orders.id, before.id));

    return { deleted: true, orderId, returnedItems };
  });
}

// ── editBouquetLines ──

export async function editBouquetLines(orderId, { lines = [], removedLines = [] }, isOwner, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE === 'airtable') {
    const err = new Error('orderRepo.editBouquetLines called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  if (!db) throw new Error('orderRepo.editBouquetLines: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const order = await findOrderById(orderId, tx);
    if (!order) {
      const err = new Error(`Order not found: ${orderId}`);
      err.statusCode = 404;
      throw err;
    }
    const editableStatuses = [ORDER_STATUS.NEW, ORDER_STATUS.READY];
    if (!isOwner && !editableStatuses.includes(order.status)) {
      const err = new Error(`Cannot edit bouquet in "${order.status}" status.`);
      err.statusCode = 400;
      throw err;
    }

    // 1. Handle removed lines
    const writeoffsToLog = [];
    for (const rem of removedLines) {
      if (rem.stockItemId && rem.quantity > 0) {
        if (rem.action === 'return') {
          await stockRepo.adjustQuantity(rem.stockItemId, rem.quantity, { tx, actor });
        } else if (rem.action === 'writeoff') {
          // Stock Loss Log still lives on Airtable (Phase 6). Buffer the writes
          // and run them OUTSIDE the PG transaction so an Airtable hiccup
          // doesn't roll back the order edit. Loss is non-critical reporting;
          // PG order/line/stock updates are the actual business state.
          writeoffsToLog.push({
            stockItemId: rem.stockItemId,
            quantity:    rem.quantity,
            reason:      rem.reason || 'Bouquet edit',
          });
        }
      }
      if (rem.lineId) {
        const isAirtableId = typeof rem.lineId === 'string' && rem.lineId.startsWith('rec');
        const where = isAirtableId
          ? eq(orderLines.airtableId, rem.lineId)
          : eq(orderLines.id, rem.lineId);
        await tx.delete(orderLines).where(where);
      }
    }
    // Defer Stock Loss Log writes until after the tx — they go to Postgres
    // via stockLossRepo. stockItemId here is a PG UUID (this is the PG-mode
    // branch of the repo), so no Airtable ID resolution is needed.
    if (writeoffsToLog.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      Promise.all(writeoffsToLog.map(w =>
        stockLossRepo.create({
          date:     today,
          stockId:  w.stockItemId,
          quantity: w.quantity,
          reason:   w.reason,
          notes:    '',
        }).catch(e => console.error('[STOCK-LOSS] Write-off log error:', e.message)),
      ));
    }

    const explicitStockIds = new Set(
      removedLines.filter(r => !r.lineId && r.stockItemId).map(r => r.stockItemId),
    );

    // 2. Reject orphan new lines
    const orphans = lines.filter(l => !l.id && !l.stockItemId);
    if (orphans.length > 0) {
      const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
      const err = new Error(
        `Order line(s) without a Stock Item are not allowed: ${names}. Create the flower in Stock first.`,
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Process new + updated lines
    const createdLines = [];
    for (const line of lines) {
      if (line.id) {
        if (line._originalQty != null && line.quantity !== line._originalQty) {
          const delta = line._originalQty - line.quantity;
          if (line.stockItemId && !line.stockDeferred && delta !== 0 && !explicitStockIds.has(line.stockItemId)) {
            await stockRepo.adjustQuantity(line.stockItemId, delta, { tx, actor });
          }
          const isAirtableId = typeof line.id === 'string' && line.id.startsWith('rec');
          const where = isAirtableId ? eq(orderLines.airtableId, line.id) : eq(orderLines.id, line.id);
          await tx.update(orderLines).set({ quantity: line.quantity, updatedAt: new Date() }).where(where);
        }
      } else {
        const [created] = await tx.insert(orderLines).values({
          orderId:          order.id,
          stockItemId:      line.stockItemId || null,
          flowerName:       line.flowerName,
          quantity:         Number(line.quantity) || 0,
          costPricePerUnit: line.costPricePerUnit != null ? String(line.costPricePerUnit) : null,
          sellPricePerUnit: line.sellPricePerUnit != null ? String(line.sellPricePerUnit) : null,
          stockDeferred:    line.stockDeferred === true,
        }).returning();
        createdLines.push(created);
        if (line.stockItemId && !line.stockDeferred) {
          await stockRepo.adjustQuantity(line.stockItemId, -line.quantity, { tx, actor });
        }
      }
    }

    // 4. Auto-revert if owner edits while Ready
    if (isOwner && order.status === ORDER_STATUS.READY) {
      const [reverted] = await tx.update(orders)
        .set({ status: ORDER_STATUS.NEW, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();
      await tryAudit(tx, {
        entityType: 'order', entityId: reverted.id, action: 'update',
        before: { Status: order.status }, after: { Status: reverted.status },
        ...actor,
      });
    }

    return { updated: true, createdLines: createdLines.map(pgLineToResponse) };
  });
}

// ── updateOrder — non-status PATCH (status goes through transitionStatus). ──
//
// Cascades Required By → delivery.deliveryDate and Delivery Time →
// delivery.deliveryTime to the linked delivery row, all in a single PG
// transaction. Airtable mode delegates to airtable.update + a follow-up
// delivery update (matching today's route behaviour).

export async function updateOrder(id, fields, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  const cascade = {};
  if ('Required By' in fields)   cascade['Delivery Date'] = fields['Required By'];
  if ('Delivery Time' in fields) cascade['Delivery Time'] = fields['Delivery Time'];
  const hasCascade = Object.keys(cascade).length > 0;

  if (MODE !== 'postgres') {
    const order = await airtable.update(TABLES.ORDERS, id, fields);
    if (hasCascade) {
      const deliveryIds = order['Deliveries'] || [];
      if (deliveryIds.length > 0) {
        await airtable.update(TABLES.DELIVERIES, deliveryIds[0], cascade);
      }
    }
    return order;
  }
  if (!db) throw new Error('orderRepo.updateOrder: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findOrderById(id, tx);
    if (!before) {
      const err = new Error(`Order not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const patch = orderResponseToPg(fields);
    const [after] = await tx.update(orders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(orders.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'order', entityId: after.id, action: 'update',
      before: pgOrderToResponse(before), after: pgOrderToResponse(after), ...actor,
    });

    if (hasCascade) {
      const [delivery] = await tx.select().from(deliveries)
        .where(and(eq(deliveries.orderId, after.id), isNull(deliveries.deletedAt)))
        .limit(1);
      if (delivery) {
        const deliveryPatch = deliveryResponseToPg(cascade);
        const [updatedDelivery] = await tx.update(deliveries)
          .set({ ...deliveryPatch, updatedAt: new Date() })
          .where(eq(deliveries.id, delivery.id))
          .returning();
        await tryAudit(tx, {
          entityType: 'delivery', entityId: updatedDelivery.id, action: 'update',
          before: pgDeliveryToResponse(delivery), after: pgDeliveryToResponse(updatedDelivery),
          ...actor,
        });
      }
    }

    const { linesByOrderId, deliveryByOrderId } = await loadChildren([after], tx);
    return renderOrderRow(after, linesByOrderId, deliveryByOrderId);
  });
}

// ── updateDelivery — driver/owner PATCH on the delivery record. ──
//
// Cascades delivery.status → orders.status when the new status is one of
// OUT_FOR_DELIVERY / DELIVERED / CANCELLED — all in the same tx. Mirrors
// the existing route-level cascade in deliveries.js. The Telegram alert
// for DELIVERED stays at the route layer (out-of-band side effect).

export async function updateDelivery(id, fields, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  const cascadeStatuses = [
    DELIVERY_STATUS.OUT_FOR_DELIVERY,
    DELIVERY_STATUS.DELIVERED,
    DELIVERY_STATUS.CANCELLED,
  ];

  if (MODE !== 'postgres') {
    if (cascadeStatuses.includes(fields.Status)) {
      const before = await airtable.getById(TABLES.DELIVERIES, id);
      const updated = await airtable.update(TABLES.DELIVERIES, id, fields);
      const linkedOrderId = before['Linked Order']?.[0];
      if (linkedOrderId) {
        const orderStatus = fields.Status === DELIVERY_STATUS.CANCELLED
          ? ORDER_STATUS.CANCELLED
          : fields.Status;
        await airtable.update(TABLES.ORDERS, linkedOrderId, { Status: orderStatus });
      }
      return { delivery: updated, linkedOrderId: linkedOrderId || null };
    }
    const updated = await airtable.update(TABLES.DELIVERIES, id, fields);
    return { delivery: updated, linkedOrderId: null };
  }
  if (!db) throw new Error('orderRepo.updateDelivery: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findDeliveryById(id, tx);
    if (!before) {
      const err = new Error(`Delivery not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const patch = deliveryResponseToPg(fields);
    const [after] = await tx.update(deliveries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(deliveries.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'delivery', entityId: after.id, action: 'update',
      before: pgDeliveryToResponse(before), after: pgDeliveryToResponse(after), ...actor,
    });

    let linkedOrderId = null;
    if (cascadeStatuses.includes(fields.Status)) {
      const [order] = await tx.select().from(orders)
        .where(and(eq(orders.id, after.orderId), isNull(orders.deletedAt)))
        .limit(1);
      if (order) {
        const orderStatus = fields.Status === DELIVERY_STATUS.CANCELLED
          ? ORDER_STATUS.CANCELLED
          : fields.Status;
        if (order.status !== orderStatus) {
          const [updatedOrder] = await tx.update(orders)
            .set({ status: orderStatus, updatedAt: new Date() })
            .where(eq(orders.id, order.id))
            .returning();
          await tryAudit(tx, {
            entityType: 'order', entityId: updatedOrder.id, action: 'update',
            before: { Status: order.status }, after: { Status: updatedOrder.status },
            ...actor,
          });
        }
        linkedOrderId = order.airtableId || order.id;
      }
    }

    const resp = pgDeliveryToResponse(after);
    if (after.orderId) {
      const [linked] = await tx.select().from(orders).where(eq(orders.id, after.orderId)).limit(1);
      if (linked) resp['Linked Order'] = [linked.airtableId || linked.id];
    }
    return { delivery: resp, linkedOrderId };
  });
}

// ── updateOrderLine — single-line update (used by swap-bouquet-line). ──

export async function updateOrderLine(lineId, fields, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE !== 'postgres') {
    return await airtable.update(TABLES.ORDER_LINES, lineId, fields);
  }
  if (!db) throw new Error('orderRepo.updateOrderLine: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const before = await findOrderLineById(lineId, tx);
    if (!before) {
      const err = new Error(`Order line not found: ${lineId}`);
      err.statusCode = 404;
      throw err;
    }
    const patch = lineResponseToPg(fields);
    const [after] = await tx.update(orderLines)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(orderLines.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'orderLine', entityId: after.id, action: 'update',
      before: pgLineToResponse(before), after: pgLineToResponse(after), ...actor,
    });
    return pgLineToResponse(after);
  });
}

// ── convertToDelivery — Pickup → Delivery one-shot. ──
//
// Single tx: insert delivery row + flip order's Delivery Type and
// Delivery Fee. Refuses if the order already has a delivery (uniqueIndex
// on deliveries.order_id enforces this at DB level too, but we surface a
// clean 400 instead of a constraint violation).

export async function convertToDelivery(orderId, deliveryFields, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (MODE !== 'postgres') {
    const order = await airtable.getById(TABLES.ORDERS, orderId);
    if (order['Deliveries']?.length > 0) {
      const err = new Error('Delivery record already exists for this order.');
      err.statusCode = 400;
      throw err;
    }
    const delivery = await airtable.create(TABLES.DELIVERIES, {
      'Linked Order': [orderId],
      ...deliveryFields,
    });
    await airtable.update(TABLES.ORDERS, orderId, {
      'Delivery Type': 'Delivery',
      'Delivery Fee':  deliveryFields['Delivery Fee'] ?? 0,
    });
    return delivery;
  }
  if (!db) throw new Error('orderRepo.convertToDelivery: postgres backend not configured');

  return await db.transaction(async (tx) => {
    const order = await findOrderById(orderId, tx);
    if (!order) {
      const err = new Error(`Order not found: ${orderId}`);
      err.statusCode = 404;
      throw err;
    }
    const [existing] = await tx.select().from(deliveries)
      .where(and(eq(deliveries.orderId, order.id), isNull(deliveries.deletedAt)))
      .limit(1);
    if (existing) {
      const err = new Error('Delivery record already exists for this order.');
      err.statusCode = 400;
      throw err;
    }

    const insertVals = deliveryResponseToPg(deliveryFields);
    insertVals.orderId = order.id;
    if (!('status' in insertVals)) insertVals.status = DELIVERY_STATUS.PENDING;
    const [delivery] = await tx.insert(deliveries).values(insertVals).returning();
    await tryAudit(tx, {
      entityType: 'delivery', entityId: delivery.id, action: 'create',
      before: null, after: pgDeliveryToResponse(delivery), ...actor,
    });

    const orderPatch = {
      deliveryType: 'Delivery',
      deliveryFee: deliveryFields['Delivery Fee'] != null
        ? String(deliveryFields['Delivery Fee']) : '0',
    };
    const [updatedOrder] = await tx.update(orders)
      .set({ ...orderPatch, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'order', entityId: updatedOrder.id, action: 'update',
      before: { 'Delivery Type': order.deliveryType, 'Delivery Fee': order.deliveryFee },
      after:  { 'Delivery Type': updatedOrder.deliveryType, 'Delivery Fee': updatedOrder.deliveryFee },
      ...actor,
    });

    const resp = pgDeliveryToResponse(delivery);
    resp['Linked Order'] = [updatedOrder.airtableId || updatedOrder.id];
    return resp;
  });
}

// ── runParityCheck ──
//
// Defer the full implementation — the prerequisite is ORDER_BACKEND=shadow
// being active so the parity_log has data. The shape mirrors stockRepo's so
// the AdminTab can drive both via the same endpoint pattern. Implementation
// lands in the follow-up commit that wires the order parity dashboard.
export async function runParityCheck() {
  if (!db) return { ran: false, reason: 'DATABASE_URL not configured' };
  return {
    ran: true,
    airtableCount: 0,
    postgresCount: 0,
    mismatches: {},
    note: 'Order parity check — full implementation lands once ORDER_BACKEND=shadow has data. See docs/migration/phase-4-orders-design.md.',
  };
}

// ── Internal exports for tests ──
export const _internal = {
  ORDER_WRITE_ALLOWED,
  LINE_WRITE_ALLOWED,
  DELIVERY_WRITE_ALLOWED,
  pgOrderToResponse,
  pgLineToResponse,
  pgDeliveryToResponse,
  orderResponseToPg,
  lineResponseToPg,
  deliveryResponseToPg,
  ALLOWED_TRANSITIONS,
};
