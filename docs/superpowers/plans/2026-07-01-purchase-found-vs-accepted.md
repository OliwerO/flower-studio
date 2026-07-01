# Purchase Found-vs-Accepted Quantity Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `stock_purchases.quantity_purchased` to always represent the Found (bought/paid-for) quantity, not the post-write-off Accepted quantity, so Ask Blossom's `purchase_detail`/`purchase_spend` tools report real money spent — and add a companion `quantity_accepted` column so received-vs-kept stays visible for traceability.

**Architecture:** Additive schema change (one nullable column) + a two-line value swap at the two PO-evaluation call sites that write `stock_purchases` rows + read-side field pass-through in the assistant tool pack + `query_records` allow-list + lab factory parity. No formula changes needed downstream — `purchase_spend`/`purchase_detail`'s `unitPrice * quantityPurchased` math is already correct; only the *value written* into `quantity_purchased` was wrong.

**Tech Stack:** Node.js/Express, Drizzle ORM, Postgres (pglite for tests), Vitest, supertest.

## Global Constraints
- Never raw SQL in routes/repos — Drizzle query builder only.
- `quantity_accepted` is nullable — historical rows stay `NULL`, never backfilled with a guess.
- `db.transaction(...)` is not required here — each `stockPurchasesRepo.create()` call is a single-row insert, same as today.
- Business logic (the Found/Accepted split) belongs in `stockOrders.js`'s `/evaluate` route + `receiveIntoStock`/repo layer, never inlined into the assistant tool packs (thin adapters only, per backend CLAUDE.md).
- PRD: https://github.com/OliwerO/flower-studio/issues/492

---

### Task 1: Schema — add `quantity_accepted` column

**Files:**
- Modify: `backend/src/db/schema.js:455-470` (`stockPurchases` table def)
- Create: `backend/src/db/migrations/0019_stock_purchases_quantity_accepted.sql`

**Interfaces:**
- Produces: `stockPurchases.quantityAccepted` (Drizzle column, `integer`, nullable, no default) — consumed by Task 2.

- [ ] **Step 1: Add the column to the Drizzle schema**

In `backend/src/db/schema.js`, inside the `stockPurchases` table definition, add the new column directly after `quantityPurchased`:

```js
export const stockPurchases = pgTable('stock_purchases', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  airtableId:         text('airtable_id'),
  purchaseDate:       text('purchase_date').notNull(),  // YYYY-MM-DD
  supplier:           text('supplier').notNull().default(''),
  stockId:            uuid('stock_id').references(() => stock.id),
  stockAirtableId:    text('stock_airtable_id'),  // Airtable recXXX of batch during cutover
  quantityPurchased:  integer('quantity_purchased').notNull().default(0),
  quantityAccepted:   integer('quantity_accepted'), // nullable — kept qty after write-off; NULL on historical rows
  pricePerUnit:       numeric('price_per_unit', { precision: 10, scale: 4 }),
  notes:              text('notes').notNull().default(''),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  airtableIdx:  uniqueIndex('stock_purchases_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  dateIdx:      index('stock_purchases_date_idx').on(t.purchaseDate),
  stockIdx:     index('stock_purchases_stock_id_idx').on(t.stockId),
}));
```

- [ ] **Step 2: Write the migration file**

Create `backend/src/db/migrations/0019_stock_purchases_quantity_accepted.sql`:

```sql
-- Purchase Found-vs-Accepted split (issue #492).
-- quantity_purchased now always means "Found/bought" (the money-spend basis);
-- this new column carries the post-write-off "Accepted/kept" quantity for
-- traceability. Nullable — historical rows are NOT backfilled since the true
-- historical Found quantity isn't reconstructable from the polluted
-- quantity_purchased value alone.

ALTER TABLE "stock_purchases" ADD COLUMN "quantity_accepted" integer;
```

- [ ] **Step 3: Verify pglite picks up the migration**

