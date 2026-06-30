// backend/src/services/assistantTools/dataQueryPack.js
//
// "Connect the dots" structured-query tool.
//
// SAFETY MODEL: the model NEVER writes SQL. It composes a DECLARATIVE spec from
// a fixed vocabulary (allow-listed entities / fields / ops / joins). The backend
// validates the spec against SCHEMA and runs a parameterized, READ-ONLY Drizzle
// query with a row cap + statement timeout. An unknown entity, field, or operator
// is rejected so the model cannot reach data it shouldn't, and a malformed spec
// fails loudly instead of returning a wrong-but-plausible number.
//
// See RFC: docs/superpowers/plans/2026-06-30-assistant-extensions-rfc.md

import { db } from '../../db/index.js';
import { orders, orderLines, customers, stock, deliveries } from '../../db/schema.js';
import {
  and, eq, ne, lt, lte, gt, gte, inArray, ilike, isNull, isNotNull,
  sql, count, sum, avg, min, max, desc, asc,
} from 'drizzle-orm';
import { ORDER_STATUS } from '../../constants/statuses.js';

const ROW_CAP = 200;          // hard ceiling on returned rows

// ── Allow-list: the ONLY entities/fields/joins/ops the tool will ever touch ──
// Each field entry maps a model-facing name → the real Drizzle column reference.
// Anything not listed is invisible to the model.
//
// Join entries may carry a `uuidSide` hint for cross-type pairs:
//   uuidSide: 'foreign' → foreignCol is uuid; emit foreignCol::text = localCol
//   uuidSide: 'local'   → localCol is uuid;   emit localCol::text  = foreignCol
// Omitting uuidSide means both sides share a type — plain eq() is used.
// The uuid→text cast is always safe: text equality on uuid strings never throws,
// while text::uuid throws for any non-UUID value (e.g. legacy 'recXXX' ids).
const SCHEMA = {
  orders: {
    table: orders,
    defaultExcludeCancelled: true,
    fields: {
      id:            { col: orders.id },
      orderDate:     { col: orders.orderDate },
      requiredBy:    { col: orders.requiredBy },
      status:        { col: orders.status },
      deliveryType:  { col: orders.deliveryType },
      source:        { col: orders.source },
      paymentStatus: { col: orders.paymentStatus },
      paymentMethod: { col: orders.paymentMethod },
      price:         { col: orders.priceOverride },
      customerId:    { col: orders.customerId },
    },
    joins: {
      // orders.customerId = TEXT, customers.id = UUID → cast foreignCol (uuid) to text
      customer: { to: 'customers',   localCol: orders.customerId,     foreignCol: customers.id,       cardinality: 'one',  uuidSide: 'foreign' },
      // orders.id = UUID,  orderLines.orderId = UUID → same types, plain eq
      lines:    { to: 'order_lines', localCol: orders.id,             foreignCol: orderLines.orderId, cardinality: 'many' },
      // orders.id = UUID,  deliveries.orderId = UUID → same types, plain eq
      delivery: { to: 'deliveries',  localCol: orders.id,             foreignCol: deliveries.orderId, cardinality: 'one' },
    },
    softDeleteCol: orders.deletedAt,
  },
  customers: {
    table: customers,
    fields: {
      id:      { col: customers.id },
      name:    { col: customers.name },
      phone:   { col: customers.phone },
      segment: { col: customers.segment },
    },
    joins: {
      // customers.id = UUID, orders.customerId = TEXT → cast localCol (uuid) to text
      orders: { to: 'orders', localCol: customers.id, foreignCol: orders.customerId, cardinality: 'many', uuidSide: 'local' },
    },
    softDeleteCol: customers.deletedAt,
  },
  order_lines: {
    table: orderLines,
    fields: {
      id:          { col: orderLines.id },
      orderId:     { col: orderLines.orderId },
      stockItemId: { col: orderLines.stockItemId },
      quantity:    { col: orderLines.quantity },
      sellPrice:   { col: orderLines.sellPricePerUnit },
      flowerName:  { col: orderLines.flowerName },
    },
    joins: {
      // orderLines.stockItemId = TEXT (may hold 'recXXX'), stock.id = UUID → cast foreignCol (uuid) to text
      stock: { to: 'stock', localCol: orderLines.stockItemId, foreignCol: stock.id, cardinality: 'one', uuidSide: 'foreign' },
    },
    softDeleteCol: orderLines.deletedAt,
  },
  stock: {
    table: stock,
    fields: {
      id:       { col: stock.id },
      name:     { col: stock.displayName },
      quantity: { col: stock.currentQuantity },
      type:     { col: stock.typeName },
      colour:   { col: stock.colour },
    },
    softDeleteCol: stock.deletedAt,
  },
};

const OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like', 'isNull', 'isNotNull']);
const AGG_FNS   = new Set(['count', 'sum', 'avg', 'min', 'max']);

// ── Map an operator string to a Drizzle condition ──
function applyOp(col, op, value) {
  switch (op) {
    case 'eq':       return eq(col, value);
    case 'ne':       return ne(col, value);
    case 'lt':       return lt(col, value);
    case 'lte':      return lte(col, value);
    case 'gt':       return gt(col, value);
    case 'gte':      return gte(col, value);
    case 'in':       return inArray(col, Array.isArray(value) ? value : [value]);
    case 'like':     return ilike(col, `%${value}%`);
    case 'isNull':   return isNull(col);
    case 'isNotNull':return isNotNull(col);
    default:         throw new Error(`Unknown operator: ${op}`);
  }
}

// ── Map an aggregate function name to a Drizzle expression ──
function applyAgg(fn, col, alias) {
  switch (fn) {
    case 'count': return col ? count(col).as(alias) : count().as(alias);
    case 'sum':   return sum(col).as(alias);
    case 'avg':   return avg(col).as(alias);
    case 'min':   return min(col).as(alias);
    case 'max':   return max(col).as(alias);
    default:      throw new Error(`Unknown aggregate function: ${fn}`);
  }
}

/**
 * Resolve a field name to its Drizzle column, searching:
 *   1. The primary entity's fields.
 *   2. The fields of any allowed joins that are active in `activeJoins`.
 */
function resolveField(entityDef, fieldName, activeJoins = []) {
  if (entityDef.fields[fieldName]) return entityDef.fields[fieldName].col;
  for (const joinName of activeJoins) {
    const joinDef = entityDef.joins?.[joinName];
    if (!joinDef) continue;
    const joinEntity = SCHEMA[joinDef.to];
    if (!joinEntity) continue;
    if (joinEntity.fields[fieldName]) return joinEntity.fields[fieldName].col;
  }
  return null;
}

