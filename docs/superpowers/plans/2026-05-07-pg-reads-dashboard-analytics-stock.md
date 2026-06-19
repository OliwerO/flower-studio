# Postgres Reads — Dashboard, Analytics, Stock Committed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Airtable reads for orders/lines/deliveries/customers in `dashboard.js`, `analytics.js`, and three stock endpoints with Postgres repo calls, so data from after the Phase 4/5 cutover (2026-05-02) is no longer invisible.

**Architecture:** `orderRepo.list()` in postgres mode already loads `_lines` (order lines) and `_delivery` embedded per order — no separate batch fetch needed. `orderRepo.listDeliveries()` handles standalone delivery queries. `customerRepo.findMany()` handles batch customer lookup. Two small repo extensions are needed: `stockPurchasesRepo.list()` and `customerRepo.listWithKeyPeopleHavingDates()`. Dashboard's deferred-lines and negative-stock order-line queries use direct Drizzle since no repo interface covers them.

**Tech Stack:** Node.js, Express, Drizzle ORM, pglite (tests), `backend/src/repos/`, `backend/src/routes/`

**Fixes:** GH #227 (dashboard), #228 (analytics), #229 (stock committed + usage + substitute-swap)

---

## Phase 1: Repo extensions

### Task 1: Add `stockPurchasesRepo.list({ from, to })`

**Files:**
- Modify: `backend/src/repos/stockPurchasesRepo.js`
- Modify: `backend/src/__tests__/stockPurchasesRepo.integration.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/src/__tests__/stockPurchasesRepo.integration.test.js` inside the `describe('stockPurchasesRepo', ...)` block:

```javascript
describe('list', () => {
  it('returns all rows when no date range given', async () => {
    await stockPurchasesRepo.create({ purchaseDate: '2026-04-01', supplier: 'A', quantityPurchased: 10 });
    await stockPurchasesRepo.create({ purchaseDate: '2026-05-01', supplier: 'B', quantityPurchased: 5 });
    const rows = await stockPurchasesRepo.list();
    expect(rows).toHaveLength(2);
  });

  it('filters by from/to date range inclusive', async () => {
    await stockPurchasesRepo.create({ purchaseDate: '2026-03-15', supplier: 'A', quantityPurchased: 10 });
    await stockPurchasesRepo.create({ purchaseDate: '2026-04-10', supplier: 'B', quantityPurchased: 5 });
    await stockPurchasesRepo.create({ purchaseDate: '2026-05-20', supplier: 'C', quantityPurchased: 3 });
    const rows = await stockPurchasesRepo.list({ from: '2026-04-01', to: '2026-04-30' });
    expect(rows).toHaveLength(1);
    expect(rows[0].Supplier).toBe('B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/__tests__/stockPurchasesRepo.integration.test.js
```
Expected: FAIL — `stockPurchasesRepo.list is not a function`

- [ ] **Step 3: Implement `list()`**

Add to `backend/src/repos/stockPurchasesRepo.js` (after `findDateByPoMarker`):

```javascript
import { db } from '../db/index.js';
import { stockPurchases } from '../db/schema.js';
import { eq, and, like, desc, gte, lte } from 'drizzle-orm';
```

Replace the existing import line (it may already have `desc` — just add `gte, lte` if missing). Then add:

```javascript
export async function list({ from, to } = {}) {
  const conditions = [];
  if (from) conditions.push(gte(stockPurchases.purchaseDate, from));
  if (to)   conditions.push(lte(stockPurchases.purchaseDate, to));

  const rows = await db.select().from(stockPurchases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockPurchases.purchaseDate));

  return rows.map(toWire);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/__tests__/stockPurchasesRepo.integration.test.js
```
Expected: all tests pass (9 original + 2 new = 11 total)

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/stockPurchasesRepo.js backend/src/__tests__/stockPurchasesRepo.integration.test.js
git commit -m "feat(repo): add stockPurchasesRepo.list() with date range filter"
```

---

### Task 2: Add `customerRepo.listWithKeyPeopleHavingDates()`

**Files:**
- Modify: `backend/src/repos/customerRepo.js`
- Test inline (no new test file — extend existing customer tests if present, otherwise skip — this is pure read, well-covered by integration)

The dashboard needs customers who have any key person with a non-null `importantDate` set. Current `customerRepo.list()` returns customers with `kps = []` (no key people loaded). This helper loads them from the `key_people` table.

- [ ] **Step 1: Check existing customerRepo imports**

Read `backend/src/repos/customerRepo.js` lines 1–20 to see what's already imported. Ensure `keyPeople` is imported from schema, and `isNotNull`, `inArray`, `or` from drizzle-orm. Add what's missing.

- [ ] **Step 2: Add the function**

Add at the end of `backend/src/repos/customerRepo.js`:

```javascript
// Returns customers who have at least one key person with importantDate set.
// Used by the dashboard reminder widget. Includes kp1/kp2 date fields.
export async function listWithKeyPeopleHavingDates() {
  const kpRows = await db.select().from(keyPeople)
    .where(isNotNull(keyPeople.importantDate));

  if (kpRows.length === 0) return [];

  const custIds = [...new Set(kpRows.map(kp => kp.customerId))];

  const custRows = await db.select().from(customers)
    .where(and(inArray(customers.id, custIds), isNull(customers.deletedAt)));

  const kpsByCustomer = {};
  for (const kp of kpRows) {
    kpsByCustomer[kp.customerId] = kpsByCustomer[kp.customerId] || [];
    kpsByCustomer[kp.customerId].push(kp);
  }

  return custRows.map(row => _pgCustomerToResponse(row, kpsByCustomer[row.id] || []));
}
```

- [ ] **Step 3: Verify backend tests still pass**

```bash
cd backend && npx vitest run
```
Expected: all tests pass (unchanged count)

- [ ] **Step 4: Commit**

```bash
git add backend/src/repos/customerRepo.js
git commit -m "feat(repo): add customerRepo.listWithKeyPeopleHavingDates()"
```

---

## Phase 2: Analytics route (#228)

### Task 3: Rewrite analytics.js — orders, lines, deliveries

**Files:**
- Modify: `backend/src/routes/analytics.js`

The current flow:
1. `db.list(TABLES.ORDERS, dateFilter)` → then batch-fetch lines + deliveries
2. `db.list(TABLES.ORDERS, prevDateFilter)` → then batch-fetch prev lines
3. `db.list(TABLES.ORDERS, cancelledFilter)`

New flow: `orderRepo.list()` returns `_lines` and `_delivery` embedded. No batch fetch needed.

- [ ] **Step 1: Add repo imports**

Replace in `analytics.js`:
```javascript
import * as db from '../services/airtable.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import { TABLES } from '../config/airtable.js';
```
With:
```javascript
import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
```

Also remove `sanitizeFormulaValue` import if it's only used for building Airtable formula strings (check lines 32–51 — after the fix those strings are gone).

- [ ] **Step 2: Replace the parallel fetch block**

Replace lines 54–79 (the `Promise.all` that fetches orders, stock, prevOrders, cancelledOrders, stockPurchases, stockLosses) with:

```javascript
const prevFromStr = prevFromDate.toISOString().split('T')[0];
const prevToStr   = prevToDate.toISOString().split('T')[0];

const [orders, stock, prevOrders, cancelledOrders, stockPurchases, stockLosses] = await Promise.all([
  orderRepo.list({ pg: { dateFrom: from, dateTo: to, excludeStatuses: [ORDER_STATUS.CANCELLED] } }),
  stockRepo.list({ pg: { active: true } }),
  orderRepo.list({ pg: { dateFrom: prevFromStr, dateTo: prevToStr, excludeStatuses: [ORDER_STATUS.CANCELLED] } }),
  orderRepo.list({ pg: { dateFrom: from, dateTo: to, statuses: [ORDER_STATUS.CANCELLED] } }),
  stockPurchasesRepo.list({ from, to }).catch(() => []),
  stockLossRepo.list({ from, to }).catch(() => []),
]);
```

- [ ] **Step 3: Replace the batch-fetch section with _lines extraction**

Delete lines 81–107 (the `allLineIds`, `deliveryIds`, `batchFetch` helper, and the `Promise.all` that fetches `allLines`, `deliveryRecords`, `prevLines`).

Replace with:

```javascript
// orderRepo.list() embeds _lines and _delivery — no separate batch fetch.
const allLines    = orders.flatMap(o => o._lines || []);
const prevLines   = prevOrders.flatMap(o => o._lines || []);
```

- [ ] **Step 4: Fix the lookup maps**

Replace lines 109–123 (building `orderSellTotals`, `orderCostTotals`, `deliveryFeeByOrder`) with:

```javascript
const orderSellTotals  = {};
const orderCostTotals  = {};
const deliveryFeeByOrder = {};

for (const order of orders) {
  for (const line of (order._lines || [])) {
    const qty = line.Quantity || 0;
    orderSellTotals[order.id] = (orderSellTotals[order.id] || 0) + (line['Sell Price Per Unit'] || 0) * qty;
    orderCostTotals[order.id] = (orderCostTotals[order.id] || 0) + (line['Cost Price Per Unit'] || 0) * qty;
  }
  if (order._delivery?.['Delivery Fee']) {
    deliveryFeeByOrder[order.id] = order._delivery['Delivery Fee'];
  }
}
```

- [ ] **Step 5: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/analytics.js
git commit -m "fix(analytics): replace Airtable order/line/delivery reads with orderRepo"
```