Run: `cd backend && npx vitest run src/__tests__/stockOrderRepo.integration.test.js`
Expected: PASS (this test boots the pglite harness, which applies all migrations in `db/migrations/` lexicographically — confirms 0019 doesn't break harness boot).

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.js backend/src/db/migrations/0019_stock_purchases_quantity_accepted.sql
git commit -m "feat(stock): add quantity_accepted column to stock_purchases"
```

---

### Task 2: Repo — persist and surface `quantityAccepted`

**Files:**
- Modify: `backend/src/repos/stockPurchasesRepo.js:5-33` (`toWire`, `create`)
- Test: `backend/src/__tests__/stockPurchasesRepo.test.js` (new file)

**Interfaces:**
- Consumes: `stockPurchases.quantityAccepted` (Task 1).
- Produces: `stockPurchasesRepo.create({ ..., quantityAccepted })` — persists the field; `stockPurchasesRepo.list()`/wire rows carry `'Quantity Accepted'` (number or `null`). Consumed by Task 3 (write) and Task 4 (read).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/stockPurchasesRepo.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('stockPurchasesRepo — quantityAccepted (#492)', () => {
  it('persists and returns quantityAccepted when provided', async () => {
    const row = await stockPurchasesRepo.create({
      purchaseDate: '2026-07-01',
      supplier: 'Stefan',
      quantityPurchased: 20,
      quantityAccepted: 17,
      pricePerUnit: 5,
      notes: 'test',
    });
    expect(row['Quantity Purchased']).toBe(20);
    expect(row['Quantity Accepted']).toBe(17);

    const [listed] = await stockPurchasesRepo.list({ from: '2026-07-01', to: '2026-07-01' });
    expect(listed['Quantity Accepted']).toBe(17);
  });

  it('returns null (not 0) for quantityAccepted on a legacy-shaped row', async () => {
    const row = await stockPurchasesRepo.create({
      purchaseDate: '2026-07-01',
      supplier: 'Stefan',
      quantityPurchased: 10,
      pricePerUnit: 5,
      notes: 'legacy-shape, no quantityAccepted',
    });
    expect(row['Quantity Accepted']).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/stockPurchasesRepo.test.js`
Expected: FAIL — `row['Quantity Accepted']` is `undefined`, not `17`/`null` (field doesn't exist on the wire object yet).

- [ ] **Step 3: Implement — update `toWire` and `create`**

In `backend/src/repos/stockPurchasesRepo.js`, replace the `toWire` function and `create` function:

```js
function toWire(row) {
  return {
    id:                  row.id,
    airtableId:          row.airtableId || null,
    'Purchase Date':     row.purchaseDate,
    Supplier:            row.supplier || '',
    Flower:              row.stockAirtableId
                           ? [row.stockAirtableId]
                           : row.stockId ? [row.stockId] : [],
    'Quantity Purchased': Number(row.quantityPurchased || 0),
    'Quantity Accepted':  row.quantityAccepted != null ? Number(row.quantityAccepted) : null,
    'Price Per Unit':    row.pricePerUnit != null ? Number(row.pricePerUnit) : null,
    Notes:               row.notes || '',
  };
}

export async function create({ purchaseDate, supplier, stockId, stockAirtableId, quantityPurchased, quantityAccepted, pricePerUnit, notes }) {
  const values = {
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    supplier:     supplier || '',
    quantityPurchased: Number(quantityPurchased) || 0,
    notes:        notes || '',
  };
  if (stockId)          values.stockId         = stockId;
  if (stockAirtableId)  values.stockAirtableId = stockAirtableId;
  if (pricePerUnit != null) values.pricePerUnit = String(pricePerUnit);
  if (quantityAccepted != null) values.quantityAccepted = Number(quantityAccepted);

  const [row] = await db.insert(stockPurchases).values(values).returning();
  return toWire(row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/stockPurchasesRepo.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/stockPurchasesRepo.js backend/src/__tests__/stockPurchasesRepo.test.js
git commit -m "feat(stock): persist quantityAccepted on stock_purchases rows"
```

---

### Task 3: Evaluate route — fix both write sites (primary + substitute)

**Files:**
- Modify: `backend/src/routes/stockOrders.js:891-909` (primary receive)
- Modify: `backend/src/routes/stockOrders.js:936-967` (substitute receive)
- Test: `backend/src/__tests__/stockOrders.evaluatePurchaseQty.integration.test.js` (new file)

**Interfaces:**
- Consumes: `stockPurchasesRepo.create({ ..., quantityAccepted })` (Task 2); `line['Quantity Found']` / `line['Alt Quantity Found']` (existing fields, already read at line 930 for the alt case — needs reading for primary too); `evalLine.quantityAccepted` / `evalLine.altQuantityAccepted` (existing request-body fields).
- Produces: nothing new consumed downstream — this task is the money-basis fix itself. `purchase_detail`/`purchase_spend` (Task 4/5) automatically read correct values once this lands.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/stockOrders.evaluatePurchaseQty.integration.test.js`:

```js
// Regression: PO evaluation must record stock_purchases.quantity_purchased
// as the FOUND (bought/paid-for) quantity, not the post-write-off ACCEPTED
// quantity — issue #492. The supplier bills for what was bought at market
// regardless of later breakage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({ createOrder: vi.fn(), autoMatchStock: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({ targetMarkup: 2.5 }[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockOrdersRouter from '../routes/stockOrders.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; next(); });
  app.use('/api/stock-orders', stockOrdersRouter);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

let harness, app;
const agent = () => supertest(app);

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('PO evaluate — Found vs Accepted purchase quantity (#492)', () => {
  it('primary line: records quantity_purchased=Found, quantity_accepted=Accepted', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'found-vs-accepted',
      lines: [{ flowerName: 'Ranunculus', quantity: 20, costPrice: 5, sellPrice: 12, supplier: 'Stefan' }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);

    // Owner enters actual quantities during Reviewing.
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ 'Quantity Found': 20 });
    const approved = await agent().post(`/api/stock-orders/${poId}/approve-review`);
    expect(approved.status).toBe(200);

    // Florist evaluates: 3 stems arrived broken, 17 accepted.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 17, writeOffQty: 3, writeOffReason: 'Arrived Broken' }],
    });
    expect(evaluated.status).toBe(200);

    const [purchase] = await stockPurchasesRepo.list({ from: '1900-01-01', to: '2100-01-01' });
    expect(purchase).toBeDefined();
    expect(purchase['Quantity Purchased']).toBe(20); // Found — the money-spend basis
    expect(purchase['Quantity Accepted']).toBe(17);   // Accepted — kept after write-off

    const amountPaid = purchase['Price Per Unit'] * purchase['Quantity Purchased'];
    expect(amountPaid).toBe(100); // 20 * 5, not 17 * 5 = 85
  });

  it('substitute line: records quantity_purchased=Alt Quantity Found, quantity_accepted=altQuantityAccepted', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'sub-found-vs-accepted',
      lines: [{ flowerName: 'Peony', quantity: 10, costPrice: 8, sellPrice: 20, supplier: 'Stefan' }],
    });
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);

    // Driver substitutes: found 10 Ranunculus at market for 90 zł total.
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({
      'Alt Supplier':       'OZ',
      'Alt Flower Name':    'Ranunculus',
      'Alt Quantity Found': 10,
      'Alt Cost':           90,
    });
    await agent().post(`/api/stock-orders/${poId}/approve-review`);

    // Florist accepts 8, writes off 2.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 0, writeOffQty: 0, altQuantityAccepted: 8, altWriteOffQty: 2, altWriteOffReason: 'Arrived Broken' }],
    });
    expect(evaluated.status).toBe(200);

    const purchases = await stockPurchasesRepo.list({ from: '1900-01-01', to: '2100-01-01' });
    const subPurchase = purchases.find(p => p.Supplier === 'OZ');
    expect(subPurchase).toBeDefined();
    expect(subPurchase['Quantity Purchased']).toBe(10); // Alt Quantity Found
    expect(subPurchase['Quantity Accepted']).toBe(8);

    const amountPaid = subPurchase['Price Per Unit'] * subPurchase['Quantity Purchased'];
    expect(amountPaid).toBeCloseTo(90, 2); // altCostTotal, not 8 * (90/10) = 72
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/stockOrders.evaluatePurchaseQty.integration.test.js`
Expected: FAIL — `purchase['Quantity Purchased']` is `17` (Accepted) not `20` (Found) in the first test; `subPurchase['Quantity Purchased']` is `8` not `10` in the second.

- [ ] **Step 3: Fix the primary receive call site**

In `backend/src/routes/stockOrders.js`, locate the block starting at (current) line 891 — the primary receive. Add a `foundQty` read next to the existing `accepted`/`writeOff` reads (near line 777), and use it in the `stockPurchasesRepo.create` call:

Near line 777, add:
```js
        const accepted = Number(evalLine.quantityAccepted) || 0;
        const writeOff = Number(evalLine.writeOffQty) || 0;
        // Found = what was actually bought/paid for at market (Owner-entered
        // during Reviewing). This is the money-spend basis — the supplier
        // bills for it regardless of later write-off. Falls back to
        // accepted+writeOff if Quantity Found was never entered (legacy PO
        // rows created before the Reviewing step existed).
        const found = Number(line['Quantity Found']) || (accepted + writeOff);