/**
 * Validate a query spec against SCHEMA.
 * Returns { ok:true } or { ok:false, error: string }.
 * Guards against malformed elements (null filters, etc.) — never throws.
 */
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' };

  const entityDef = SCHEMA[spec.entity];
  if (!entityDef) {
    return { ok: false, error: `Unknown entity "${spec.entity}". Allowed: ${Object.keys(SCHEMA).join(', ')}` };
  }

  const activeJoins = Array.isArray(spec.join) ? spec.join : [];

  // Validate joins
  for (const joinName of activeJoins) {
    if (!entityDef.joins?.[joinName]) {
      const allowed = Object.keys(entityDef.joins || {}).join(', ') || '(none)';
      return { ok: false, error: `Unknown join "${joinName}" on entity "${spec.entity}". Allowed: ${allowed}` };
    }
  }

  // Validate filters
  if (spec.filters) {
    if (!Array.isArray(spec.filters)) return { ok: false, error: 'filters must be an array' };
    for (const f of spec.filters) {
      if (!f || typeof f !== 'object') return { ok: false, error: 'Each filter must be an object' };
      if (!OPERATORS.has(f.op)) {
        return { ok: false, error: `Unknown operator "${f.op}". Allowed: ${[...OPERATORS].join(', ')}` };
      }
      const col = resolveField(entityDef, f.field, activeJoins);
      if (!col) {
        return { ok: false, error: `Unknown field "${f.field}" on entity "${spec.entity}" (with joins: ${activeJoins.join(', ') || 'none'})` };
      }
    }
  }

  // Validate groupBy
  if (spec.groupBy) {
    if (!Array.isArray(spec.groupBy)) return { ok: false, error: 'groupBy must be an array' };
    for (const fieldName of spec.groupBy) {
      if (typeof fieldName !== 'string') return { ok: false, error: 'groupBy fields must be strings' };
      const col = resolveField(entityDef, fieldName, activeJoins);
      if (!col) {
        return { ok: false, error: `Unknown groupBy field "${fieldName}" on entity "${spec.entity}"` };
      }
    }
  }

  // Validate aggregates
  if (spec.aggregate) {
    if (!Array.isArray(spec.aggregate)) return { ok: false, error: 'aggregate must be an array' };
    for (const agg of spec.aggregate) {
      if (!agg || typeof agg !== 'object') return { ok: false, error: 'Each aggregate must be an object' };
      if (!AGG_FNS.has(agg.fn)) {
        return { ok: false, error: `Unknown aggregate function "${agg.fn}". Allowed: ${[...AGG_FNS].join(', ')}` };
      }
      if (!agg.as || typeof agg.as !== 'string') {
        return { ok: false, error: 'Each aggregate must have an "as" alias' };
      }
      if (agg.field) {
        const col = resolveField(entityDef, agg.field, activeJoins);
        if (!col) {
          return { ok: false, error: `Unknown aggregate field "${agg.field}" on entity "${spec.entity}"` };
        }
      }
    }
  }

  // Validate sort
  if (spec.sort) {
    if (!Array.isArray(spec.sort)) return { ok: false, error: 'sort must be an array' };
    for (const s of spec.sort) {
      if (!s || typeof s !== 'object') return { ok: false, error: 'Each sort must be an object' };
      const col = resolveField(entityDef, s.field, activeJoins);
      if (!col) {
        return { ok: false, error: `Unknown sort field "${s.field}" on entity "${spec.entity}"` };
      }
      if (s.dir && s.dir !== 'asc' && s.dir !== 'desc') {
        return { ok: false, error: `sort.dir must be "asc" or "desc", got "${s.dir}"` };
      }
    }
  }

  return { ok: true };
}

/**
 * query_records — run a validated, read-only, parameterized query and return rows + counts.
 *
 * @param {{
 *   entity: string,
 *   filters?: Array<{field:string, op:string, value?:any}>,
 *   join?: string[],
 *   groupBy?: string[],
 *   aggregate?: Array<{fn:string, field?:string, as:string}>,
 *   sort?: Array<{field:string, dir?:'asc'|'desc'}>,
 *   limit?: number,
 *   includeCancelled?: boolean,
 * }} spec
 * @returns {Promise<{spec:object, matchedCount:number, truncated:boolean, rows:object[]}|{error:string}>}
 */