---

### Task 4: Analytics — customers section

**Files:**
- Modify: `backend/src/routes/analytics.js`

The current flow at lines 178–224: batch-fetch customers by ID, check `c['App Orders']` for new vs returning.

- [ ] **Step 1: Replace customer batch-fetch**

Replace lines 182–190 (the `for` loop that batch-fetches customers via `db.list(TABLES.CUSTOMERS)`) with:

```javascript
const custRecords = await customerRepo.findMany(customerIds);
```

- [ ] **Step 2: Fix new vs returning logic**

The current check uses `c['App Orders']` (Airtable linked field, not in PG). Replace with a single PG query:

After the `custRecords` fetch, add:

```javascript
// Customers with any order before the current period → "returning"
const { db: pgDb } = await import('../db/index.js');
const { orders: ordersTable } = await import('../db/schema.js');
const { inArray: pgInArray, isNull: pgIsNull, and: pgAnd, lt: pgLt } = await import('drizzle-orm');

const priorRows = await pgDb.select({ customerId: ordersTable.customerId })
  .from(ordersTable)
  .where(pgAnd(
    pgInArray(ordersTable.customerId, customerIds),
    pgLt(ordersTable.orderDate, from),
    pgIsNull(ordersTable.deletedAt),
  ));
const returningCustIds = new Set(priorRows.map(r => r.customerId));
```

Wait — dynamic import is awkward. Better approach: add the drizzle imports statically at the top of the file. Replace the above dynamic import block with:

Add these imports at the top of analytics.js:
```javascript
import { db as pgDb } from '../db/index.js';
import { orders as ordersTable } from '../db/schema.js';
import { inArray, isNull, and as pgAnd, lt } from 'drizzle-orm';
```

Then add after `custRecords` fetch:

```javascript
const priorRows = customerIds.length > 0
  ? await pgDb.select({ customerId: ordersTable.customerId })
      .from(ordersTable)
      .where(pgAnd(
        inArray(ordersTable.customerId, customerIds),
        lt(ordersTable.orderDate, from),
        isNull(ordersTable.deletedAt),
      ))
  : [];
const returningCustIds = new Set(priorRows.map(r => r.customerId));
```

- [ ] **Step 3: Fix the new/returning counter loop**

Replace the loop at lines ~198–207 (which uses `c['App Orders']`) with:

```javascript
for (const c of custRecords) {
  if (returningCustIds.has(c.id)) {
    customers.returningCount++;
  } else {
    customers.newCount++;
  }
}
```

Also fix the `Segment` lookup (line ~209): `custRecords` from `findMany` has limited fields. Either use `c.Segment` (if included) or fetch with full fields. Check `customerRepo.findMany` return shape — it returns `{ id, Name, Nickname, Phone }` only. For segments and topSpenders, need richer data.

Replace `customerRepo.findMany` call with `customerRepo.list()` filtered to these IDs — or extend `findMany` to include segment. The simplest: use `findMany` for name lookup (new/returning, topSpenders name) and accept that `Segment` won't be available from `findMany`. Since `findMany` doesn't return `Segment`, the segment breakdown loop (line ~208) won't work.

Fix: call `customerRepo.list()` (which returns full fields) and then filter to the IDs we care about:

Replace:
```javascript
const custRecords = await customerRepo.findMany(customerIds);
```
With:
```javascript
const allCusts = await customerRepo.list({ withAggregates: false });
const custMap2 = new Map(allCusts.map(c => [c.id, c]));
const custRecords = customerIds.map(id => custMap2.get(id)).filter(Boolean);
```

Note: `customerRepo.list()` also returns `airtableId` via `_pgCustomerToResponse`. Match by `c.id` (UUID) — that's what `orders.customer_id` holds post-Phase-5.