```

Then update the `stockPurchasesRepo.create` call (current lines 897-905):
```js
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier,
              stockId:           batchItem?._pgId || null,
              stockAirtableId:   typeof finalItemId === 'string' && finalItemId.startsWith('rec') ? finalItemId : null,
              quantityPurchased: found,
              quantityAccepted:  accepted,
              pricePerUnit:      costPrice,
              notes:             primaryMarker,
            });
```

- [ ] **Step 4: Fix the substitute receive call site**

Locate the substitute block (current lines 959-967) and update:

```js
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier:          altSupplier,
              stockId:           altBatchItem?._pgId || null,
              stockAirtableId:   typeof altFinalId === 'string' && altFinalId.startsWith('rec') ? altFinalId : null,
              quantityPurchased: altQtyFound,
              quantityAccepted:  altAccepted,
              pricePerUnit:      altCostPerStem,
              notes:             `${altMarker} - substitute for "${line['Flower Name'] || ''}"`,
            });
```

(`altQtyFound` already exists at line 930 — no new variable needed here.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/stockOrders.evaluatePurchaseQty.integration.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the existing receiveIntoStock regression suite to confirm no breakage**

Run: `cd backend && npx vitest run src/__tests__/stockOrders.receiveIntoStock.integration.test.js`
Expected: PASS (7 tests) — this task doesn't touch `receiveIntoStock` itself, only the purchase-record write immediately after it.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/stockOrders.js backend/src/__tests__/stockOrders.evaluatePurchaseQty.integration.test.js
git commit -m "fix(stock): record purchase qty as Found (paid-for), not post-write-off Accepted"
```