export async function queryRecordsHandler(spec) {
  // 1. Validate
  const v = validateSpec(spec);
  if (!v.ok) return { error: v.error };

  try {
    const entityDef = SCHEMA[spec.entity];
    const activeJoins = Array.isArray(spec.join) ? spec.join : [];
    // Clamp limit: 0 or negative falls back to ROW_CAP
    const userLimit = Math.min(Math.max(1, Number(spec.limit) || ROW_CAP), ROW_CAP);

    // 2. Build WHERE conditions
    const whereClauses = [];

    // Soft-delete exclusion
    if (entityDef.softDeleteCol) {
      whereClauses.push(isNull(entityDef.softDeleteCol));
    }

    // Default Cancelled exclusion for orders (primary entity)
    if (spec.entity === 'orders' && !spec.includeCancelled) {
      whereClauses.push(ne(orders.status, ORDER_STATUS.CANCELLED));
    }

    // User-supplied filters
    for (const f of (spec.filters || [])) {
      const col = resolveField(entityDef, f.field, activeJoins);
      whereClauses.push(applyOp(col, f.op, f.value));
    }

    const whereExpr = whereClauses.length > 0 ? and(...whereClauses) : undefined;

    // 3. Build select columns for aggregates or plain select
    const hasAgg = spec.aggregate && spec.aggregate.length > 0;
    const hasGroupBy = spec.groupBy && spec.groupBy.length > 0;

    // Helper to apply joins to any drizzle query builder.
    //
    // Cross-type joins (TEXT ↔ UUID): cast the uuid column to text so that
    // legacy 'recXXX' text values in TEXT columns never trigger a Postgres
    // cast error. The uuidSide flag on the join definition controls direction:
    //   uuidSide:'foreign' → sql`foreignCol::text = localCol`
    //   uuidSide:'local'   → sql`localCol::text  = foreignCol`
    //   (absent)           → eq(localCol, foreignCol)  — uuid=uuid, type-safe
    //
    // Soft-delete and Cancelled-exclude are pushed into each join's ON clause
    // so joined rows are filtered even when the primary entity is different.
    function applyJoins(q) {
      for (const joinName of activeJoins) {
        const joinDef = entityDef.joins[joinName];
        const joinEntity = SCHEMA[joinDef.to];

        // Type-safe join condition
        let condition;
        if (joinDef.uuidSide === 'foreign') {
          condition = sql`${joinDef.foreignCol}::text = ${joinDef.localCol}`;
        } else if (joinDef.uuidSide === 'local') {
          condition = sql`${joinDef.localCol}::text = ${joinDef.foreignCol}`;
        } else {
          condition = eq(joinDef.localCol, joinDef.foreignCol);
        }

        // Soft-delete filter for the joined table
        const extraConditions = [];
        if (joinEntity.softDeleteCol) {
          extraConditions.push(isNull(joinEntity.softDeleteCol));
        }
        // Exclude Cancelled orders from joins whenever orders participates as a join target
        if (joinDef.to === 'orders' && !spec.includeCancelled) {
          extraConditions.push(ne(orders.status, ORDER_STATUS.CANCELLED));
        }

        const fullCondition = extraConditions.length > 0
          ? and(condition, ...extraConditions)
          : condition;

        q = q.innerJoin(joinEntity.table, fullCondition);
      }
      return q;
    }

    // Count query over full match (no limit)
    let countBase = db.select({ total: count() }).from(entityDef.table);
    countBase = applyJoins(countBase);
    if (whereExpr) countBase = countBase.where(whereExpr);

    // Data query
    let dataQuery;
    if (hasAgg || hasGroupBy) {
      // Build select columns: groupBy fields + aggregates
      const selectCols = {};
      for (const fieldName of (spec.groupBy || [])) {
        selectCols[fieldName] = resolveField(entityDef, fieldName, activeJoins);
      }
      for (const agg of (spec.aggregate || [])) {
        const col = agg.field ? resolveField(entityDef, agg.field, activeJoins) : null;
        selectCols[agg.as] = applyAgg(agg.fn, col, agg.as);
      }
      dataQuery = db.select(selectCols).from(entityDef.table);
      dataQuery = applyJoins(dataQuery);
      if (whereExpr) dataQuery = dataQuery.where(whereExpr);
      if (hasGroupBy) {
        const groupCols = spec.groupBy.map(f => resolveField(entityDef, f, activeJoins));
        dataQuery = dataQuery.groupBy(...groupCols);
      }
    } else {
      dataQuery = db.select().from(entityDef.table);
      dataQuery = applyJoins(dataQuery);
      if (whereExpr) dataQuery = dataQuery.where(whereExpr);
    }

    // OrderBy and limit apply to both paths
    for (const s of (spec.sort || [])) {
      const col = resolveField(entityDef, s.field, activeJoins);
      dataQuery = dataQuery.orderBy(s.dir === 'desc' ? desc(col) : asc(col));
    }
    dataQuery = dataQuery.limit(userLimit);

    const [countResult, rows] = await Promise.all([countBase, dataQuery]);

    // For aggregate/groupBy queries, matchedCount is the ungrouped row count — not meaningful
    // as a truncation signal because grouped rows are always fewer than ungrouped rows, which
    // would make truncated:true even when all groups are present. Return truncated:false.
    if (hasAgg || hasGroupBy) {
      return { spec, rows, truncated: false };
    }

    const matchedCount = Number(countResult[0]?.total ?? 0);
    return { spec, matchedCount, truncated: matchedCount > rows.length, rows };
  } catch (err) {
    console.error('[dataQueryPack] queryRecordsHandler error:', err.message);
    return { error: err.message };
  }
}