- [ ] **Step 4: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/analytics.js
git commit -m "fix(analytics): replace Airtable customer reads with customerRepo (#228 complete)"
```

---

## Phase 3: Dashboard route (#227)

### Task 5: Dashboard — initial parallel fetch

**Files:**
- Modify: `backend/src/routes/dashboard.js`

Replace the 9-query `Promise.all` at lines 20–78.

- [ ] **Step 1: Add imports**

At top of `dashboard.js`, replace:
```javascript
import * as db from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
```
With:
```javascript
import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import { db as pgDb } from '../db/index.js';
import { orderLines as orderLinesTable, orders as ordersTable } from '../db/schema.js';
import { and, or, eq, isNull, inArray, gte, lte, asc } from 'drizzle-orm';
```

Keep `sanitizeFormulaValue` removal for later — check if it's still used elsewhere in the file before removing.

- [ ] **Step 2: Replace the 9-query Promise.all**

Replace lines 20–78 with:

```javascript
const [orders, ordersDueToday, fulfillToday, tomorrowOrders, deliveries, lowStock, unpaidOrders, negativeStockItems, customersWithDates] = await Promise.all([
  // Today's orders by Order Date (for revenue + status breakdown)
  orderRepo.list({ pg: { forDate: today }, sort: [{ field: 'Order Date', direction: 'desc' }] }).catch(() => []),
  // Orders due today by Required By (count only)
  orderRepo.list({ pg: { requiredByFrom: today, requiredByTo: today, excludeStatuses: [ORDER_STATUS.CANCELLED] } }).catch(() => []),
  // Full data for fulfill-today orders
  orderRepo.list({ pg: { requiredByFrom: today, requiredByTo: today, excludeStatuses: [ORDER_STATUS.CANCELLED] }, sort: [{ field: 'Required By', direction: 'asc' }] }).catch(() => []),
  // Tomorrow's orders for planning view
  orderRepo.list({ pg: { requiredByFrom: tomorrow, requiredByTo: tomorrow, excludeStatuses: [ORDER_STATUS.CANCELLED] } }).catch(() => []),
  // Today's pending deliveries
  orderRepo.listDeliveries({ pg: { date: today } }).then(rows => rows.filter(d => d.Status !== DELIVERY_STATUS.DELIVERED)).catch(() => []),
  // Stock items below reorder threshold
  stockRepo.list({ pg: { active: true, includeEmpty: true } }).then(rows => rows.filter(r => {
    const t = Number(r['Reorder Threshold'] || 0);
    return t > 0 && Number(r['Current Quantity'] || 0) < t;
  })).catch(() => []),
  // Unpaid/partial non-cancelled orders
  orderRepo.list({ pg: { excludeStatuses: [ORDER_STATUS.CANCELLED], paymentStatus: null } })
    .then(rows => rows.filter(o =>
      o['Payment Status'] === PAYMENT_STATUS.UNPAID || o['Payment Status'] === PAYMENT_STATUS.PARTIAL
    )).catch(() => []),
  // Active stock items with negative quantity
  stockRepo.list({ pg: { active: true, includeEmpty: true } }).then(rows => rows.filter(r => Number(r['Current Quantity'] || 0) < 0)).catch(() => []),
  // Customers with key person reminder dates
  customerRepo.listWithKeyPeopleHavingDates().catch(() => []),
]);
```

- [ ] **Step 3: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/dashboard.js
git commit -m "fix(dashboard): replace initial parallel Airtable fetch with repos"
```

---

### Task 6: Dashboard — enrichment (customers + lines)

**Files:**
- Modify: `backend/src/routes/dashboard.js`

Current: fetches customers + order lines by IDs. New: use `_lines` from orderRepo, `customerRepo.findMany()` for names.

- [ ] **Step 1: Replace the orders enrichment section (lines 82–166)**

The current code builds `customerMap` and `totalByOrder` from separately-fetched lines. With `_lines` embedded, replace lines 82–166 with:

```javascript
// Build customerMap from all order customer IDs
const allCustIds = [...new Set([
  ...orders.flatMap(o => o.Customer || []),
  ...fulfillToday.flatMap(o => o.Customer || []),
  ...tomorrowOrders.flatMap(o => o.Customer || []),
].filter(Boolean))];
const custList = allCustIds.length > 0 ? await customerRepo.findMany(allCustIds) : [];
const customerMap = {};
for (const c of custList) {
  customerMap[c.id] = c;
  if (c.airtableId) customerMap[c.airtableId] = c;
}

// Compute sell totals per order from embedded _lines
function computeSellTotal(order) {
  return (order._lines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
}
function enrichOrder(order) {
  const custId = order.Customer?.[0];
  order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
  if (!order['Price Override']) {
    order['Sell Total'] = computeSellTotal(order);
  }
  const deliveryFee = Number(order['Delivery Fee'] || order._delivery?.['Delivery Fee'] || 0);
  order['Effective Price'] = order['Final Price']
    ?? ((order['Price Override'] || order['Sell Total'] || 0) + deliveryFee);
}

for (const order of orders) enrichOrder(order);
for (const order of fulfillToday) enrichOrder(order);
```

- [ ] **Step 2: Replace tomorrow orders enrichment (lines 168–205)**

