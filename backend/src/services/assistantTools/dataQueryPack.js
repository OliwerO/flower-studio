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
import {
  orders, orderLines, customers, stock, deliveries, stockPurchases, stockLossLog, marketingSpend,
  keyPeople, stockOrders, stockOrderLines, floristHours,
} from '../../db/schema.js';
import {
  and, eq, ne, lt, lte, gt, gte, inArray, ilike, isNull, isNotNull,
  sql, count, sum, avg, min, max, desc, asc,
} from 'drizzle-orm';
import { ORDER_STATUS } from '../../constants/statuses.js';

const ROW_CAP = 200;          // hard ceiling on returned rows
const MAX_CHAIN = 4;          // max hops in a deep-join chain (ADR-0011)

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
export const SCHEMA = {
  orders: {
    table: orders,
    defaultExcludeCancelled: true,
    fields: {
      id:            { col: orders.id },
      appOrderId:    { col: orders.appOrderId },  // human order number (e.g. 202606-001)
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
      // customers.id = UUID, keyPeople.customerId = UUID → same types, plain eq
      keyPeople: { to: 'key_people', localCol: customers.id, foreignCol: keyPeople.customerId, cardinality: 'many' },
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
      // Reverse edge (Explorer v2 deep-join): a line belongs to one order. uuid = uuid.
      order: { to: 'orders', localCol: orderLines.orderId, foreignCol: orders.id, cardinality: 'one' },
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
    joins: {
      // Reverse edge (Explorer v2 deep-join): a flower appears on many order lines.
      // stock.id = UUID, orderLines.stockItemId = TEXT (may hold 'recXXX') → cast localCol (uuid) to text.
      lines: { to: 'order_lines', localCol: stock.id, foreignCol: orderLines.stockItemId, cardinality: 'many', uuidSide: 'local' },
    },
    softDeleteCol: stock.deletedAt,
  },
  purchases: {
    table: stockPurchases,
    // No softDeleteCol — stockPurchases has no deletedAt column.
    fields: {
      id:                { col: stockPurchases.id },
      purchaseDate:      { col: stockPurchases.purchaseDate },
      supplier:          { col: stockPurchases.supplier },
      stockId:           { col: stockPurchases.stockId },
      stockAirtableId:   { col: stockPurchases.stockAirtableId },
      quantityPurchased: { col: stockPurchases.quantityPurchased },
      quantityAccepted:  { col: stockPurchases.quantityAccepted },
      pricePerUnit:      { col: stockPurchases.pricePerUnit },
      notes:             { col: stockPurchases.notes },
    },
    joins: {
      // stockPurchases.stockId = UUID, stock.id = UUID → same types, plain eq
      stock: { to: 'stock', localCol: stockPurchases.stockId, foreignCol: stock.id, cardinality: 'one' },
    },
  },
  writeoffs: {
    table: stockLossLog,
    fields: {
      id:       { col: stockLossLog.id },
      date:     { col: stockLossLog.date },
      stockId:  { col: stockLossLog.stockId },
      quantity: { col: stockLossLog.quantity },
      reason:   { col: stockLossLog.reason },
      notes:    { col: stockLossLog.notes },
    },
    joins: {
      // stockLossLog.stockId = UUID, stock.id = UUID → same types, plain eq
      stock: { to: 'stock', localCol: stockLossLog.stockId, foreignCol: stock.id, cardinality: 'one' },
    },
    softDeleteCol: stockLossLog.deletedAt,
  },
  deliveries: {
    table: deliveries,
    fields: {
      id:                 { col: deliveries.id },
      orderId:            { col: deliveries.orderId },
      deliveryAddress:    { col: deliveries.deliveryAddress },
      recipientName:      { col: deliveries.recipientName },
      recipientPhone:     { col: deliveries.recipientPhone },
      deliveryDate:       { col: deliveries.deliveryDate },
      deliveryTime:       { col: deliveries.deliveryTime },
      courierTime:        { col: deliveries.courierTime },
      assignedDriver:     { col: deliveries.assignedDriver },
      deliveryFee:        { col: deliveries.deliveryFee },
      driverInstructions: { col: deliveries.driverInstructions },
      deliveryMethod:     { col: deliveries.deliveryMethod },
      driverPayout:       { col: deliveries.driverPayout },
      status:             { col: deliveries.status },
      deliveredAt:        { col: deliveries.deliveredAt },
    },
    joins: {
      // deliveries.orderId = UUID, orders.id = UUID → same types, plain eq
      order: { to: 'orders', localCol: deliveries.orderId, foreignCol: orders.id, cardinality: 'one' },
    },
    softDeleteCol: deliveries.deletedAt,
  },
  marketing: {
    table: marketingSpend,
    fields: {
      id:      { col: marketingSpend.id },
      month:   { col: marketingSpend.month },
      channel: { col: marketingSpend.channel },
      amount:  { col: marketingSpend.amount },
      notes:   { col: marketingSpend.notes },
    },
    softDeleteCol: marketingSpend.deletedAt,
  },
  key_people: {
    table: keyPeople,
    fields: {
      id:                { col: keyPeople.id },
      customerId:        { col: keyPeople.customerId },
      name:              { col: keyPeople.name },
      phone:             { col: keyPeople.phone },
      address:           { col: keyPeople.address },
      importantDate:     { col: keyPeople.importantDate },
      importantDateLabel:{ col: keyPeople.importantDateLabel },
    },
    joins: {
      // keyPeople.customerId = UUID, customers.id = UUID → same types, plain eq
      customer: { to: 'customers', localCol: keyPeople.customerId, foreignCol: customers.id, cardinality: 'one' },
    },
    softDeleteCol: keyPeople.deletedAt,
  },
  stock_orders: {
    table: stockOrders,
    // No softDeleteCol — stockOrders has no deletedAt column.
    fields: {
      id:             { col: stockOrders.id },
      poNumber:       { col: stockOrders.poNumber },
      status:         { col: stockOrders.status },
      createdDate:    { col: stockOrders.createdDate },
      assignedDriver: { col: stockOrders.assignedDriver },
      plannedDate:    { col: stockOrders.plannedDate },
    },
    joins: {
      // stockOrders.id = UUID, stockOrderLines.poId = UUID → same types, plain eq
      lines: { to: 'stock_order_lines', localCol: stockOrders.id, foreignCol: stockOrderLines.poId, cardinality: 'many' },
    },
  },
  stock_order_lines: {
    table: stockOrderLines,
    // No softDeleteCol — stockOrderLines has no deletedAt column.
    fields: {
      id:              { col: stockOrderLines.id },
      poId:            { col: stockOrderLines.poId },
      stockId:         { col: stockOrderLines.stockId },
      flowerName:      { col: stockOrderLines.flowerName },
      quantityNeeded:  { col: stockOrderLines.quantityNeeded },
      quantityFound:   { col: stockOrderLines.quantityFound },
      supplier:        { col: stockOrderLines.supplier },
      costPrice:       { col: stockOrderLines.costPrice },
      sellPrice:       { col: stockOrderLines.sellPrice },
    },
    joins: {
      // stockOrderLines.stockId = UUID, stock.id = UUID → same types, plain eq
      stock: { to: 'stock', localCol: stockOrderLines.stockId, foreignCol: stock.id, cardinality: 'one' },
      // stockOrderLines.poId = UUID, stockOrders.id = UUID → same types, plain eq
      po:    { to: 'stock_orders', localCol: stockOrderLines.poId, foreignCol: stockOrders.id, cardinality: 'one' },
    },
  },
  florist_hours: {
    table: floristHours,
    // Near-standalone entity — no joins.
    fields: {
      id:            { col: floristHours.id },
      name:          { col: floristHours.name },
      date:          { col: floristHours.date },
      hours:         { col: floristHours.hours },
      hourlyRate:    { col: floristHours.hourlyRate },
      bonus:         { col: floristHours.bonus },
      deduction:     { col: floristHours.deduction },
      deliveryCount: { col: floristHours.deliveryCount },
    },
    softDeleteCol: floristHours.deletedAt,
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

// ── Deep-join chain (Explorer v2 Wave 2, ADR-0011) ──
// A `chain` is an ordered list of edges resolved SEQUENTIALLY: each edge must
// exist on the PREVIOUS hop's entity (not the primary). Walk it to produce the
// ordered list of entity defs on the path (primary first). Edges-only (no
// free-form joins) + cycle-free (no entity revisited) → cartesian explosion and
// self-join aliasing are structurally impossible.
function walkChain(entityName, chain) {
  const defs = [SCHEMA[entityName]];
  const visited = new Set([entityName]);
  let cur = entityName;
  for (const edge of chain) {
    if (typeof edge !== 'string') return { ok: false, error: 'chain edges must be strings' };
    const jd = SCHEMA[cur]?.joins?.[edge];
    if (!jd) {
      const allowed = Object.keys(SCHEMA[cur]?.joins || {}).join(', ') || '(none)';
      return { ok: false, error: `Unknown chain edge "${edge}" on entity "${cur}". Allowed: ${allowed}` };
    }
    if (visited.has(jd.to)) return { ok: false, error: `chain revisits entity "${jd.to}" (cycles not allowed)` };
    visited.add(jd.to);
    defs.push(SCHEMA[jd.to]);
    cur = jd.to;
  }
  return { ok: true, defs };
}

// The ordered set of entities a spec's fields may reference: the primary, plus
// the chain path OR the star-join targets. Used for a single field resolver that
// accepts BOTH a qualified "entity.field" and a bare "field" (resolved in order)
// anywhere — filters, sort, groupBy, aggregate, columns. Qualified refs make the
// model's job unambiguous and stop the retry-storm from unresolved fields.
function buildScope(spec) {
  const scope = [{ key: spec.entity, def: SCHEMA[spec.entity] }];
  if (Array.isArray(spec.chain)) {
    let cur = spec.entity;
    for (const edge of spec.chain) {
      const jd = SCHEMA[cur]?.joins?.[edge];
      if (!jd) break;
      scope.push({ key: jd.to, def: SCHEMA[jd.to] });
      cur = jd.to;
    }
  } else if (Array.isArray(spec.join)) {
    for (const j of spec.join) {
      const jd = SCHEMA[spec.entity]?.joins?.[j];
      if (jd) scope.push({ key: jd.to, def: SCHEMA[jd.to] });
    }
  }
  return scope;
}

function resolveInScope(scope, fieldRef) {
  if (typeof fieldRef !== 'string') return null;
  const dot = fieldRef.indexOf('.');
  if (dot >= 0) {
    const ek = fieldRef.slice(0, dot);
    const fn = fieldRef.slice(dot + 1);
    const s = scope.find((x) => x.key === ek);
    return s?.def?.fields?.[fn]?.col ?? null;
  }
  for (const s of scope) {
    if (s.def?.fields?.[fieldRef]) return s.def.fields[fieldRef].col;
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

  // ── Deep-join chain validation (ADR-0011) ──
  // A chain replaces the star `join` with an ordered path of edges. Validate its
  // shape up front, then resolve all subsequent fields against the path entities.
  const hasChain = spec.chain !== undefined;
  if (hasChain) {
    if (!Array.isArray(spec.chain)) return { ok: false, error: 'chain must be an array' };
    if (activeJoins.length) return { ok: false, error: 'cannot combine chain with join' };
    if ((spec.aggregate?.length) || (spec.groupBy?.length)) {
      return { ok: false, error: 'chain cannot be combined with groupBy or aggregate (v2 deep-join returns flat rows only)' };
    }
    if (spec.chain.length > MAX_CHAIN) return { ok: false, error: `chain too long (max ${MAX_CHAIN} hops)` };
    const walked = walkChain(spec.entity, spec.chain);
    if (!walked.ok) return { ok: false, error: walked.error };
  }

  // One field resolver for the whole spec: accepts a qualified "entity.field"
  // (resolved against the primary + chain path OR star-join targets) or a bare
  // "field" (searched in scope order). chainDefs is unused now (scope covers it).
  const scope = buildScope(spec);
  const resolve = (fieldName) => resolveInScope(scope, fieldName);

  // Column selection (#504): optional display projection carried in the spec so
  // saved views + the assistant handoff persist it. Each column is "entity.field"
  // or a bare "field" — validated in the same scope as everything else.
  if (spec.columns !== undefined) {
    if (!Array.isArray(spec.columns)) return { ok: false, error: 'columns must be an array' };
    const scopeKeys = scope.map((s) => s.key).join(' → ');
    for (const c of spec.columns) {
      if (typeof c !== 'string') return { ok: false, error: 'columns entries must be strings' };
      if (!resolve(c)) return { ok: false, error: `unknown column "${c}" on the query scope (${scopeKeys})` };
    }
  }

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
      const col = resolve(f.field);
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
      const col = resolve(fieldName);
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
        const col = resolve(agg.field);
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
      const col = resolve(s.field);
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
    const hasChain = Array.isArray(spec.chain);
    // A chain fans out if any hop is a "many" edge (row multiplication → warn).
    let fanOut = false;
    if (hasChain) {
      let cur = entityDef;
      for (const edge of spec.chain) {
        const jd = cur.joins[edge];
        if (jd.cardinality === 'many') fanOut = true;
        cur = SCHEMA[jd.to];
      }
    }
    // Single qualified-or-bare field resolver (same scope as validateSpec).
    const scope = buildScope(spec);
    const resolve = (fieldName) => resolveInScope(scope, fieldName);
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
      const col = resolve(f.field);
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

    // Deep-join chain: the same join-building as applyJoins, but hops are applied
    // SEQUENTIALLY along the path (each edge resolved on the previous hop's
    // entity), producing one denormalized row per matched path (ADR-0011).
    function applyChain(q) {
      let currentDef = entityDef;
      for (const edge of spec.chain) {
        const joinDef = currentDef.joins[edge];
        const joinEntity = SCHEMA[joinDef.to];

        let condition;
        if (joinDef.uuidSide === 'foreign') {
          condition = sql`${joinDef.foreignCol}::text = ${joinDef.localCol}`;
        } else if (joinDef.uuidSide === 'local') {
          condition = sql`${joinDef.localCol}::text = ${joinDef.foreignCol}`;
        } else {
          condition = eq(joinDef.localCol, joinDef.foreignCol);
        }

        const extraConditions = [];
        if (joinEntity.softDeleteCol) extraConditions.push(isNull(joinEntity.softDeleteCol));
        if (joinDef.to === 'orders' && !spec.includeCancelled) {
          extraConditions.push(ne(orders.status, ORDER_STATUS.CANCELLED));
        }

        const fullCondition = extraConditions.length > 0 ? and(condition, ...extraConditions) : condition;
        q = q.innerJoin(joinEntity.table, fullCondition);
        currentDef = joinEntity;
      }
      return q;
    }

    const applyRelations = hasChain ? applyChain : applyJoins;

    // Count query over full match (no limit)
    let countBase = db.select({ total: count() }).from(entityDef.table);
    countBase = applyRelations(countBase);
    if (whereExpr) countBase = countBase.where(whereExpr);

    // Data query
    let dataQuery;
    if (hasAgg || hasGroupBy) {
      // Build select columns: groupBy fields + aggregates
      const selectCols = {};
      for (const fieldName of (spec.groupBy || [])) {
        selectCols[fieldName] = resolve(fieldName);
      }
      for (const agg of (spec.aggregate || [])) {
        const col = agg.field ? resolve(agg.field) : null;
        selectCols[agg.as] = applyAgg(agg.fn, col, agg.as);
      }
      dataQuery = db.select(selectCols).from(entityDef.table);
      dataQuery = applyRelations(dataQuery);
      if (whereExpr) dataQuery = dataQuery.where(whereExpr);
      if (hasGroupBy) {
        const groupCols = spec.groupBy.map(f => resolve(f));
        dataQuery = dataQuery.groupBy(...groupCols);
      }
    } else {
      dataQuery = db.select().from(entityDef.table);
      dataQuery = applyRelations(dataQuery);
      if (whereExpr) dataQuery = dataQuery.where(whereExpr);
    }

    // OrderBy and limit apply to both paths
    for (const s of (spec.sort || [])) {
      const col = resolve(s.field);
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
    const result = { spec, matchedCount, truncated: matchedCount > rows.length, rows };
    // Deep-join chains report fan-out so the UI can warn that a "many" hop
    // multiplied rows (and the cap may have trimmed the tail).
    if (hasChain) result.fanOut = fanOut;
    return result;
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