---

### Task 4: `purchase_detail` assistant tool — surface Accepted + written-off

**Files:**
- Modify: `backend/src/services/assistantTools/purchaseDetailPack.js`
- Test: `backend/src/__tests__/assistantTools.purchaseDetail.test.js` (new file)

**Interfaces:**
- Consumes: `stockPurchasesRepo.list()` row shape with `'Quantity Accepted'` (Task 2).
- Produces: each `transactions[]` entry gains `quantityAccepted` (number or `null`) and `writtenOff` (number or `null`, only computed when `quantityAccepted` is non-null). `amount`/`totalSpend` unchanged (still `unitPrice * qty` where `qty` now correctly means Found).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/assistantTools.purchaseDetail.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../repos/stockPurchasesRepo.js', () => ({
  list: vi.fn().mockResolvedValue([
    {
      'Purchase Date': '2026-07-01',
      Supplier: 'Stefan',
      Flower: ['stock-1'],
      'Quantity Purchased': 20,
      'Quantity Accepted': 17,
      'Price Per Unit': 5,
      Notes: 'PO #PO-20260701-1 L#abc primary',
    },
    {
      'Purchase Date': '2026-07-02',
      Supplier: 'Stefan',
      Flower: ['stock-1'],
      'Quantity Purchased': 10,
      'Quantity Accepted': null, // legacy row, pre-#492
      'Price Per Unit': 4,
      Notes: 'PO #PO-20260702-1 L#def primary',
    },
  ]),
}));
vi.mock('../repos/stockRepo.js', () => ({
  listByIds: vi.fn().mockResolvedValue([{ id: 'stock-1', 'Display Name': 'Ranunculus' }]),
}));