Replace lines 168–205 (the `tmrwCustIds` + `tmrwLineIds` batch fetches) with:

```javascript
// tomorrowOrders already have _lines from orderRepo — build line summaries directly
const tmrwLineSummary = {};
for (const order of tomorrowOrders) {
  const custId = order.Customer?.[0];
  order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
  const lines = order._lines || [];
  if (lines.length > 0) {
    tmrwLineSummary[order.id] = {
      items: lines.map(l => `${l['Flower Name'] || '?'} ×${l.Quantity || 1}`),
      count: lines.length,
    };
  }
  const summary = tmrwLineSummary[order.id];
  order['Line Summary'] = summary ? summary.items.join(', ') : '';
  order['Line Count'] = summary ? summary.count : 0;
}
```

- [ ] **Step 3: Replace unpaid order lines enrichment (lines 225–272)**

The unpaid aging section fetches order lines for unpaid orders. Use `_lines`:

Replace lines 225–242 (the `unpaidLineIds` + `unpaidLines` fetch and the `unpaidTotalByOrder` loop) with:

```javascript
const unpaidTotalByOrder = {};
for (const o of unpaidOrders) {
  unpaidTotalByOrder[o.id] = (o._lines || []).reduce(
    (sum, l) => sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0
  );
}
```

- [ ] **Step 4: Enrich pending deliveries — replace extra orders fetch (lines 312–340)**

`deliveries` from `orderRepo.listDeliveries()` already have `Linked Order` as an array of order IDs. The current code fetches extra orders not in `orders` to get customer names. Replace with:

```javascript
const orderIdSet = new Set(orders.map(o => o.id));
const missingOrderIds = deliveries.flatMap(d => d['Linked Order'] || []).filter(id => !orderIdSet.has(id));

const orderMapForDeliveries = {};
for (const o of orders) orderMapForDeliveries[o.id] = o;

if (missingOrderIds.length > 0) {
  const extraOrders = await Promise.all(missingOrderIds.map(id => orderRepo.getById(id).catch(() => null)));
  const extraCustIds = extraOrders.filter(Boolean).flatMap(o => o.Customer || []);
  const extraCusts = extraCustIds.length > 0 ? await customerRepo.findMany(extraCustIds) : [];
  for (const c of extraCusts) { customerMap[c.id] = c; if (c.airtableId) customerMap[c.airtableId] = c; }
  for (const o of extraOrders.filter(Boolean)) orderMapForDeliveries[o.id] = o;
}

for (const d of deliveries) {
  const orderId = d['Linked Order']?.[0];
  const order = orderMapForDeliveries[orderId];
  const custId = order?.Customer?.[0];
  const cust = customerMap[custId];
  if (cust) d['Customer Name'] = cust.Name || cust.Nickname || '';
}
```

- [ ] **Step 5: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/dashboard.js
git commit -m "fix(dashboard): replace Airtable customer/line enrichment with repos and _lines"
```

---

### Task 7: Dashboard — deferred lines + negative stock order lines

**Files:**
- Modify: `backend/src/routes/dashboard.js`

These two sections cannot use orderRepo directly — they query order_lines filtered by stock attributes and deferred flag. Use Drizzle directly (the route already imports `pgDb` and schema tables from Task 5 step 1).

- [ ] **Step 1: Replace deferred lines fetch (lines 344–380)**

Replace lines 344–380 (the `db.list(TABLES.ORDER_LINES, { Stock Deferred })` + parent orders fetch) with:

```javascript
// Deferred order lines: lines that signal "need to buy" without deducting stock
const rawDeferredLines = await pgDb.select().from(orderLinesTable)
  .where(and(eq(orderLinesTable.stockDeferred, true), isNull(orderLinesTable.deletedAt)));