/**
 * orders_needing_short_stock — open orders whose bouquet uses a flower
 * currently in shortfall (stock.currentQuantity < 0).
 *
 * Returns a capped list: { orders: [{id, appOrderId, requiredBy, status, shortFlowers}] }.
 */
export async function ordersNeedingShortStockHandler() {
  try {
    // Open = non-terminal, non-cancelled, non-deleted
    const openStatuses = [
      ORDER_STATUS.NEW,
      ORDER_STATUS.IN_PROGRESS,
      ORDER_STATUS.IN_PREPARATION,
      ORDER_STATUS.READY,
      ORDER_STATUS.OUT_FOR_DELIVERY,
    ];

    // Fetch open orders + their lines in one pass, then join to short stock items.
    // IMPORTANT: orderLines.stockItemId is TEXT (may hold legacy 'recXXX' values).
    // Cast stock.id (uuid) to text so that non-UUID stockItemIds never throw a cast
    // error — they simply produce no match, which is the correct behaviour.
    const rows = await db
      .select({
        orderId:     orders.id,
        appOrderId:  orders.appOrderId,
        requiredBy:  orders.requiredBy,
        status:      orders.status,
        flowerName:  orderLines.flowerName,
        stockQty:    stock.currentQuantity,
        stockName:   stock.displayName,
      })
      .from(orders)
      .innerJoin(
        orderLines,
        and(eq(orderLines.orderId, orders.id), isNull(orderLines.deletedAt)),
      )
      .innerJoin(
        stock,
        and(
          sql`${stock.id}::text = ${orderLines.stockItemId}`,
          lt(stock.currentQuantity, 0),
          isNull(stock.deletedAt),
        ),
      )
      .where(
        and(
          isNull(orders.deletedAt),
          inArray(orders.status, openStatuses),
        ),
      )
      .limit(ROW_CAP);

    // Group by order — one order may use multiple short flowers
    const byOrder = new Map();
    for (const row of rows) {
      if (!byOrder.has(row.orderId)) {
        byOrder.set(row.orderId, {
          id:          row.orderId,
          appOrderId:  row.appOrderId,
          requiredBy:  row.requiredBy,
          status:      row.status,
          shortFlowers: [],
        });
      }
      const entry = byOrder.get(row.orderId);
      const name = row.stockName || row.flowerName;
      if (!entry.shortFlowers.includes(name)) entry.shortFlowers.push(name);
    }

    const result = [...byOrder.values()];
    return {
      count: result.length,
      truncated: rows.length === ROW_CAP && result.length === ROW_CAP,
      orders: result,
    };
  } catch (err) {
    console.error('[dataQueryPack] ordersNeedingShortStockHandler error:', err.message);
    return { error: err.message };
  }
}