import { purchaseDetailHandler } from '../services/assistantTools/purchaseDetailPack.js';

describe('purchase_detail — Found vs Accepted (#492)', () => {
  it('reports amount against Found (quantityPurchased) and surfaces Accepted + writtenOff', async () => {
    const result = await purchaseDetailHandler({ supplier: 'Stefan' });

    expect(result.totalSpend).toBe(20 * 5 + 10 * 4); // 140 — Found-based, not Accepted-based

    const [t1, t2] = result.transactions;
    expect(t1.qty).toBe(20);
    expect(t1.quantityAccepted).toBe(17);
    expect(t1.writtenOff).toBe(3);
    expect(t1.amount).toBe(100);

    expect(t2.qty).toBe(10);
    expect(t2.quantityAccepted).toBe(null);
    expect(t2.writtenOff).toBe(null); // can't derive writtenOff without a known Accepted value
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.purchaseDetail.test.js`
Expected: FAIL — `t1.quantityAccepted` and `t1.writtenOff` are `undefined`.

- [ ] **Step 3: Implement**

In `backend/src/services/assistantTools/purchaseDetailPack.js`, update the `allTransactions` mapping (the `matched.map((r) => {...})` block):

```js
  const allTransactions = matched.map((r) => {
    const qty = Number(r['Quantity Purchased']) || 0;
    const unitPrice = r['Price Per Unit'] != null ? Number(r['Price Per Unit']) : null;
    const amount = round((unitPrice || 0) * qty);
    const date = r['Purchase Date'];
    const flowerName = flowerNameFor(r);
    const supplierName = r.Supplier || '';
    const quantityAccepted = r['Quantity Accepted'] != null ? Number(r['Quantity Accepted']) : null;
    const writtenOff = quantityAccepted != null ? round(qty - quantityAccepted) : null;

    total += amount;
    byDateMap.set(date, round((byDateMap.get(date) || 0) + amount));

    const fEntry = byFlowerMap.get(flowerName) || { qty: 0, amount: 0 };
    fEntry.qty = round(fEntry.qty + qty);
    fEntry.amount = round(fEntry.amount + amount);
    byFlowerMap.set(flowerName, fEntry);

    return { date, flower: flowerName, supplier: supplierName, qty, quantityAccepted, writtenOff, unitPrice, amount };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.purchaseDetail.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/assistantTools/purchaseDetailPack.js backend/src/__tests__/assistantTools.purchaseDetail.test.js
git commit -m "feat(assistant): surface quantityAccepted + writtenOff in purchase_detail"
```

---

### Task 5: `query_records` purchases allow-list — add the field

**Files:**
- Modify: `backend/src/services/assistantTools/dataQueryPack.js:101-118` (`purchases` entry)

**Interfaces:**
- Consumes: `stockPurchases.quantityAccepted` (Task 1, the Drizzle column).
- Produces: `quantityAccepted` becomes a selectable/filterable field in the `purchases` `query_records` domain, alongside the existing `quantityPurchased`.

- [ ] **Step 1: Add the field to the allow-list**

In `backend/src/services/assistantTools/dataQueryPack.js`, in the `purchases.fields` object (current lines 104-113), add one line after `quantityPurchased`:

```js
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
```

- [ ] **Step 2: Run the existing dataQueryPack test suite to confirm the allow-list still validates**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.dataQueryPack.test.js`
Expected: PASS — no existing test asserts on the exact field list, so this should pass unchanged; if a test does snapshot the field list, update it to include `quantityAccepted`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/assistantTools/dataQueryPack.js
git commit -m "feat(assistant): expose quantityAccepted in query_records purchases domain"
```

---

### Task 6: Lab factory parity

**Files:**
- Modify: `lab/factories/stockPurchase.js`

**Interfaces:**
- Consumes: `stock_purchases.quantity_accepted` column (Task 1).
- Produces: `makeStockPurchase(overrides)` accepts `quantity_accepted` in `overrides`, defaults to `null`.

- [ ] **Step 1: Update the factory**

Replace `lab/factories/stockPurchase.js` in full:

```js
// lab/factories/stockPurchase.js
//
// Synthetic Stock Purchase row — matches backend/src/db/schema.js `stock_purchases` table.
//
// Schema: id, airtable_id, purchase_date (text YYYY-MM-DD NOT NULL), supplier (text NOT NULL),
//         stock_id (uuid FK→stock.id), stock_airtable_id, quantity_purchased (int NOT NULL, =Found),
//         quantity_accepted (int nullable — kept qty after write-off, #492),
//         price_per_unit (numeric 10,4 nullable), notes (text NOT NULL DEFAULT ''),
//         created_at (timestamptz)
//
// Factory-only shaping keys (stripped from output):
//   stockId → maps to stock_id

import { faker } from '@faker-js/faker';

export function makeStockPurchase(overrides = {}) {
  // Extract factory-only shaping keys — never included in the returned row.
  const { stockId, ...columnOverrides } = overrides;

  return {
    id: faker.string.uuid(),
    airtable_id: null,
    purchase_date: columnOverrides.purchase_date ?? '2026-01-01',
    supplier: columnOverrides.supplier ?? '',
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
    stock_airtable_id: null,
    quantity_purchased: columnOverrides.quantity_purchased ?? 0,
    quantity_accepted: columnOverrides.quantity_accepted ?? null,
    price_per_unit: columnOverrides.price_per_unit ?? null,
    notes: columnOverrides.notes ?? '',
    created_at: new Date(),
    // Apply column-level overrides last, excluding factory-only keys already handled.
    ...columnOverrides,
    // Ensure FK column is always correct (shorthand takes priority).
    stock_id: stockId ?? columnOverrides.stock_id ?? null,
  };
}
```

- [ ] **Step 2: Run the factory's own test**

Run: `cd lab && npx vitest run factories/stockPurchase.test.js` (adjust path if the test lives elsewhere — check `lab/factories/stockPurchase.test.js`)
Expected: PASS. If the existing test snapshots the full row shape, update its expected object to include `quantity_accepted: null`.

- [ ] **Step 3: Commit**

```bash
git add lab/factories/stockPurchase.js
git commit -m "chore(lab): add quantity_accepted to stockPurchase factory"
```

---

## Self-Review Notes

- **Spec coverage:** PRD user stories 1-5 map to Tasks 3 (money-basis fix, primary+substitute), 4 (Accepted/written-off visibility in `purchase_detail`), 5 (parity in `query_records`), 1-2 (schema/repo foundation). Story 6 (no historical backfill) is satisfied by design — Task 1's migration adds a nullable column with no backfill step, and Task 4's test explicitly covers the `null`-Accepted legacy-row case.
- **`purchase_spend` (purchasingPack.js):** no task modifies it — confirmed in the PRD's Implementation Decisions that its formula is already correct and self-fixes once Task 3 lands. No test added for it specifically since Task 3's integration test proves the underlying `stock_purchases` row is correct, which is `purchase_spend`'s only input.
- **Type consistency:** `quantityAccepted` (camelCase, repo/service layer) ↔ `quantity_accepted` (snake_case, DB/factory layer) ↔ `'Quantity Accepted'` (wire/PascalCase-with-spaces, matching every other field in `stockPurchasesRepo`'s `toWire`) — consistent with the existing `quantityPurchased`/`quantity_purchased`/`'Quantity Purchased'` triple throughout.