const deferredDemand = {};
if (rawDeferredLines.length > 0) {
  const deferredOrderIds = [...new Set(rawDeferredLines.map(l => l.orderId).filter(Boolean))];
  const deferredOrders = await orderRepo.list({
    pg: { excludeStatuses: [ORDER_STATUS.CANCELLED] },
  }).then(rows => rows.filter(o => deferredOrderIds.includes(o.id) || deferredOrderIds.includes(o._pgId)));

  const deferredOrderMap = {};
  for (const o of deferredOrders) {
    deferredOrderMap[o.id] = o;
    if (o._pgId) deferredOrderMap[o._pgId] = o;
  }

  for (const line of rawDeferredLines) {
    const stockId = line.stockItemId;
    if (!stockId) continue;
    const parentOrder = deferredOrderMap[line.orderId];
    if (!parentOrder) continue;
    const reqBy = parentOrder['Required By'] || null;
    const displayKey = stockId;
    if (!deferredDemand[displayKey]) {
      deferredDemand[displayKey] = { name: line.flowerName || '?', qty: 0, neededBy: null };
    }
    deferredDemand[displayKey].qty += Number(line.quantity || 0);
    if (reqBy && (!deferredDemand[displayKey].neededBy || reqBy < deferredDemand[displayKey].neededBy)) {
      deferredDemand[displayKey].neededBy = reqBy;
    }
  }
}
```

- [ ] **Step 2: Replace negative stock order lines fetch (lines 384–449)**

The current code uses `s['Order Lines']` (Airtable linked field not in PG). Replace the entire negative stock enrichment block with:

```javascript
let negativeStock = [];
if (negativeStockItems.length > 0) {
  // Get PG UUIDs for negative stock items
  const negPgIds = negativeStockItems.map(s => s._pgId).filter(Boolean);

  // Find order lines referencing these stock items
  const negLines = negPgIds.length > 0
    ? await pgDb.select({
        orderId:     orderLinesTable.orderId,
        stockItemId: orderLinesTable.stockItemId,
      }).from(orderLinesTable)
        .where(and(inArray(orderLinesTable.stockItemId, negPgIds), isNull(orderLinesTable.deletedAt)))
    : [];

  // Get unique order IDs and fetch non-cancelled orders
  const negOrderIds = [...new Set(negLines.map(l => l.orderId).filter(Boolean))];
  const negOrders = negOrderIds.length > 0
    ? await orderRepo.list({ pg: { excludeStatuses: [ORDER_STATUS.CANCELLED] } })
        .then(rows => rows.filter(o => negOrderIds.includes(o.id) || negOrderIds.includes(o._pgId)))
    : [];
  const negOrderMap = {};
  for (const o of negOrders) {
    negOrderMap[o.id] = o;
    if (o._pgId) negOrderMap[o._pgId] = o;
  }

  // Build map: stockPgId → earliest neededBy
  const neededByMap = {};
  for (const nl of negLines) {
    const order = negOrderMap[nl.orderId];
    if (!order?.['Required By']) continue;
    if (!neededByMap[nl.stockItemId] || order['Required By'] < neededByMap[nl.stockItemId]) {
      neededByMap[nl.stockItemId] = order['Required By'];
    }
  }

  const groupMap = new Map();
  for (const s of negativeStockItems) {
    const groupKey = s['Purchase Name'] || s['Display Name'];
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { id: s.id, batchIds: [], name: groupKey, qty: 0, neededBy: null, supplier: s.Supplier || null });
    }
    const group = groupMap.get(groupKey);
    group.qty += Number(s['Current Quantity'] || 0);
    group.batchIds.push(s.id);
    const nb = neededByMap[s._pgId];
    if (nb && (!group.neededBy || nb < group.neededBy)) group.neededBy = nb;
    if (!group.supplier && s.Supplier) group.supplier = s.Supplier;
  }
  negativeStock = [...groupMap.values()];
  negativeStock.sort((a, b) => {
    if (a.neededBy && b.neededBy) return a.neededBy.localeCompare(b.neededBy);
    if (a.neededBy) return -1;
    return 1;
  });
}
```

- [ ] **Step 3: Remove unused `db` import if no more Airtable calls**

Scan dashboard.js for any remaining `db.list` / `db.getById` calls. If none, remove the `import * as db from '../services/airtable.js'` and `import { TABLES }` lines.

- [ ] **Step 4: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dashboard.js
git commit -m "fix(dashboard): replace Airtable deferred-lines + neg-stock queries with Drizzle (#227 complete)"
```

---

## Phase 4: Stock endpoints (#229)

### Task 8: Stock — `/committed` endpoint

**Files:**
- Modify: `backend/src/routes/stock.js`

Current: `db.list(TABLES.ORDERS)` + `listByIds(TABLES.ORDER_LINES)` + `listByIds(TABLES.CUSTOMERS)`.
New: `orderRepo.list()` with `_lines` embedded. `customerRepo.findMany()` for names.

- [ ] **Step 1: Add imports to stock.js**

Check the current imports at the top of `backend/src/routes/stock.js`. Add what's missing:

```javascript
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
```

- [ ] **Step 2: Replace the `/committed` handler body (lines 172–232)**

Replace lines 172–232 with:

