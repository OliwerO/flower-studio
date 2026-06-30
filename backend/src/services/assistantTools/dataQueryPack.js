// backend/src/services/assistantTools/dataQueryPack.js
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SKELETON — NOT REGISTERED in index.js yet. Inert until wired + tested.    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// The "connect-the-dots" tool. Goal: let the owner ask cross-entity questions the
// static dashboard can't filter for ("orders due this week, still unpaid, for VIP
// customers, that need a flower I'm short on") — a flexible, smart interface to the
// database she builds with every order.
//
// SAFETY MODEL (the whole point): the model NEVER writes SQL. It composes a
// DECLARATIVE spec from a fixed vocabulary (allow-listed entities / fields / ops /
// joins). The backend validates the spec against SCHEMA and runs a parameterized,
// READ-ONLY Drizzle query with a row cap + statement timeout. An unknown entity,
// field, or operator is rejected — so the model cannot reach data it shouldn't, and
// a malformed spec fails loudly instead of returning a wrong-but-plausible number.
//
// This is the structured-query alternative to (a) hand-writing a composite tool per
// question — too rigid — and (b) a raw read-only SQL tool — too risky (a bad query
// silently returns wrong numbers, the exact thing the assistant's design avoids).
//
// See RFC: docs/superpowers/plans/2026-06-30-assistant-extensions-rfc.md

// import { db } from '../../db/index.js';
// import * as schema from '../../db/schema.js';
// import { and, or, eq, ne, lt, lte, gt, gte, inArray, ilike, isNull, isNotNull, sql, count, sum, avg, min, max, desc, asc } from 'drizzle-orm';
// import { ORDER_STATUS } from '../../constants/statuses.js';

const ROW_CAP = 200;          // hard ceiling on returned rows (aggregates run over the FULL match)
const STATEMENT_TIMEOUT_MS = 5000;

// ── Allow-list: the ONLY entities/fields/joins/ops the tool will ever touch ──
// Each field maps a model-facing name → the real column. Anything not listed here
// is invisible to the model. Keep this curated to what the owner should query.
// TODO: fill `table` with the real Drizzle table object + `col` with the column ref.
const SCHEMA = {
  orders: {
    // table: schema.orders,
    defaultFilters: [{ field: 'status', op: 'ne', value: 'Cancelled' }], // unless overridden
    fields: {
      id: 'id', orderDate: 'orderDate', requiredBy: 'requiredBy', status: 'status',
      deliveryType: 'deliveryType', source: 'source', paymentStatus: 'paymentStatus',
      paymentMethod: 'paymentMethod', price: 'priceOverride', customerId: 'customerId',
    },
    joins: {
      customer: { to: 'customers', on: ['customerId', 'id'] },
      lines:    { to: 'order_lines', on: ['id', 'orderId'], cardinality: 'many' },
      delivery: { to: 'deliveries', on: ['id', 'orderId'], cardinality: 'one' },
    },
  },
  customers: {
    // table: schema.customers,
    fields: { id: 'id', name: 'name', phone: 'phone', segment: 'segment' },
    joins: { orders: { to: 'orders', on: ['id', 'customerId'], cardinality: 'many' } },
  },
  order_lines: {
    // table: schema.orderLines,
    fields: { id: 'id', orderId: 'orderId', stockItemId: 'stockItemId', quantity: 'quantity', sellPrice: 'sellPricePerUnit' },
    joins: { stock: { to: 'stock', on: ['stockItemId', 'id'] } },
  },
  stock: {
    // table: schema.stock,
    fields: { id: 'id', name: 'displayName', quantity: 'currentQuantity', type: 'typeName', colour: 'colour' },
  },
};

const OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like', 'isNull', 'isNotNull', 'between']);
const AGG_FNS = new Set(['count', 'sum', 'avg', 'min', 'max']);

/**
 * Validate a query spec against SCHEMA. Returns { ok:true } or { ok:false, error }.
 * Rejects unknown entity/field/op/join so the model can never reach un-allow-listed data.
 *
 * TODO: implement — check spec.entity ∈ SCHEMA; every filter.field + sort.field +
 *       groupBy + aggregate.field ∈ SCHEMA[entity].fields (or a joined entity's fields);
 *       every filter.op ∈ OPERATORS; every aggregate.fn ∈ AGG_FNS; joins ∈ SCHEMA[entity].joins.
 */
function validateSpec(/* spec */) {
  throw new Error('dataQueryPack.validateSpec not implemented (skeleton)');
}

/**
 * query_records — run a validated, read-only, parameterized query and return rows + counts.
 *
 * @param {{
 *   entity: string,                                   // e.g. 'orders'
 *   filters?: Array<{field:string,op:string,value?:any}>,
 *   join?: string[],                                  // allow-listed join names on `entity`
 *   groupBy?: string[],
 *   aggregate?: Array<{fn:string,field?:string,as:string}>,
 *   sort?: Array<{field:string,dir:'asc'|'desc'}>,
 *   limit?: number,
 *   includeCancelled?: boolean,                       // opt out of the default Cancelled-exclude
 * }} spec
 * @returns {Promise<{spec:object, matchedCount:number, truncated:boolean, rows:object[]}>}
 */
export async function queryRecordsHandler(/* spec */) {
  // 1. const v = validateSpec(spec); if (!v.ok) return { error: v.error };
  // 2. Build a parameterized Drizzle query from the validated spec:
  //    - base = db.select(...).from(SCHEMA[entity].table)
  //    - apply allow-listed joins (innerJoin on the predefined `on` columns)
  //    - where(and(...defaultFilters unless includeCancelled, ...spec.filters mapped to drizzle ops))
  //    - groupBy / aggregate (count/sum/avg/min/max) / orderBy / limit(min(limit, ROW_CAP))
  //    - run inside a transaction with SET LOCAL statement_timeout = STATEMENT_TIMEOUT_MS
  // 3. matchedCount via a parallel count() query (aggregates are over the FULL match, not the capped rows)
  // 4. return { spec, matchedCount, truncated: matchedCount > rows.length, rows }
  throw new Error('dataQueryPack.queryRecordsHandler not implemented (skeleton)');
}

// ── Composite quick-win (optional): a hand-written join for the single highest-value
// question, shippable before the general tool is finished. ───────────────────────────
/**
 * orders_needing_short_stock — open orders whose bouquet uses a flower currently in
 * shortfall (stock.currentQuantity < 0). The canonical "connect the dots" example.
 * TODO: orderRepo.list({open}) ∩ stockRepo.list({shortfall}) joined via order_lines.stockItemId.
 */
export async function ordersNeedingShortStockHandler(/* input */) {
  throw new Error('dataQueryPack.ordersNeedingShortStockHandler not implemented (skeleton)');
}

// When ready to ship, register in index.js, e.g.:
//   {
//     name: 'query_records',
//     description: 'Flexible cross-entity lookup the fixed tools cannot express: filter/join/group/aggregate ' +
//       'orders, customers, order lines and stock by any allow-listed field. Use ONLY when no dedicated tool ' +
//       'fits (prefer financial_summary, query_orders, etc. for their cases). You compose a structured spec; ' +
//       'you never write SQL. Cancelled orders are excluded unless includeCancelled=true.',
//     input_schema: { /* entity, filters[], join[], groupBy[], aggregate[], sort[], limit, includeCancelled */ },
//     handler: queryRecordsHandler,
//   }