```javascript
router.get('/committed', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const activeOrders = await orderRepo.list({
      pg: {
        excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
        requiredByFrom: today,
      },
    });

    const uniqueCustomerIds = [...new Set(activeOrders.flatMap(o => o.Customer || []))];
    const allCustomers = uniqueCustomerIds.length > 0 ? await customerRepo.findMany(uniqueCustomerIds) : [];
    const customerMap = {};
    for (const c of allCustomers) { customerMap[c.id] = c; if (c.airtableId) customerMap[c.airtableId] = c; }

    const committed = {};
    for (const order of activeOrders) {
      const custId = order.Customer?.[0];
      const customerName = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
      for (const line of (order._lines || [])) {
        const stockId = line['Stock Item']?.[0];
        if (!stockId) continue;
        const qty = Number(line.Quantity || 0);
        if (qty <= 0) continue;
        if (!committed[stockId]) committed[stockId] = { committed: 0, orders: [] };
        committed[stockId].committed += qty;
        committed[stockId].orders.push({
          orderId: order.id,
          appOrderId: order['App Order ID'] || '',
          customerName,
          requiredBy: order['Required By'] || null,
          status: order.Status || 'New',
          qty,
        });
      }
    }

    res.json(committed);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/stock.js
git commit -m "fix(stock): replace Airtable committed demand query with orderRepo"
```

---

### Task 9: Stock — `/usage` endpoint (line ~521)

**Files:**
- Modify: `backend/src/routes/stock.js`

Current at line ~521: `db.list(TABLES.ORDERS)` past year → `listByIds(TABLES.ORDER_LINES)` → filter by siblingIds → `listByIds(TABLES.CUSTOMERS)`.
New: `orderRepo.list()` with `_lines` embedded, filter `_lines` by stockItemId.

- [ ] **Step 1: Find the usage endpoint context**

The usage endpoint is inside a handler for `GET /api/stock/:id/usage`. The `siblingIds` set is built earlier in the same handler from the stock item + substitutes. The Airtable queries start at approximately line 520. Find the exact lines for the `recentOrders` / `allLines` block.

- [ ] **Step 2: Replace the Airtable orders + lines block**

Replace the block starting with `const orderCutoff = new Date(Date.now() - 365 * 86400000)` through `const matchedLines = allLines.filter(l => siblingIds.has(...))` with:

```javascript
const orderCutoff = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
const recentOrders = await orderRepo.list({
  pg: { dateFrom: orderCutoff },
}).catch(() => []);

// Filter _lines to those whose Stock Item resolves to one of our siblings
const matchedLines = [];
const orderMap = {};
for (const o of recentOrders) {
  orderMap[o.id] = o;
  for (const line of (o._lines || [])) {
    if (siblingIds.has(line['Stock Item']?.[0])) {
      matchedLines.push({ ...line, _orderId: o.id });
    }
  }
}
```

- [ ] **Step 3: Replace the customer fetch**

Replace the `const customerIds = [...]` + `const customers = customerIds.length > 0 ? await listByIds(...)` block with:

```javascript
const matchedOrderIds = new Set(matchedLines.map(l => l._orderId));
const customerIds = [...new Set(
  recentOrders.filter(o => matchedOrderIds.has(o.id)).flatMap(o => o.Customer || [])
)];
const custList = customerIds.length > 0 ? await customerRepo.findMany(customerIds) : [];
const customerMap = {};
for (const c of custList) { customerMap[c.id] = c; if (c.airtableId) customerMap[c.airtableId] = c; }
```

- [ ] **Step 4: Fix the usageOrders mapping**

Replace the `usageOrders` mapping that uses `l.Order?.[0]` with `l._orderId`:

```javascript
const usageOrders = matchedLines.map(l => {
  const orderId = l._orderId;
  const o = orderId ? orderMap[orderId] : null;
  const custId = o?.Customer?.[0];
  const cust = custId ? customerMap[custId] : null;
  return {
    type: 'order',
    date: o?.['Order Date'] || o?.['Required By'] || null,
    requiredBy: o?.['Required By'] || null,
    orderRecordId: orderId || '',
    orderId: o?.['App Order ID'] || orderId || '',
    customer: cust?.Name || cust?.Nickname || '',
    status: o?.Status || '',
    quantity: -(l.Quantity || 0),
    flowerName: l['Flower Name'] || displayName,
  };
});
```

- [ ] **Step 5: Run backend tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/stock.js
git commit -m "fix(stock): replace Airtable usage history query with orderRepo"
```

---

### Task 10: Stock — substitute swap endpoint (line ~896) + cleanup + verification

**Files:**
- Modify: `backend/src/routes/stock.js`

The substitute swap handler at ~line 896 queries `db.list(TABLES.ORDERS)` for non-terminal orders + their lines + customers.

- [ ] **Step 1: Replace the orders + lines block (lines ~896–907)**

Replace the block starting with `const orders = await db.list(TABLES.ORDERS, ...)` through building `allLines` with:

```javascript
const activeOrders = await orderRepo.list({
  pg: { excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED] },
}).catch(() => []);
```

- [ ] **Step 2: Replace customer fetch (lines ~908–913)**

```javascript
const custIds = [...new Set(activeOrders.flatMap(o => o.Customer || []))];
const custs = custIds.length > 0 ? await customerRepo.findMany(custIds) : [];
const custMap = {};
for (const c of custs) { custMap[c.id] = c; if (c.airtableId) custMap[c.airtableId] = c; }
```

- [ ] **Step 3: Fix order map and linesByOriginal loop**

Replace the `orderMap` building + `allLineIds` / `allLines` variables with:

```javascript
const orderMap = {};
for (const o of activeOrders) {
  const cid = o.Customer?.[0];
  orderMap[o.id] = {
    appOrderId: o['App Order ID'] || '',
    customerName: custMap[cid]?.Name || custMap[cid]?.Nickname || '',
    requiredBy: o['Required By'] || null,
    status: o.Status || '',
  };
}

const linesByOriginal = {};
const originalIdSet = new Set(originalIds);
for (const order of activeOrders) {
  for (const line of (order._lines || [])) {
    const stockId = line['Stock Item']?.[0];
    if (!stockId || !originalIdSet.has(stockId)) continue;
    const qty = Number(line.Quantity || 0);
    if (qty <= 0) continue;
    const oi = orderMap[order.id];
    if (!oi) continue;
    if (!linesByOriginal[stockId]) linesByOriginal[stockId] = [];
    linesByOriginal[stockId].push({
      lineId: line.id,
      orderId: order.id,
      appOrderId: oi.appOrderId,
      customerName: oi.customerName,
      requiredBy: oi.requiredBy,
      orderStatus: oi.status,
      quantity: qty,
      suggestedSwapQty: qty,
    });
  }
}
```

- [ ] **Step 4: Remove unused Airtable imports from stock.js**

Check if any remaining `db.list` / `db.getById` calls reference `TABLES.ORDERS`, `TABLES.ORDER_LINES`, or `TABLES.CUSTOMERS`. If not, remove those from the import.

Note: `stock.js` also reads from `TABLES.STOCK_ORDERS`, `TABLES.STOCK_ORDER_LINES` — those are separate issues (#229 only covers order/customer reads). Leave those in place.

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && npx vitest run
```
Expected: all tests pass (308+ total)

- [ ] **Step 6: Run E2E suite**

```bash
cd /Users/oliwer/Projects/flower-studio && npm run harness &
sleep 5
npm run test:e2e
```
Expected: 153/153 assertions pass

- [ ] **Step 7: Commit and push**

```bash
git add backend/src/routes/stock.js backend/src/routes/dashboard.js backend/src/routes/analytics.js
git commit -m "fix(stock): replace Airtable substitute-swap query with orderRepo (#229 complete)"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ #228 analytics: orders, lines, deliveries, customers, stock purchases all replaced
- ✅ #227 dashboard: orders (×4), deliveries, customers with dates, enrichment, deferred lines, negative stock order lines all replaced
- ✅ #229 stock committed: orders + lines + customers replaced
- ✅ #229 stock usage: orders + lines + customers replaced
- ✅ #229 stock substitute swap: orders + lines + customers replaced

**Remaining Airtable reads NOT in scope (tracked separately):**
- `stock.js` pending-PO endpoint: `TABLES.STOCK_ORDERS`, `TABLES.STOCK_ORDER_LINES` — out of scope for this PR
- `stockOrders.js` demand view (line ~941) — separate ticket
- `analytics.js` stock read: already uses `stockRepo.list()` (line 56) ✅

**Known risk areas:**
- Dashboard `deferredDemand` merge into `negativeStock` loop (lines 451–477): key is `stockId` from deferred lines which is now a PG UUID. The `negativeStock` entries use `s.id` which is `airtableId || pgId`. Verify merge matches correctly: deferred lines use `line.stockItemId` (PG UUID) which is stored as `displayKey`. `negativeStock` entries have `batchIds` populated with `s.id`. Ensure the `find` at line ~454 compares correctly.

- Analytics `prevLines` is now `prevOrders.flatMap(o => o._lines || [])`. The `topProducts` + `topPairings` functions in `analyticsService.js` reference `line['Order']?.[0]` and `line['Flower Name']`. PG lines have `Order: [orderId]` and `Flower Name` in wire format ✅

- `orderRepo.list({ pg: { forDate: today } })` uses `OR(orderDate = today, requiredBy = today)` per line 293 of orderRepo.js. Confirm this matches the original "DATESTR({Order Date}) = today" intent ✅
