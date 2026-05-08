# Phase 7 — Stock Orders + Premade Bouquets to Postgres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the last two Airtable-backed domains (Stock Orders + Premade Bouquets) to Postgres, fix five remaining live Airtable bypasses in `stock.js` / `orderService.js` / `stockOrders.js`, and seed E2E fixtures via pglite. After this PR lands, no production code path reads from or writes to Airtable. PR 2 (separate plan) will then delete `airtable.js`, `airtableSchema.js`, `config/airtable.js`, the `airtable` npm dep, and the dead `STOCK_BACKEND` / `ORDER_BACKEND` flag logic.

**Architecture:** Two new repos (`stockOrderRepo`, `premadeBouquetRepo`) sit at the persistence boundary. Routes call the repos with Airtable-shaped wire format; repos translate to/from snake_case PG columns. Both repos accept either Airtable `recXXX` IDs or PG UUIDs in `getById` / `updateLine` etc. (dual-lookup) so in-flight POs survive the cutover deploy. `nextPoSequence(date)` computes PO numbers from `MAX(N)+1` of existing `PO-YYYYMMDD-N` values. New stock-purchase markers embed the human-readable PO number (`PO #PO-20260508-1 L#<uuid> primary`); the regex in the usage trace handles both old `recXXX` and new formats. Substitution-detection extracts to `orderService.findOrdersNeedingSubstitution()` and uses `orderRepo` / `customerRepo`.

**Tech Stack:** Node.js + Express, Drizzle ORM, Postgres (pglite for tests), Vitest, Playwright (E2E harness already in place).

**Decisions locked during grill-with-docs (2026-05-08):**
- Direct cutover with backfill (no shadow window)
- Backfill captures all POs (Complete + Cancelled included)
- Dual-lookup pattern for both repos
- PG columns use `substitute_*` (CONTEXT.md domain term); API field names keep `Alt *` for frontend compat
- PO number sequence from `MAX(N)+1` not row count
- New PO markers: `PO #PO-20260508-1 L#<uuid> primary` (see ADR-0003)
- Bypass fixes included: `/velocity`, `/meta/lookups`, pending-po line write, usage trace, premade price-sync (orderService.createOrder + stock.js PATCH)
- pglite SQL fixture replaces airtable-mock seed for PO/premade
- Off-hours deploy + 5-minute coordination window for premade race

---

## Task 1: DB schema + Drizzle definitions

**Files:**
- Create: `backend/src/db/migrations/0011_phase7_stock_orders_premade.sql`
- Modify: `backend/src/db/schema.js` (add 4 table definitions, add `sql` import)

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0011_phase7_stock_orders_premade.sql`:

```sql
CREATE TABLE IF NOT EXISTS stock_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id        TEXT,
  po_number          TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'Draft',
  created_date       TEXT NOT NULL DEFAULT '',
  assigned_driver    TEXT NOT NULL DEFAULT '',
  planned_date       TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  supplier_payments  TEXT NOT NULL DEFAULT '',
  driver_payment     TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_orders_airtable_id_idx
  ON stock_orders (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_orders_po_number_idx
  ON stock_orders (po_number) WHERE po_number <> '';
CREATE INDEX IF NOT EXISTS stock_orders_status_idx        ON stock_orders (status);
CREATE INDEX IF NOT EXISTS stock_orders_created_date_idx  ON stock_orders (created_date);
CREATE INDEX IF NOT EXISTS stock_orders_driver_idx        ON stock_orders (assigned_driver) WHERE assigned_driver <> '';

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS stock_order_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id                 TEXT,
  po_id                       UUID NOT NULL REFERENCES stock_orders(id) ON DELETE CASCADE,
  stock_id                    UUID REFERENCES stock(id),
  stock_airtable_id           TEXT,
  flower_name                 TEXT NOT NULL DEFAULT '',
  quantity_needed             INTEGER NOT NULL DEFAULT 0,
  quantity_found              INTEGER NOT NULL DEFAULT 0,
  lot_size                    INTEGER NOT NULL DEFAULT 0,
  driver_status               TEXT NOT NULL DEFAULT 'Pending',
  supplier                    TEXT NOT NULL DEFAULT '',
  cost_price                  NUMERIC(10,4) NOT NULL DEFAULT 0,
  sell_price                  NUMERIC(10,4) NOT NULL DEFAULT 0,
  farmer                      TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT '',
  substitute_flower_name      TEXT NOT NULL DEFAULT '',
  substitute_status           TEXT NOT NULL DEFAULT '',
  substitute_quantity_found   INTEGER NOT NULL DEFAULT 0,
  substitute_cost             NUMERIC(10,4) NOT NULL DEFAULT 0,
  substitute_supplier         TEXT NOT NULL DEFAULT '',
  quantity_accepted           INTEGER NOT NULL DEFAULT 0,
  write_off_qty               INTEGER NOT NULL DEFAULT 0,
  eval_status                 TEXT NOT NULL DEFAULT '',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_order_lines_airtable_id_idx
  ON stock_order_lines (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_order_lines_po_id_idx    ON stock_order_lines (po_id);
CREATE INDEX IF NOT EXISTS stock_order_lines_stock_id_idx ON stock_order_lines (stock_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS premade_bouquets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     TEXT,
  name            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  price_override  NUMERIC(10,2),
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS premade_bouquets_airtable_id_idx
  ON premade_bouquets (airtable_id) WHERE airtable_id IS NOT NULL;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS premade_bouquet_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id           TEXT,
  bouquet_id            UUID NOT NULL REFERENCES premade_bouquets(id) ON DELETE CASCADE,
  stock_id              UUID REFERENCES stock(id),
  stock_airtable_id     TEXT,
  flower_name           TEXT NOT NULL DEFAULT '',
  quantity              INTEGER NOT NULL DEFAULT 0,
  cost_price_per_unit   NUMERIC(10,4) NOT NULL DEFAULT 0,
  sell_price_per_unit   NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS premade_bouquet_lines_airtable_id_idx
  ON premade_bouquet_lines (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS premade_bouquet_lines_bouquet_id_idx ON premade_bouquet_lines (bouquet_id);
CREATE INDEX IF NOT EXISTS premade_bouquet_lines_stock_id_idx   ON premade_bouquet_lines (stock_id);
```

- [ ] **Step 2: Add Drizzle table definitions**

In `backend/src/db/schema.js`:

Update the second import line to include `sql`:
```javascript
import { isNotNull, and, sql } from 'drizzle-orm';
```

Append to the end of the file (after the `productConfig` table definition):

```javascript
// ── Phase 7: Stock Orders ──
export const stockOrders = pgTable('stock_orders', {
  id:                uuid('id').primaryKey().defaultRandom(),
  airtableId:        text('airtable_id'),
  poNumber:          text('po_number').notNull().default(''),
  status:            text('status').notNull().default('Draft'),
  createdDate:       text('created_date').notNull().default(''),
  assignedDriver:    text('assigned_driver').notNull().default(''),
  plannedDate:       text('planned_date'),
  notes:             text('notes').notNull().default(''),
  supplierPayments:  text('supplier_payments').notNull().default(''),
  driverPayment:     text('driver_payment').notNull().default(''),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  airtableIdx:    uniqueIndex('stock_orders_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  poNumberIdx:    uniqueIndex('stock_orders_po_number_idx').on(t.poNumber).where(sql`${t.poNumber} <> ''`),
  statusIdx:      index('stock_orders_status_idx').on(t.status),
  createdDateIdx: index('stock_orders_created_date_idx').on(t.createdDate),
  driverIdx:      index('stock_orders_driver_idx').on(t.assignedDriver),
}));

export const stockOrderLines = pgTable('stock_order_lines', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  airtableId:               text('airtable_id'),
  poId:                     uuid('po_id').notNull().references(() => stockOrders.id, { onDelete: 'cascade' }),
  stockId:                  uuid('stock_id').references(() => stock.id),
  stockAirtableId:          text('stock_airtable_id'),
  flowerName:               text('flower_name').notNull().default(''),
  quantityNeeded:           integer('quantity_needed').notNull().default(0),
  quantityFound:            integer('quantity_found').notNull().default(0),
  lotSize:                  integer('lot_size').notNull().default(0),
  driverStatus:             text('driver_status').notNull().default('Pending'),
  supplier:                 text('supplier').notNull().default(''),
  costPrice:                numeric('cost_price', { precision: 10, scale: 4 }).notNull().default('0'),
  sellPrice:                numeric('sell_price', { precision: 10, scale: 4 }).notNull().default('0'),
  farmer:                   text('farmer').notNull().default(''),
  notes:                    text('notes').notNull().default(''),
  substituteFlowerName:     text('substitute_flower_name').notNull().default(''),
  substituteStatus:         text('substitute_status').notNull().default(''),
  substituteQuantityFound:  integer('substitute_quantity_found').notNull().default(0),
  substituteCost:           numeric('substitute_cost', { precision: 10, scale: 4 }).notNull().default('0'),
  substituteSupplier:       text('substitute_supplier').notNull().default(''),
  quantityAccepted:         integer('quantity_accepted').notNull().default(0),
  writeOffQty:              integer('write_off_qty').notNull().default(0),
  evalStatus:               text('eval_status').notNull().default(''),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  airtableIdx: uniqueIndex('stock_order_lines_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  poIdx:       index('stock_order_lines_po_id_idx').on(t.poId),
  stockIdx:    index('stock_order_lines_stock_id_idx').on(t.stockId),
}));

// ── Phase 7: Premade Bouquets ──
export const premadeBouquets = pgTable('premade_bouquets', {
  id:             uuid('id').primaryKey().defaultRandom(),
  airtableId:     text('airtable_id'),
  name:           text('name').notNull().default(''),
  createdBy:      text('created_by').notNull().default(''),
  priceOverride:  numeric('price_override', { precision: 10, scale: 2 }),
  notes:          text('notes').notNull().default(''),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  airtableIdx: uniqueIndex('premade_bouquets_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
}));

export const premadeBouquetLines = pgTable('premade_bouquet_lines', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  airtableId:          text('airtable_id'),
  bouquetId:           uuid('bouquet_id').notNull().references(() => premadeBouquets.id, { onDelete: 'cascade' }),
  stockId:             uuid('stock_id').references(() => stock.id),
  stockAirtableId:     text('stock_airtable_id'),
  flowerName:          text('flower_name').notNull().default(''),
  quantity:            integer('quantity').notNull().default(0),
  costPricePerUnit:    numeric('cost_price_per_unit', { precision: 10, scale: 4 }).notNull().default('0'),
  sellPricePerUnit:    numeric('sell_price_per_unit', { precision: 10, scale: 4 }).notNull().default('0'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  airtableIdx: uniqueIndex('premade_bouquet_lines_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  bouquetIdx:  index('premade_bouquet_lines_bouquet_id_idx').on(t.bouquetId),
  stockIdx:    index('premade_bouquet_lines_stock_id_idx').on(t.stockId),
}));
```

- [ ] **Step 3: Verify migration applies cleanly via pglite**

Run: `cd backend && npx vitest run src/__tests__/helpers/pgHarness.smoke.test.js`

Expected: PASS. The harness applies all migrations including `0011`. If `pgHarness.smoke.test.js` doesn't exist or doesn't cover Phase 7 tables, that's fine — the next task adds repo integration tests that exercise these tables.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0011_phase7_stock_orders_premade.sql backend/src/db/schema.js
git commit -m "$(cat <<'EOF'
feat(db): Phase 7 schema — stock_orders, stock_order_lines, premade_bouquets, premade_bouquet_lines

- 4 new tables with airtable_id columns (unique partial indexes) for backfill cross-reference
- substitute_* columns on stock_order_lines (CONTEXT.md term; API surface keeps "Alt *")
- po_number unique partial index supports MAX(N)+1 sequence generation
- ON DELETE CASCADE on lines (matches Airtable linked-record semantics)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: stockOrderRepo — header CRUD + dual-lookup + nextPoSequence

**Files:**
- Create: `backend/src/repos/stockOrderRepo.js`

- [ ] **Step 1: Write the repo with header CRUD**

Create `backend/src/repos/stockOrderRepo.js`:

```javascript
// Stock Order repository — persistence boundary for Stock Orders + their lines.
// Phase 7 of the SQL migration. Postgres-only — no shadow window, direct cutover.
//
// Wire format: routes/services pass Airtable-shaped fields ({ Status, 'Stock Order ID', ... })
// and receive the same shape back. The repo translates to/from snake_case PG columns.
//
// id semantics: returned `id` is `airtableId || uuid` so callers carrying recXXX
// IDs from before the cutover keep working. `_pgId` carries the UUID for new
// callers that want it. getById() / updateLine() / deleteLineById() all accept
// either form and disambiguate by the 'rec' prefix.

import { db } from '../db/index.js';
import { stockOrders, stockOrderLines } from '../db/schema.js';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';

// ── Wire ↔ PG mapping ──

export function poToWire(row) {
  if (!row) return null;
  return {
    id:                  row.airtableId || row.id,
    _pgId:               row.id,
    Status:              row.status,
    'Stock Order ID':    row.poNumber,
    'Created Date':      row.createdDate,
    'Assigned Driver':   row.assignedDriver,
    'Planned Date':      row.plannedDate || null,
    Notes:               row.notes,
    'Supplier Payments': row.supplierPayments,
    'Driver Payment':    row.driverPayment,
    'Order Lines':       [],
  };
}

function poToPg(fields) {
  const out = {};
  if ('Status' in fields)            out.status           = fields.Status || 'Draft';
  if ('Stock Order ID' in fields)    out.poNumber         = fields['Stock Order ID'] || '';
  if ('Created Date' in fields)      out.createdDate      = fields['Created Date'] || '';
  if ('Assigned Driver' in fields)   out.assignedDriver   = fields['Assigned Driver'] || '';
  if ('Planned Date' in fields)      out.plannedDate      = fields['Planned Date'] || null;
  if ('Notes' in fields)             out.notes            = fields.Notes || '';
  if ('Supplier Payments' in fields) out.supplierPayments = fields['Supplier Payments'] || '';
  if ('Driver Payment' in fields)    out.driverPayment    = fields['Driver Payment'] || '';
  return out;
}

async function findPgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(stockOrders.airtableId, id) : eq(stockOrders.id, id);
  const [row] = await db.select().from(stockOrders).where(where).limit(1);
  return row ?? null;
}

// ── Header CRUD ──

export async function list({ status, role, driverName } = {}) {
  if (!db) throw new Error('stockOrderRepo.list: no DATABASE_URL configured');
  const filters = [];
  if (status) filters.push(eq(stockOrders.status, status));
  if (role === 'driver' && driverName) {
    filters.push(eq(stockOrders.assignedDriver, driverName));
  }
  const rows = await db.select().from(stockOrders)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(stockOrders.createdAt));
  return rows.map(poToWire);
}

// Bulk fetch by airtableId or uuid — accepts mixed arrays.
export async function listByIds(ids) {
  if (!ids?.length || !db) return [];
  const recs = ids.filter(x => typeof x === 'string' && x.startsWith('rec'));
  const uuids = ids.filter(x => typeof x === 'string' && !x.startsWith('rec'));
  const orParts = [];
  if (recs.length)  orParts.push(inArray(stockOrders.airtableId, recs));
  if (uuids.length) orParts.push(inArray(stockOrders.id, uuids));
  if (!orParts.length) return [];
  const where = orParts.length === 1 ? orParts[0] : sql`(${orParts[0]} OR ${orParts[1]})`;
  const rows = await db.select().from(stockOrders).where(where);
  return rows.map(poToWire);
}

export async function getById(id) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return poToWire(row);
}

export async function create(fields) {
  if (!db) throw new Error('stockOrderRepo.create: no DATABASE_URL configured');
  const values = poToPg(fields);
  if (!values.createdDate) values.createdDate = new Date().toISOString().split('T')[0];
  const [row] = await db.insert(stockOrders).values(values).returning();
  return poToWire(row);
}

export async function update(id, fields) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = poToPg(fields);
  if (Object.keys(patch).length === 0) return poToWire(row);
  const [updated] = await db.update(stockOrders).set(patch)
    .where(eq(stockOrders.id, row.id)).returning();
  return poToWire(updated);
}

export async function deleteById(id) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(stockOrders).where(eq(stockOrders.id, row.id));
  // ON DELETE CASCADE handles stock_order_lines.
}

// PO number sequence: MAX(N)+1 of existing PO-YYYYMMDD-N values for the date.
// MAX-based (not COUNT-based) so backfilled historical POs that share today's
// date don't corrupt the sequence for newly created POs.
export async function nextPoSequence(date /* YYYY-MM-DD */) {
  if (!db) throw new Error('stockOrderRepo.nextPoSequence: no DATABASE_URL configured');
  const prefix = `PO-${date.replace(/-/g, '')}-`;
  const rows = await db.select({ poNumber: stockOrders.poNumber })
    .from(stockOrders)
    .where(sql`${stockOrders.poNumber} LIKE ${prefix + '%'}`);
  let maxN = 0;
  for (const r of rows) {
    const tail = r.poNumber.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n > maxN) maxN = n;
  }
  return maxN + 1;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/repos/stockOrderRepo.js
git commit -m "$(cat <<'EOF'
feat(repos): stockOrderRepo header CRUD with dual-lookup and nextPoSequence

- Wire format mirrors Airtable shape — routes unchanged
- getById/update/deleteById accept recXXX or uuid (dual-lookup pattern matches stockRepo/orderRepo)
- nextPoSequence(date) returns MAX(N)+1 of PO-YYYYMMDD-N values, not COUNT —
  survives backfill gaps where historical POs share today's date

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: stockOrderRepo — line CRUD

**Files:**
- Modify: `backend/src/repos/stockOrderRepo.js` (append line functions)

- [ ] **Step 1: Append line CRUD to stockOrderRepo.js**

Append to the end of `backend/src/repos/stockOrderRepo.js`:

```javascript
// ── Line CRUD ──

export function lineToWire(row) {
  if (!row) return null;
  return {
    id:                    row.airtableId || row.id,
    _pgId:                 row.id,
    'Stock Orders':        [row.poId],
    'Stock Item':          row.stockAirtableId
                              ? [row.stockAirtableId]
                              : row.stockId ? [row.stockId] : [],
    'Flower Name':         row.flowerName,
    'Quantity Needed':     row.quantityNeeded,
    'Quantity Found':      row.quantityFound,
    'Lot Size':            row.lotSize,
    'Driver Status':       row.driverStatus,
    Supplier:              row.supplier,
    'Cost Price':          Number(row.costPrice),
    'Sell Price':          Number(row.sellPrice),
    Farmer:                row.farmer,
    Notes:                 row.notes,
    'Alt Flower Name':     row.substituteFlowerName,
    'Alt Flower Status':   row.substituteStatus,
    'Alt Quantity Found':  row.substituteQuantityFound,
    'Alt Cost':            Number(row.substituteCost),
    'Alt Supplier':        row.substituteSupplier,
    'Quantity Accepted':   row.quantityAccepted,
    'Write Off Qty':       row.writeOffQty,
    'Eval Status':         row.evalStatus,
  };
}

function lineToPg(fields) {
  const out = {};
  if ('Flower Name' in fields)         out.flowerName               = fields['Flower Name'] || '';
  if ('Quantity Needed' in fields)     out.quantityNeeded           = Number(fields['Quantity Needed']) || 0;
  if ('Quantity Found' in fields)      out.quantityFound            = Number(fields['Quantity Found']) || 0;
  if ('Lot Size' in fields)            out.lotSize                  = Number(fields['Lot Size']) || 0;
  if ('Driver Status' in fields)       out.driverStatus             = fields['Driver Status'] || 'Pending';
  if ('Supplier' in fields)            out.supplier                 = fields.Supplier || '';
  if ('Cost Price' in fields)          out.costPrice                = String(Number(fields['Cost Price']) || 0);
  if ('Sell Price' in fields)          out.sellPrice                = String(Number(fields['Sell Price']) || 0);
  if ('Farmer' in fields)              out.farmer                   = fields.Farmer || '';
  if ('Notes' in fields)               out.notes                    = fields.Notes || '';
  if ('Alt Flower Name' in fields)     out.substituteFlowerName     = fields['Alt Flower Name'] || '';
  if ('Alt Flower Status' in fields)   out.substituteStatus         = fields['Alt Flower Status'] || '';
  if ('Alt Quantity Found' in fields)  out.substituteQuantityFound  = Number(fields['Alt Quantity Found']) || 0;
  if ('Alt Cost' in fields)            out.substituteCost           = String(Number(fields['Alt Cost']) || 0);
  if ('Alt Supplier' in fields)        out.substituteSupplier       = fields['Alt Supplier'] || '';
  if ('Quantity Accepted' in fields)   out.quantityAccepted         = Number(fields['Quantity Accepted']) || 0;
  if ('Write Off Qty' in fields)       out.writeOffQty              = Number(fields['Write Off Qty']) || 0;
  if ('Eval Status' in fields)         out.evalStatus               = fields['Eval Status'] || '';
  if ('Stock Item' in fields) {
    const raw = Array.isArray(fields['Stock Item']) ? fields['Stock Item'][0] : null;
    out.stockId = null;
    out.stockAirtableId = null;
    if (raw) {
      if (raw.startsWith('rec')) out.stockAirtableId = raw;
      else                       out.stockId         = raw;
    }
  }
  return out;
}

async function findLinePgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(stockOrderLines.airtableId, id) : eq(stockOrderLines.id, id);
  const [row] = await db.select().from(stockOrderLines).where(where).limit(1);
  return row ?? null;
}

export async function createLine(fields) {
  if (!db) throw new Error('stockOrderRepo.createLine: no DATABASE_URL configured');
  const poRef = Array.isArray(fields['Stock Orders']) ? fields['Stock Orders'][0] : null;
  if (!poRef) throw new Error('createLine: missing Stock Orders link');
  const po = await findPgByAirtableOrUuid(poRef);
  if (!po) throw new Error(`createLine: PO ${poRef} not found`);
  const values = { poId: po.id, ...lineToPg(fields) };
  const [row] = await db.insert(stockOrderLines).values(values).returning();
  return lineToWire(row);
}

export async function getLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order Line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return lineToWire(row);
}

export async function getLinesByPoId(poId) {
  if (!db) return [];
  const isAtId = typeof poId === 'string' && poId.startsWith('rec');
  let pgPoId = poId;
  if (isAtId) {
    const po = await findPgByAirtableOrUuid(poId);
    pgPoId = po?.id;
    if (!pgPoId) return [];
  }
  const rows = await db.select().from(stockOrderLines)
    .where(eq(stockOrderLines.poId, pgPoId))
    .orderBy(asc(stockOrderLines.createdAt));
  return rows.map(lineToWire);
}

// Bulk fetch lines across multiple POs — for /stock-orders?include=lines
// and /pending-po. Returns lines grouped under each PO id.
export async function getLinesForPos(poIds) {
  if (!poIds?.length || !db) return new Map();
  const recs = poIds.filter(x => typeof x === 'string' && x.startsWith('rec'));
  const uuids = poIds.filter(x => typeof x === 'string' && !x.startsWith('rec'));

  // Resolve recXXX → uuid
  let pgIds = [...uuids];
  if (recs.length) {
    const resolved = await db.select({ id: stockOrders.id, airtableId: stockOrders.airtableId })
      .from(stockOrders).where(inArray(stockOrders.airtableId, recs));
    pgIds.push(...resolved.map(r => r.id));
  }
  if (!pgIds.length) return new Map();

  const rows = await db.select().from(stockOrderLines)
    .where(inArray(stockOrderLines.poId, pgIds))
    .orderBy(asc(stockOrderLines.createdAt));

  const byPo = new Map();
  for (const r of rows) {
    if (!byPo.has(r.poId)) byPo.set(r.poId, []);
    byPo.get(r.poId).push(lineToWire(r));
  }
  return byPo;
}

export async function updateLine(id, fields) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order Line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = lineToPg(fields);
  if (Object.keys(patch).length === 0) return lineToWire(row);
  const [updated] = await db.update(stockOrderLines).set(patch)
    .where(eq(stockOrderLines.id, row.id)).returning();
  return lineToWire(updated);
}

export async function deleteLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(stockOrderLines).where(eq(stockOrderLines.id, row.id));
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/repos/stockOrderRepo.js
git commit -m "$(cat <<'EOF'
feat(repos): stockOrderRepo line CRUD + bulk getLinesForPos

- Stock Item link accepts recXXX or uuid; stored in stock_airtable_id or stock_id respectively
- Wire format keeps "Alt *" field names (Airtable convention) over PG substitute_* columns
- getLinesForPos batches by parent PO id — replaces N+1 Airtable formula lookups

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: premadeBouquetRepo

**Files:**
- Create: `backend/src/repos/premadeBouquetRepo.js`

- [ ] **Step 1: Write the repo**

Create `backend/src/repos/premadeBouquetRepo.js`:

```javascript
// Premade Bouquet repository — persistence boundary for Premade Bouquets + their lines.
// Phase 7. Postgres-only. Same dual-lookup + wire-format pattern as stockOrderRepo.

import { db } from '../db/index.js';
import { premadeBouquets, premadeBouquetLines } from '../db/schema.js';
import { eq, asc, desc, inArray } from 'drizzle-orm';

// ── Wire ↔ PG ──

export function bouquetToWire(row) {
  if (!row) return null;
  return {
    id:               row.airtableId || row.id,
    _pgId:            row.id,
    Name:             row.name,
    'Created By':     row.createdBy,
    'Price Override': row.priceOverride != null ? Number(row.priceOverride) : null,
    Notes:            row.notes,
    'Created At':     row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    Lines:            [],
  };
}

function bouquetToPg(fields) {
  const out = {};
  if ('Name' in fields)            out.name          = (fields.Name || '').trim();
  if ('Created By' in fields)      out.createdBy     = fields['Created By'] || '';
  if ('Price Override' in fields)  out.priceOverride = fields['Price Override'] != null ? String(fields['Price Override']) : null;
  if ('Notes' in fields)           out.notes         = fields.Notes || '';
  return out;
}

export function lineToWire(row) {
  if (!row) return null;
  return {
    id:                    row.airtableId || row.id,
    _pgId:                 row.id,
    'Premade Bouquets':    [row.bouquetId],
    'Stock Item':          row.stockAirtableId
                              ? [row.stockAirtableId]
                              : row.stockId ? [row.stockId] : [],
    'Flower Name':         row.flowerName,
    Quantity:              row.quantity,
    'Cost Price Per Unit': Number(row.costPricePerUnit),
    'Sell Price Per Unit': Number(row.sellPricePerUnit),
  };
}

function lineToPg(fields) {
  const out = {};
  if ('Flower Name' in fields)         out.flowerName        = fields['Flower Name'] || '';
  if ('Quantity' in fields)            out.quantity          = Number(fields.Quantity) || 0;
  if ('Cost Price Per Unit' in fields) out.costPricePerUnit  = String(Number(fields['Cost Price Per Unit']) || 0);
  if ('Sell Price Per Unit' in fields) out.sellPricePerUnit  = String(Number(fields['Sell Price Per Unit']) || 0);
  if ('Stock Item' in fields) {
    const raw = Array.isArray(fields['Stock Item']) ? fields['Stock Item'][0] : null;
    out.stockId = null;
    out.stockAirtableId = null;
    if (raw) {
      if (raw.startsWith('rec')) out.stockAirtableId = raw;
      else                       out.stockId         = raw;
    }
  }
  return out;
}

async function findBouquetPgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(premadeBouquets.airtableId, id) : eq(premadeBouquets.id, id);
  const [row] = await db.select().from(premadeBouquets).where(where).limit(1);
  return row ?? null;
}

async function findLinePgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(premadeBouquetLines.airtableId, id) : eq(premadeBouquetLines.id, id);
  const [row] = await db.select().from(premadeBouquetLines).where(where).limit(1);
  return row ?? null;
}

// ── Bouquet CRUD ──

export async function list() {
  if (!db) return [];
  const rows = await db.select().from(premadeBouquets).orderBy(desc(premadeBouquets.createdAt));
  return rows.map(bouquetToWire);
}

export async function getById(id) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return bouquetToWire(row);
}

export async function create(fields) {
  if (!db) throw new Error('premadeBouquetRepo.create: no DATABASE_URL configured');
  const values = bouquetToPg(fields);
  if (!values.name) throw new Error('premadeBouquetRepo.create: name required');
  const [row] = await db.insert(premadeBouquets).values(values).returning();
  return bouquetToWire(row);
}

export async function update(id, fields) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = bouquetToPg(fields);
  if (Object.keys(patch).length === 0) return bouquetToWire(row);
  const [updated] = await db.update(premadeBouquets).set(patch)
    .where(eq(premadeBouquets.id, row.id)).returning();
  return bouquetToWire(updated);
}

export async function deleteById(id) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(premadeBouquets).where(eq(premadeBouquets.id, row.id));
  // CASCADE deletes lines.
}

// ── Line CRUD ──

export async function createLine(fields) {
  if (!db) throw new Error('premadeBouquetRepo.createLine: no DATABASE_URL configured');
  const ref = Array.isArray(fields['Premade Bouquets']) ? fields['Premade Bouquets'][0] : null;
  if (!ref) throw new Error('createLine: missing Premade Bouquets link');
  const bouquet = await findBouquetPgByAirtableOrUuid(ref);
  if (!bouquet) throw new Error(`createLine: bouquet ${ref} not found`);
  const values = { bouquetId: bouquet.id, ...lineToPg(fields) };
  const [row] = await db.insert(premadeBouquetLines).values(values).returning();
  return lineToWire(row);
}

export async function getLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return lineToWire(row);
}

export async function getLinesByBouquetId(bouquetId) {
  if (!db) return [];
  const isAtId = typeof bouquetId === 'string' && bouquetId.startsWith('rec');
  let pgId = bouquetId;
  if (isAtId) {
    const b = await findBouquetPgByAirtableOrUuid(bouquetId);
    pgId = b?.id;
    if (!pgId) return [];
  }
  const rows = await db.select().from(premadeBouquetLines)
    .where(eq(premadeBouquetLines.bouquetId, pgId))
    .orderBy(asc(premadeBouquetLines.createdAt));
  return rows.map(lineToWire);
}

// Used by /stock/:id PATCH cascade and orderService.createOrder price-sync.
// Returns all lines whose stock matches the given id (recXXX or uuid).
export async function getLinesByStockId(stockId) {
  if (!stockId || !db) return [];
  const isAtId = typeof stockId === 'string' && stockId.startsWith('rec');
  const rows = await db.select().from(premadeBouquetLines)
    .where(isAtId
      ? eq(premadeBouquetLines.stockAirtableId, stockId)
      : eq(premadeBouquetLines.stockId, stockId));
  return rows.map(lineToWire);
}

export async function updateLine(id, fields) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = lineToPg(fields);
  if (Object.keys(patch).length === 0) return lineToWire(row);
  const [updated] = await db.update(premadeBouquetLines).set(patch)
    .where(eq(premadeBouquetLines.id, row.id)).returning();
  return lineToWire(updated);
}

export async function deleteLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(premadeBouquetLines).where(eq(premadeBouquetLines.id, row.id));
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/repos/premadeBouquetRepo.js
git commit -m "$(cat <<'EOF'
feat(repos): premadeBouquetRepo — bouquet + line CRUD with dual-lookup

- Mirrors stockOrderRepo patterns (wire format, dual-lookup, FK CASCADE)
- getLinesByStockId backs /stock/:id PATCH cascade and orderService premade price-sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: orderRepo + orderService — getLinesForVelocity, getLinesForOrders, findOrdersNeedingSubstitution, premade price-sync fix

**Files:**
- Modify: `backend/src/repos/orderRepo.js` (add 2 functions)
- Modify: `backend/src/services/orderService.js` (extract function + fix premade price-sync)
- Modify: `backend/src/repos/customerRepo.js` (add helper if missing)

- [ ] **Step 1: Add `getLinesForVelocity` and `getLinesForOrders` to orderRepo.js**

Append after the `runParityCheck` export (or anywhere near the bottom of the file) in `backend/src/repos/orderRepo.js`:

```javascript
import { ORDER_STATUS } from '../constants/statuses.js';

// Returns aggregated stock-item line data for non-cancelled orders within
// [dateFrom, dateTo] (YYYY-MM-DD). Used by GET /stock/velocity to compute
// days-of-supply. Postgres-only — replaces a frozen-Airtable read path.
export async function getLinesForVelocity(dateFrom, dateTo) {
  if (!db) throw new Error('orderRepo.getLinesForVelocity: no database configured');
  const rows = await db
    .select({
      stockItemId: orderLines.stockItemId,
      quantity:    orderLines.quantity,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(and(
      isNull(orders.deletedAt),
      isNull(orderLines.deletedAt),
      gte(orders.orderDate, dateFrom),
      lte(orders.orderDate, dateTo),
      sql`${orders.status} != ${ORDER_STATUS.CANCELLED}`,
    ));
  return rows;
}

// Returns line records for a list of order IDs (UUIDs). Used by
// orderService.findOrdersNeedingSubstitution() to detect which orders
// reference an originalStockId after a Substitute is received.
export async function getLinesForOrders(orderIds) {
  if (!orderIds?.length || !db) return [];
  const rows = await db
    .select({
      id:          orderLines.id,
      orderId:     orderLines.orderId,
      stockItemId: orderLines.stockItemId,
      quantity:    orderLines.quantity,
      flowerName:  orderLines.flowerName,
    })
    .from(orderLines)
    .where(and(
      isNull(orderLines.deletedAt),
      inArray(orderLines.orderId, orderIds),
    ));
  return rows;
}
```

If `gte`, `lte`, `inArray`, `isNull`, `sql` are not yet in the orderRepo.js drizzle-orm import line, add them.

- [ ] **Step 2: Verify `customerRepo.findMany` exists**

Run: `grep -n "export async function findMany" backend/src/repos/customerRepo.js`

Expected output: `145:export async function findMany(ids) {` (or similar — confirms findMany is exported).

If missing, add to `backend/src/repos/customerRepo.js`:

```javascript
// Bulk fetch by uuid or airtableId — accepts mixed arrays.
export async function findMany(ids) {
  if (!ids?.length || !db) return [];
  const recs = ids.filter(x => typeof x === 'string' && x.startsWith('rec'));
  const uuids = ids.filter(x => typeof x === 'string' && !x.startsWith('rec'));
  const orParts = [];
  if (recs.length)  orParts.push(inArray(customers.airtableId, recs));
  if (uuids.length) orParts.push(inArray(customers.id, uuids));
  if (!orParts.length) return [];
  const where = orParts.length === 1 ? orParts[0] : sql`(${orParts[0]} OR ${orParts[1]})`;
  const rows = await db.select().from(customers).where(and(isNull(customers.deletedAt), where));
  return rows.map(_pgCustomerToResponse);
}
```

- [ ] **Step 3: Extract `findOrdersNeedingSubstitution` into orderService.js**

In `backend/src/services/orderService.js`, near other exports (e.g. after `editBouquetLines`), add:

```javascript
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
// ORDER_STATUS already imported by orderService.js

/**
 * After a Stock Order evaluation creates Substitutes, find which open orders
 * (delivery date in the future, non-terminal) have lines pointing at the
 * original Stock Item — those orders need owner reconciliation.
 *
 * @param {Array} substitutionsMade - [{ originalStockId, originalFlowerName, substituteStockId, receivedQty }]
 * @returns {Array} - same shape with `affectedOrders: [{ orderId, appOrderId, customerName, requiredBy, qty }]` populated
 */
export async function findOrdersNeedingSubstitution(substitutionsMade) {
  if (!Array.isArray(substitutionsMade) || substitutionsMade.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];
  const openOrders = await orderRepo.list({
    pg: {
      excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
      requiredByFrom:  today,
      limit:           500,
    },
  });

  if (!openOrders.length) {
    return substitutionsMade.map(s => ({ ...s, affectedOrders: [] }));
  }

  // Pull lines for these orders (UUIDs only — _pgId is the canonical FK)
  const orderUuids = openOrders.map(o => o._pgId).filter(Boolean);
  const allLines = await orderRepo.getLinesForOrders(orderUuids);

  // Pull customer names
  const custIds = [...new Set(openOrders.map(o => o.Customer?.[0]).filter(Boolean))];
  const customers = custIds.length ? await customerRepo.findMany(custIds) : [];
  const custByPgId = {};
  for (const c of customers) {
    if (c._pgId) custByPgId[c._pgId] = c;
  }

  const orderInfo = {};
  for (const o of openOrders) {
    const cid = o.Customer?.[0];
    const cust = cid ? custByPgId[cid] : null;
    orderInfo[o._pgId] = {
      appOrderId:   o['App Order ID'] || '',
      customerName: cust?.Name || cust?.Nickname || '',
      requiredBy:   o['Required By'] || null,
    };
  }

  return substitutionsMade.map(sub => {
    const affectedOrders = [];
    for (const line of allLines) {
      // stockItemId on order_lines is text — may hold recXXX or uuid.
      // sub.originalStockId comes from stockOrderRepo.lineToWire which uses
      // stock_airtable_id || stock_id, so the format matches whichever was
      // originally assigned to both sides.
      if (line.stockItemId !== sub.originalStockId) continue;
      const oi = orderInfo[line.orderId];
      if (!oi) continue;
      affectedOrders.push({
        orderId:      line.orderId,
        appOrderId:   oi.appOrderId,
        customerName: oi.customerName,
        requiredBy:   oi.requiredBy,
        qty:          Number(line.quantity || 0),
      });
    }
    return { ...sub, affectedOrders };
  });
}
```

- [ ] **Step 4: Fix the premade price-sync inside `orderService.createOrder`**

Locate lines 254-272 in `backend/src/services/orderService.js` (the section beginning `// Cascade to Premade Bouquet Lines.`). Replace the entire `if (TABLES.PREMADE_BOUQUET_LINES) { ... }` block with:

```javascript
        // Cascade price changes to Premade Bouquet Lines via the repo.
        // Uses getLinesByStockId per affected stock item to avoid a full-table scan.
        try {
          const stockToPatch = new Map(stockUpdates.map(u => [u.stockId, u.patch]));
          for (const [stockId, stockPatch] of stockToPatch) {
            const matchingLines = await premadeBouquetRepo.getLinesByStockId(stockId);
            for (const pbl of matchingLines) {
              const linePatch = {};
              if ('Current Cost Price' in stockPatch) linePatch['Cost Price Per Unit'] = stockPatch['Current Cost Price'];
              if ('Current Sell Price' in stockPatch) linePatch['Sell Price Per Unit'] = stockPatch['Current Sell Price'];
              if (Object.keys(linePatch).length > 0) {
                await premadeBouquetRepo.updateLine(pbl.id, linePatch);
              }
            }
          }
        } catch (err) {
          console.error('[ORDER] premade price-sync cascade failed:', err.message);
        }
```

Add the import at the top of `orderService.js`:

```javascript
import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
```

Remove the now-unused `TABLES.PREMADE_BOUQUET_LINES` reference from the imports at the top — but keep `TABLES` itself imported until Tasks 6–9 finish removing all other references.

- [ ] **Step 5: Run the orderService test suite**

```bash
cd backend && npx vitest run src/__tests__/orderService.test.js
```

Expected: PASS. Existing order-creation tests should be unchanged behaviourally — the price-sync cascade only fires when stock prices change during order creation (rare in test fixtures).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repos/orderRepo.js backend/src/repos/customerRepo.js backend/src/services/orderService.js
git commit -m "$(cat <<'EOF'
feat(orders): extract findOrdersNeedingSubstitution + add velocity/order-line helpers

- orderRepo.getLinesForVelocity(from, to) — aggregated stock_item_id + quantity for date range
- orderRepo.getLinesForOrders(orderIds) — bulk line fetch for substitution detection
- orderService.findOrdersNeedingSubstitution() — extracted from stockOrders.js evaluate flow,
  uses orderRepo + customerRepo (was reading from frozen Airtable since 2026-05-02)
- orderService.createOrder premade price-sync now via premadeBouquetRepo.getLinesByStockId
  (was reading from frozen Airtable since 2026-05-02)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate stockOrders.js — read routes (GET /, GET /:id, /meta/lookups, /pending-po)

**Files:**
- Modify: `backend/src/routes/stockOrders.js` (lines 1–280, plus pending-po section in stock.js delegation note)

- [ ] **Step 1: Replace imports at the top of stockOrders.js**

Lines 8–19 currently:

```javascript
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import { TABLES } from '../config/airtable.js';
```

Replace with:

```javascript
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as orderService from '../services/orderService.js';
import { broadcast } from '../services/notifications.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { PO_STATUS, VALID_PO_STATUSES, PO_LINE_STATUS, LOSS_REASON, ORDER_STATUS } from '../constants/statuses.js';
import { getConfig, getDriverOfDay } from '../services/configService.js';
```

(`db`, `TABLES`, `listByIds` no longer needed — all calls go through repos.)

- [ ] **Step 2: Rewrite `resolveOrCreateStockItem` helper**

Lines 30–55 currently call `stockRepo.list` then `stockRepo.create`. The function signature stays the same; replace the body with:

```javascript
async function resolveOrCreateStockItem(flowerName, { costPrice = 0, sellPrice = 0, supplier = '' } = {}) {
  const name = flowerName.trim();
  const matches = await stockRepo.list({
    maxRecords: 1,
    pg: { displayName: name, active: true, includeEmpty: true },
  });
  if (matches.length > 0) {
    return matches[0].id.startsWith('rec') ? matches[0].id : matches[0]._pgId || matches[0].id;
  }
  const newItem = await stockRepo.create({
    'Display Name':       name,
    'Purchase Name':      name,
    'Current Quantity':   0,
    'Current Cost Price': Number(costPrice) || 0,
    'Current Sell Price': Number(sellPrice) || 0,
    Supplier:             supplier || '',
    Category:             'Other',
    Active:               true,
  });
  console.log(`[STOCK-ORDER] Auto-created stock item "${name}" (${newItem.id}) from PO line`);
  return newItem.id.startsWith('rec') ? newItem.id : newItem._pgId || newItem.id;
}
```

(After Phase 7, all auto-created stock items are PG-only — there is no recXXX. But the function returns whatever ID format stockRepo provides for downstream `lineToPg` handling.)

- [ ] **Step 3: Rewrite `GET /meta/lookups`**

Lines 79–96. Replace `db.list(TABLES.STOCK, ...)` with `stockRepo.list(...)`:

```javascript
router.get('/meta/lookups', authorize('stock-orders'), async (req, res, next) => {
  try {
    const items = await stockRepo.list({
      pg: { active: true, includeEmpty: true },
    });
    const flowers = items.map(s => ({
      id:       s.id,
      name:     s['Display Name'] || '',
      supplier: s.Supplier || '',
      cost:     Number(s['Current Cost Price']) || 0,
    })).filter(f => f.name);
    const suppliers = getConfig('suppliers') || [];
    res.json({ flowers, suppliers });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Rewrite `GET /` (list POs)**

Lines 100–154. Replace with:

```javascript
router.get('/', authorize('stock-orders'), async (req, res, next) => {
  try {
    const { status, include } = req.query;
    if (status && !VALID_PO_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    const orders = await stockOrderRepo.list({
      status: status || undefined,
      role:   req.role,
      driverName: req.driverName,
    });

    if (include === 'lines' && orders.length > 0) {
      const poIds = orders.map(o => o._pgId).filter(Boolean);
      const linesByPo = await stockOrderRepo.getLinesForPos(poIds);
      const result = orders.map(o => ({
        ...o,
        lines: linesByPo.get(o._pgId) || [],
        'Order Lines': (linesByPo.get(o._pgId) || []).map(l => l.id),
      }));
      return res.json(result);
    }

    res.json(orders);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Rewrite `GET /:id`**

Lines 157–179. Replace with:

```javascript
router.get('/:id', authorize('stock-orders'), async (req, res, next) => {
  try {
    const order = await stockOrderRepo.getById(req.params.id);
    if (req.role === 'driver' && req.driverName && order['Assigned Driver'] !== req.driverName) {
      return res.status(404).json({ error: 'PO not found.' });
    }
    const lines = await stockOrderRepo.getLinesByPoId(order._pgId);
    res.json({ ...order, lines, 'Order Lines': lines.map(l => l.id) });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run unit tests for stockOrders to confirm read paths still parse**

```bash
cd backend && npx vitest run src/__tests__/ -t "stock-orders" 2>&1 | head -30
```

Some tests may fail — that's expected. The full test pass happens after Tasks 7–9 finish all writes too. Right now we're checking that the file at minimum still imports and parses.

Verify with: `node --check backend/src/routes/stockOrders.js` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/stockOrders.js
git commit -m "$(cat <<'EOF'
refactor(stockOrders): migrate read routes to stockOrderRepo

- Imports rewritten — drop airtable.js, add stockOrderRepo + orderService
- GET /, GET /:id, GET /meta/lookups, resolveOrCreateStockItem helper all via PG repos
- /meta/lookups stock list now hits PG (was reading frozen Airtable since 2026-05-02)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate stockOrders.js — write routes (POST /, PATCH /:id, line CRUD, DELETE)

**Files:**
- Modify: `backend/src/routes/stockOrders.js` (lines ~180–470)

- [ ] **Step 1: Rewrite `POST /` (create PO)**

Replace the existing `POST /` route (~lines 183–263) with:

```javascript
router.post('/', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const { notes, lines, driver, plannedDate } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'PO must include at least one line.' });
    }
    if (lines.every(l => (Number(l.quantity) || 0) <= 0)) {
      return res.status(400).json({ error: 'At least one line must have quantity > 0.' });
    }

    const today = new Date().toISOString().split('T')[0];
    const seq = await stockOrderRepo.nextPoSequence(today);
    const poNumber = `PO-${today.replace(/-/g, '')}-${seq}`;

    const order = await stockOrderRepo.create({
      Status:           PO_STATUS.DRAFT,
      'Created Date':   today,
      'Stock Order ID': poNumber,
      Notes:            notes || '',
      ...(driver       ? { 'Assigned Driver': driver } : {}),
      ...(plannedDate  ? { 'Planned Date': plannedDate } : {}),
    });

    const createdLines = [];
    for (const line of lines || []) {
      let resolvedStockItemId = line.stockItemId || null;
      if (!resolvedStockItemId && line.flowerName) {
        try {
          resolvedStockItemId = await resolveOrCreateStockItem(line.flowerName, {
            costPrice: line.costPrice, sellPrice: line.sellPrice, supplier: line.supplier,
          });
        } catch (err) {
          console.error(`[STOCK-ORDER] Auto-link/create failed for "${line.flowerName}":`, err.message);
        }
      }
      let lotSize = Number(line.lotSize) || 0;
      if (!lotSize && resolvedStockItemId) {
        try {
          const stockItem = await stockRepo.getById(resolvedStockItemId);
          lotSize = Number(stockItem['Lot Size']) || 0;
        } catch { /* stock item may have been deleted */ }
      }
      const lineFields = {
        'Stock Orders':    [order._pgId],
        ...(resolvedStockItemId ? { 'Stock Item': [resolvedStockItemId] } : {}),
        'Flower Name':     line.flowerName || '',
        'Quantity Needed': Number(line.quantity) || 0,
        ...(lotSize > 0 ? { 'Lot Size': lotSize } : {}),
        'Driver Status':   PO_LINE_STATUS.PENDING,
        Supplier:          line.supplier || '',
        'Cost Price':      Number(line.costPrice) || 0,
        'Sell Price':      Number(line.sellPrice) || 0,
      };
      if (line.farmer) lineFields.Farmer = line.farmer;
      if (line.notes)  lineFields.Notes = line.notes;

      const lineRec = await stockOrderRepo.createLine(lineFields);
      createdLines.push(lineRec);
    }

    res.status(201).json({ ...order, lines: createdLines });
  } catch (err) {
    console.error('[STOCK-ORDER] PO creation failed:', err.message, err.statusCode);
    next(err);
  }
});
```

- [ ] **Step 2: Rewrite `PATCH /:id` (update PO header)**

Replace the existing PATCH (~lines 267–315) with:

```javascript
router.patch('/:id', authorize('stock-orders'), async (req, res, next) => {
  try {
    const isOwner = req.role === 'owner';
    const allowed = isOwner
      ? ['Status', 'Notes', 'Assigned Driver', 'Supplier Payments', 'Driver Payment', 'Planned Date']
      : ['Supplier Payments'];
    const fields = {};
    for (const key of allowed) {
      if (key in req.body) fields[key] = req.body[key];
    }

    if (Object.keys(fields).length === 0) {
      return res.json(await stockOrderRepo.getById(req.params.id));
    }

    if (fields.Status) {
      const current = await stockOrderRepo.getById(req.params.id);
      const valid = ALLOWED_TRANSITIONS[current.Status];
      if (!valid || !valid.includes(fields.Status)) {
        return res.status(400).json({
          error: `Cannot transition from "${current.Status}" to "${fields.Status}".`,
        });
      }
    }

    const updated = await stockOrderRepo.update(req.params.id, fields);

    if ('Assigned Driver' in fields) {
      broadcast({
        type: 'stock_pickup_assigned',
        stockOrderId: req.params.id,
        driverName: fields['Assigned Driver'],
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Rewrite line CRUD routes**

Replace `PATCH /:id/lines/:lineId` (~lines 320–386) with:

```javascript
router.patch('/:id/lines/:lineId', authorize('stock-orders'), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status === PO_STATUS.COMPLETE) {
      return res.status(409).json({
        error: `PO is "${PO_STATUS.COMPLETE}" — closed books. Create an adjustment instead.`,
      });
    }
    if (PO_OWNER_ONLY_STATUSES.includes(po.Status) && req.role !== 'owner') {
      return res.status(403).json({
        error: `PO is "${po.Status}" — only the owner can edit lines at this stage.`,
      });
    }

    const allowed = [
      'Driver Status', 'Quantity Found', 'Alt Supplier', 'Alt Quantity Found',
      'Alt Flower Name', 'Cost Price', 'Sell Price', 'Alt Cost',
      'Quantity Accepted', 'Write Off Qty', 'Notes', 'Quantity Needed',
      'Flower Name', 'Supplier', 'Lot Size', 'Farmer',
    ];
    const fields = {};
    for (const key of allowed) {
      if (key in req.body) fields[key] = req.body[key];
    }
    if (Object.keys(fields).length === 0) {
      return res.json(await stockOrderRepo.getLineById(req.params.lineId));
    }

    if ('Flower Name' in fields && typeof fields['Flower Name'] === 'string' && fields['Flower Name'].length < 2) {
      const existing = await stockOrderRepo.getLineById(req.params.lineId);
      const hasStockItem = !!existing['Stock Item']?.[0];
      const currentName = existing['Flower Name'] || '';
      if (hasStockItem && currentName.length >= 2) {
        delete fields['Flower Name'];
        if (Object.keys(fields).length === 0) return res.json(existing);
      }
    }

    const updated = await stockOrderRepo.updateLine(req.params.lineId, fields);

    if ('Driver Status' in fields && po.Status === PO_STATUS.SENT) {
      await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.SHOPPING });
    }

    broadcast({
      type: 'stock_order_line_updated',
      stockOrderId: req.params.id,
      lineId: req.params.lineId,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});
```

Replace `POST /:id/lines` (~lines 393–435) with:

```javascript
router.post('/:id/lines', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot add lines to a "${po.Status}" PO.` });
    }
    const { stockItemId: rawStockItemId, flowerName, quantity, supplier, costPrice, sellPrice, lotSize } = req.body;
    if (!rawStockItemId && !flowerName?.trim() && po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: 'PO line must have a stock item or flower name.' });
    }
    let resolvedStockItemId = rawStockItemId || null;
    if (!resolvedStockItemId && flowerName) {
      try {
        resolvedStockItemId = await resolveOrCreateStockItem(flowerName, { costPrice, sellPrice, supplier });
      } catch (err) {
        console.error(`[STOCK-ORDER] Auto-link/create failed for "${flowerName}":`, err.message);
      }
    }
    const line = await stockOrderRepo.createLine({
      'Stock Orders':    [po._pgId],
      ...(resolvedStockItemId ? { 'Stock Item': [resolvedStockItemId] } : {}),
      'Flower Name':     flowerName || '',
      'Quantity Needed': Number(quantity) || 0,
      ...(lotSize > 0 ? { 'Lot Size': Number(lotSize) } : {}),
      'Driver Status':   PO_LINE_STATUS.PENDING,
      Supplier:          supplier || '',
      'Cost Price':      Number(costPrice) || 0,
      'Sell Price':      Number(sellPrice) || 0,
    });
    res.status(201).json(line);
  } catch (err) {
    next(err);
  }
});
```

Replace `DELETE /:id` (~lines 440–453) with:

```javascript
router.delete('/:id', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (![PO_STATUS.DRAFT, PO_STATUS.COMPLETE, PO_STATUS.CANCELLED].includes(po.Status)) {
      return res.status(400).json({ error: `Cannot delete a "${po.Status}" PO.` });
    }
    await stockOrderRepo.deleteById(req.params.id);  // CASCADE handles lines
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
```

Replace `DELETE /:id/lines/:lineId` (~lines 458–470) with:

```javascript
router.delete('/:id/lines/:lineId', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot delete lines from a "${po.Status}" PO.` });
    }
    await stockOrderRepo.deleteLineById(req.params.lineId);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Verify the file still parses**

Run: `node --check backend/src/routes/stockOrders.js`

Expected: exit 0 (no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/stockOrders.js
git commit -m "$(cat <<'EOF'
refactor(stockOrders): migrate write routes to stockOrderRepo

- POST / uses nextPoSequence(today) — MAX(N)+1 (was COUNT, would corrupt under backfill)
- PATCH /:id, line CRUD, DELETE all via stockOrderRepo
- Status transition validation unchanged
- Auto-link/create stock-item helper (resolveOrCreateStockItem) routes through stockRepo

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Migrate stockOrders.js — action routes (/send, /driver-complete, /approve-review)

**Files:**
- Modify: `backend/src/routes/stockOrders.js` (lines ~475–550)

- [ ] **Step 1: Rewrite `POST /:id/send`**

Replace (~lines 478–514):

```javascript
router.post('/:id/send', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    const resolvedDriver = req.body.driver || po['Assigned Driver'] || getDriverOfDay();
    if (!resolvedDriver) {
      return res.status(400).json({ error: 'No driver assigned.' });
    }

    if (po.Status === PO_STATUS.DRAFT) {
      const lines = await stockOrderRepo.getLinesByPoId(po._pgId);
      if (lines.length === 0) {
        return res.status(400).json({ error: 'Cannot send an empty PO. Add at least one line first.' });
      }
      const blankCount = lines.filter(l => {
        const hasStockItem = Array.isArray(l['Stock Item']) && l['Stock Item'].length > 0;
        const hasFlowerName = String(l['Flower Name'] || '').trim() !== '';
        return !hasStockItem && !hasFlowerName;
      }).length;
      if (blankCount > 0) {
        return res.status(400).json({
          error: `Fill flower name on ${blankCount} blank line(s) before sending.`,
        });
      }
    }

    const updated = await stockOrderRepo.update(req.params.id, {
      Status: PO_STATUS.SENT,
      'Assigned Driver': resolvedDriver,
    });

    broadcast({ type: 'stock_pickup_assigned', stockOrderId: req.params.id, driverName: resolvedDriver });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Rewrite `/driver-complete` and `/approve-review`**

Replace (~lines 518–550):

```javascript
router.post('/:id/driver-complete', authorize('stock-orders'), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (![PO_STATUS.SENT, PO_STATUS.SHOPPING].includes(po.Status)) {
      return res.status(400).json({ error: `PO is "${po.Status}", cannot complete shopping.` });
    }
    const updated = await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.REVIEWING });
    broadcast({ type: 'stock_review_ready', stockOrderId: req.params.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve-review', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status !== PO_STATUS.REVIEWING) {
      return res.status(400).json({ error: `PO is "${po.Status}", not "${PO_STATUS.REVIEWING}".` });
    }
    const updated = await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.EVALUATING });
    broadcast({ type: 'stock_evaluation_ready', stockOrderId: req.params.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Rewrite the helpers `findOrCreateSubstituteStock` and `receiveIntoStock`**

Locate ~lines 575–684. Both already use `stockRepo` for stock writes. The remaining Airtable call is `db.list(TABLES.STOCK, ...)` inside the auto-resolve fallback — that's already using `stockRepo.list` in the version we wrote in Task 6 (`resolveOrCreateStockItem`). For these two helpers there are NO `db.*` calls remaining; they already use `stockRepo`. **No changes needed** unless we discover a stray `db.*` call during inspection — search and verify:

```bash
grep -n "db\." backend/src/routes/stockOrders.js | grep -v "stockRepo\|stockLossRepo\|stockPurchasesRepo\|stockOrderRepo"
```

Expected output: empty (besides comments). If any line shows up, fix it inline:
- `db.list(TABLES.STOCK, ...)` → `stockRepo.list(...)`
- `db.getById(TABLES.STOCK, id)` → `stockRepo.getById(id)`
- `db.update(TABLES.STOCK, ...)` → `stockRepo.update(...)`
- `db.list(TABLES.STOCK_ORDER_LINES, ...)` → `stockOrderRepo.getLinesByPoId(...)` or similar
- `db.update(TABLES.STOCK_ORDER_LINES, id, ...)` → `stockOrderRepo.updateLine(id, ...)`
- `db.update(TABLES.STOCK_ORDERS, id, ...)` → `stockOrderRepo.update(id, ...)`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/stockOrders.js
git commit -m "$(cat <<'EOF'
refactor(stockOrders): migrate action routes (/send, /driver-complete, /approve-review) to stockOrderRepo

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migrate stockOrders.js — evaluate endpoint + new marker format + extracted substitution detection

**Files:**
- Modify: `backend/src/routes/stockOrders.js` (lines ~686–998)

- [ ] **Step 1: Rewrite the evaluate endpoint**

Replace `POST /:id/evaluate` entirely. The new version uses `stockOrderRepo` for all PO/line reads/writes, embeds the human-readable PO number in stock-purchase markers, and delegates substitution detection to `orderService.findOrdersNeedingSubstitution`:

```javascript
router.post('/:id/evaluate', authorize('stock-orders', ['owner', 'florist']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status !== PO_STATUS.EVALUATING && po.Status !== PO_STATUS.EVAL_ERROR) {
      return res.status(409).json({
        error: `PO is "${po.Status}", not "${PO_STATUS.EVALUATING}". Already processed?`,
      });
    }

    const poDisplayId = po['Stock Order ID'] || po.id;  // human-readable, embed in markers
    const { lines } = req.body;

    let evalDate = new Date().toISOString().split('T')[0];
    if (po.Status === PO_STATUS.EVAL_ERROR) {
      try {
        const prevDate = await stockPurchasesRepo.findDateByPoMarker(poDisplayId);
        if (prevDate) evalDate = prevDate;
      } catch { /* fall back to today */ }
    }

    const lineResults = [];

    for (const evalLine of lines || []) {
      try {
        const line = await stockOrderRepo.getLineById(evalLine.lineId);

        if (line['Eval Status'] === PO_LINE_STATUS.PROCESSED) {
          lineResults.push({ lineId: evalLine.lineId, status: 'skipped' });
          continue;
        }

        let stockItemId = line['Stock Item']?.[0];
        const costPrice = Number(line['Cost Price']) || 0;
        const sellPrice = Number(line['Sell Price']) || 0;
        const supplier = line.Supplier || '';

        const accepted = Number(evalLine.quantityAccepted) || 0;
        const writeOff = Number(evalLine.writeOffQty) || 0;
        const altAcceptedPre = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOffPre = Number(evalLine.altWriteOffQty) || 0;

        // Auto-resolve flower name → stock item via stockRepo when line has none
        if (!stockItemId && (accepted > 0 || writeOff > 0)) {
          const flowerName = String(line['Flower Name'] || '').trim();
          if (!flowerName) {
            throw new Error(`Line "${evalLine.lineId}" has no Stock Item and no Flower Name — cannot resolve.`);
          }
          const matches = await stockRepo.list({
            pg: { displayName: flowerName, active: true, includeEmpty: true },
            maxRecords: 1,
          });
          if (matches.length > 0) {
            stockItemId = matches[0].id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
          } else {
            const markup = Number(getConfig('targetMarkup')) || 1;
            const autoSell = sellPrice || Math.round(costPrice * markup * 100) / 100;
            const created = await stockRepo.create({
              'Display Name':       flowerName,
              'Purchase Name':      flowerName,
              Category:             'Other',
              'Current Quantity':   0,
              'Current Cost Price': costPrice,
              'Current Sell Price': autoSell,
              Supplier:             supplier,
              Unit:                 'Stems',
              Active:               true,
            });
            stockItemId = created.id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
          }
        }

        if (!stockItemId && (altAcceptedPre > 0 || altWriteOffPre > 0) && !line['Alt Flower Name']) {
          throw new Error(
            `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item and no Alt Flower Name — ` +
            `link a Stock Item or add substitute details, then retry.`,
          );
        }

        // Primary receive — idempotency marker uses human-readable PO number (ADR-0003)
        if (stockItemId && accepted > 0) {
          const primaryMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} primary`;
          const already = await purchaseAlreadyRecorded(primaryMarker);
          if (!already) {
            const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, evalDate);
            const batchItem = await stockRepo.getById(finalItemId).catch(() => null);
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier,
              stockId:           batchItem?._pgId || null,
              stockAirtableId:   typeof finalItemId === 'string' && finalItemId.startsWith('rec') ? finalItemId : null,
              quantityPurchased: accepted,
              pricePerUnit:      costPrice,
              notes:             primaryMarker,
            });
          }
        }

        // Substitute receive
        const altAccepted = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOff = Number(evalLine.altWriteOffQty) || 0;
        const altSupplier = line['Alt Supplier'] || '';
        const altFlowerName = line['Alt Flower Name'] || '';
        const altQtyFound = Number(line['Alt Quantity Found']) || 0;
        const altCostTotal = Number(line['Alt Cost']) || 0;
        const altCostPerStem = altQtyFound > 0 ? (altCostTotal / altQtyFound) : 0;

        let substituteStockId = null;
        if (altAccepted > 0 && altFlowerName) {
          const altMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} alt`;
          const alreadyAlt = await purchaseAlreadyRecorded(altMarker);
          if (!alreadyAlt) {
            const originalStockItem = stockItemId
              ? await stockRepo.getById(stockItemId).catch(() => null)
              : null;
            substituteStockId = await findOrCreateSubstituteStock(
              altFlowerName, altSupplier, altCostPerStem, originalStockItem, stockItemId, evalDate,
            );
            const markup = Number(getConfig('targetMarkup')) || 1;
            const altSellPerStem = Math.round(altCostPerStem * markup * 100) / 100;
            const altFinalId = await receiveIntoStock(
              substituteStockId, altAccepted, altCostPerStem, altSellPerStem, altSupplier, evalDate,
            );
            substituteStockId = altFinalId;

            const altBatchItem = await stockRepo.getById(altFinalId).catch(() => null);
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier:          altSupplier,
              stockId:           altBatchItem?._pgId || null,
              stockAirtableId:   typeof altFinalId === 'string' && altFinalId.startsWith('rec') ? altFinalId : null,
              quantityPurchased: altAccepted,
              pricePerUnit:      altCostPerStem,
              notes:             `${altMarker} - substitute for "${line['Flower Name'] || ''}"`,
            });
          }
        }

        // Write-offs (primary + substitute)
        if (stockItemId && writeOff > 0) {
          const reason = evalLine.writeOffReason || LOSS_REASON.DAMAGED;
          stockRepo.getById(stockItemId)
            .then(item => stockLossRepo.create({
              date:     evalDate,
              stockId:  item._pgId || null,
              quantity: writeOff,
              reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(reason) ? reason : LOSS_REASON.OTHER,
              notes:    'PO evaluation write-off (primary)',
            }))
            .catch(err => console.error('[STOCK-ORDER] Failed to log primary write-off:', err.message));
        }
        if (altWriteOff > 0) {
          const altReason = evalLine.altWriteOffReason || LOSS_REASON.DAMAGED;
          const writeOffTarget = substituteStockId || stockItemId;
          if (writeOffTarget) {
            stockRepo.getById(writeOffTarget)
              .then(item => stockLossRepo.create({
                date:     evalDate,
                stockId:  item._pgId || null,
                quantity: altWriteOff,
                reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(altReason) ? altReason : LOSS_REASON.OTHER,
                notes:    'PO evaluation write-off (substitute)',
              }))
              .catch(err => console.error('[STOCK-ORDER] Failed to log alt write-off:', err.message));
          }
        }

        // Mark line processed
        await stockOrderRepo.updateLine(evalLine.lineId, {
          'Quantity Accepted': accepted,
          'Write Off Qty':     writeOff,
          'Eval Status':       PO_LINE_STATUS.PROCESSED,
        });

        lineResults.push({
          lineId:             evalLine.lineId,
          status:             'ok',
          substituteStockId:  substituteStockId || null,
          originalStockId:    stockItemId || null,
          originalFlowerName: line['Flower Name'] || '',
          receivedQty:        altAccepted || 0,
        });
      } catch (lineErr) {
        console.error(`[STOCK-ORDER] Evaluate line ${evalLine.lineId} failed:`, lineErr.message);
        lineResults.push({ lineId: evalLine.lineId, status: 'error', error: lineErr.message });
      }
    }

    const failed = lineResults.filter(r => r.status === 'error');
    if (failed.length > 0) {
      await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.EVAL_ERROR });
      return res.status(207).json({
        success: false,
        message: `${failed.length} of ${lineResults.length} lines failed. PO marked as "Eval Error" — retry will skip already-processed lines.`,
        lineResults,
      });
    }

    await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.COMPLETE });

    // Phase B: Substitute reconciliation — extracted to orderService (was reading frozen Airtable).
    const substitutionsMade = lineResults
      .filter(r => r.status === 'ok' && r.substituteStockId && r.originalStockId)
      .map(r => ({
        originalStockId:    r.originalStockId,
        originalFlowerName: r.originalFlowerName,
        substituteStockId:  r.substituteStockId,
        receivedQty:        r.receivedQty,
      }));

    if (substitutionsMade.length > 0) {
      try {
        const enriched = await orderService.findOrdersNeedingSubstitution(substitutionsMade);
        for (const sub of enriched) {
          if (sub.affectedOrders.length > 0) {
            broadcast({
              type: 'substitute_reconciliation_needed',
              originalStockId:    sub.originalStockId,
              originalFlowerName: sub.originalFlowerName,
              substituteStockId:  sub.substituteStockId,
              affectedOrders:     sub.affectedOrders,
              substituteQty:      sub.receivedQty,
            });
          }
        }
      } catch (reconErr) {
        console.error('[STOCK-ORDER] Reconciliation detection failed (non-blocking):', reconErr.message);
      }
    }

    res.json({ success: true, lineResults });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Update `purchaseAlreadyRecorded` helper signature**

The helper at lines ~555–563 currently takes `(poId, lineId, variant)`. Replace with the simpler form (caller now constructs the marker string):

```javascript
async function purchaseAlreadyRecorded(marker) {
  try {
    return await stockPurchasesRepo.noteMarkerExists(marker);
  } catch (e) {
    console.error('[STOCK-ORDER] Idempotency check failed:', e.message);
    return false;
  }
}
```

- [ ] **Step 3: Verify no Airtable calls remain in stockOrders.js**

```bash
grep -nE "TABLES\.|airtable|db\." backend/src/routes/stockOrders.js | grep -v "//\|stockRepo\|stockLossRepo\|stockPurchasesRepo\|stockOrderRepo"
```

Expected output: empty.

Also: `node --check backend/src/routes/stockOrders.js` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/stockOrders.js
git commit -m "$(cat <<'EOF'
refactor(stockOrders): migrate evaluate endpoint to repos + new marker format

- Stock-purchase notes now embed human-readable PO number (PO #PO-20260508-1 L#<uuid>),
  see ADR-0003. Old recXXX markers in historical rows untouched (degrade gracefully).
- Substitute reconciliation extracted to orderService.findOrdersNeedingSubstitution.
- All PO/line writes route through stockOrderRepo. No Airtable calls remain.
- purchaseAlreadyRecorded simplified to take a precomputed marker string.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Migrate premadeBouquetService.js to premadeBouquetRepo

**Files:**
- Modify: `backend/src/services/premadeBouquetService.js`

- [ ] **Step 1: Rewrite the entire service file**

Replace `backend/src/services/premadeBouquetService.js` with:

```javascript
// Premade bouquet business logic. Phase 7: persistence via premadeBouquetRepo.
//
// A premade bouquet is a composition the florist builds BEFORE any order exists.
// Stock is deducted at creation time. The bouquet can later be:
//   1. Matched to a client — Order created from its lines, premade record deleted.
//   2. Returned to stock — flowers go back to inventory, premade record deleted.

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { broadcast } from './notifications.js';
import { autoMatchStock, createOrder } from './orderService.js';

export async function getPremadeBouquet(id) {
  const bouquet = await premadeBouquetRepo.getById(id);
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  bouquet.lines = lines;
  bouquet.Lines = lines.map(l => l.id);
  bouquet['Computed Sell Total'] = lines.reduce(
    (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
  bouquet['Computed Cost Total'] = lines.reduce(
    (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
  bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
  return bouquet;
}

export async function listPremadeBouquets() {
  const bouquets = await premadeBouquetRepo.list();
  if (bouquets.length === 0) return [];

  // Bulk fetch all lines via individual queries (small N — premades are 0–20 rows in practice)
  for (const bouquet of bouquets) {
    const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
    bouquet.lines = lines;
    bouquet.Lines = lines.map(l => l.id);
    bouquet['Computed Sell Total'] = lines.reduce(
      (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
    bouquet['Computed Cost Total'] = lines.reduce(
      (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
    bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
    bouquet['Bouquet Summary'] = lines
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .join(', ');
  }
  return bouquets;
}

export async function createPremadeBouquet(params) {
  const { name, lines, priceOverride, notes, createdBy } = params;

  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Premade bouquet name is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('Premade bouquet must have at least one flower line.');
    err.statusCode = 400;
    throw err;
  }
  for (let i = 0; i < lines.length; i++) {
    if (typeof lines[i].quantity !== 'number' || lines[i].quantity <= 0) {
      const err = new Error(`lines[${i}].quantity must be a positive number.`);
      err.statusCode = 400;
      throw err;
    }
  }

  let bouquet = null;
  const createdLineIds = [];
  const stockAdjustments = [];

  try {
    bouquet = await premadeBouquetRepo.create({
      Name:             name.trim(),
      'Created By':     createdBy || '',
      'Price Override': priceOverride || null,
      Notes:            notes || '',
    });

    await autoMatchStock(lines);

    const orphans = lines.filter(l => !l.stockItemId);
    if (orphans.length > 0) {
      const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
      const err = new Error(
        `Bouquet line(s) without a Stock Item are not allowed: ${names}. ` +
        `Create the flower in Stock first.`,
      );
      err.statusCode = 400;
      throw err;
    }

    for (const line of lines) {
      const created = await premadeBouquetRepo.createLine({
        'Premade Bouquets':    [bouquet._pgId],
        'Stock Item':          [line.stockItemId],
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLineIds.push(created._pgId);
    }

    for (const line of lines) {
      if (line.stockItemId) {
        await stockRepo.adjustQuantity(line.stockItemId, -line.quantity);
        stockAdjustments.push({ stockId: line.stockItemId, delta: -line.quantity });
      }
    }

    broadcast({ type: 'premade_bouquet_created', bouquetId: bouquet.id, name: bouquet.Name });
    return await getPremadeBouquet(bouquet.id);
  } catch (err) {
    console.error('[PREMADE] Creation failed, rolling back:', err.message);
    const rollbackErrors = [];

    for (const adj of stockAdjustments) {
      try { await stockRepo.adjustQuantity(adj.stockId, -adj.delta); }
      catch (e) { rollbackErrors.push(`stock ${adj.stockId}: ${e.message}`); }
    }
    for (const lineId of createdLineIds) {
      try { await premadeBouquetRepo.deleteLineById(lineId); }
      catch (e) { rollbackErrors.push(`line ${lineId}: ${e.message}`); }
    }
    if (bouquet) {
      try { await premadeBouquetRepo.deleteById(bouquet._pgId); }
      catch (e) { rollbackErrors.push(`bouquet ${bouquet._pgId}: ${e.message}`); }
    }
    if (rollbackErrors.length > 0) console.error('[PREMADE] Rollback errors:', rollbackErrors);
    throw err;
  }
}

export async function updatePremadeBouquet(id, patch) {
  const fields = {};
  if (patch.name !== undefined)          fields.Name             = patch.name;
  if (patch.priceOverride !== undefined) fields['Price Override'] = patch.priceOverride || null;
  if (patch.notes !== undefined)         fields.Notes            = patch.notes;
  await premadeBouquetRepo.update(id, fields);
  return await getPremadeBouquet(id);
}

export async function editPremadeBouquetLines(id, { lines = [], removedLines = [] }) {
  const bouquet = await premadeBouquetRepo.getById(id);

  for (const rem of removedLines) {
    if (rem.stockItemId && rem.quantity > 0) {
      await stockRepo.adjustQuantity(rem.stockItemId, rem.quantity);
    }
    if (rem.lineId) {
      await premadeBouquetRepo.deleteLineById(rem.lineId).catch(err =>
        console.error(`[PREMADE] Failed to delete removed line ${rem.lineId}:`, err.message),
      );
    }
  }

  const newUnmatched = lines.filter(l => !l.id && !l.stockItemId && l.flowerName);
  if (newUnmatched.length > 0) await autoMatchStock(newUnmatched);

  const orphans = lines.filter(l => !l.id && !l.stockItemId);
  if (orphans.length > 0) {
    const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
    const err = new Error(
      `Bouquet line(s) without a Stock Item are not allowed: ${names}. ` +
      `Create the flower in Stock first.`,
    );
    err.statusCode = 400;
    throw err;
  }

  const createdLines = [];
  for (const line of lines) {
    if (line.id) {
      if (line._originalQty != null && line.quantity !== line._originalQty) {
        const delta = line._originalQty - line.quantity;
        if (line.stockItemId && delta !== 0) {
          await stockRepo.adjustQuantity(line.stockItemId, delta);
        }
        await premadeBouquetRepo.updateLine(line.id, { Quantity: line.quantity });
      }
    } else {
      const created = await premadeBouquetRepo.createLine({
        'Premade Bouquets':    [bouquet._pgId],
        ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLines.push(created);
      if (line.stockItemId) {
        await stockRepo.adjustQuantity(line.stockItemId, -line.quantity);
      }
    }
  }

  return { updated: true, createdLines };
}

export async function returnPremadeBouquetToStock(id) {
  const bouquet = await premadeBouquetRepo.getById(id);
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  const returnedItems = [];

  for (const line of lines) {
    const stockId = line['Stock Item']?.[0];
    const qty = Number(line.Quantity || 0);
    if (stockId && qty > 0) {
      try {
        const { newQty } = await stockRepo.adjustQuantity(stockId, qty);
        returnedItems.push({
          stockId,
          flowerName:       line['Flower Name'] || '?',
          quantityReturned: qty,
          newStockQty:      newQty,
        });
      } catch (err) {
        if (err.statusCode === 404) {
          console.warn(`[PREMADE] Stock item ${stockId} not found during return — skipping quantity restore for "${line['Flower Name'] || '?'}"`);
        } else {
          throw err;
        }
      }
    }
  }

  // CASCADE deletes lines when the bouquet is deleted
  await premadeBouquetRepo.deleteById(bouquet._pgId);

  broadcast({ type: 'premade_bouquet_returned', bouquetId: id, name: bouquet.Name || '' });
  return { message: 'Premade bouquet returned to stock.', returnedItems };
}

export async function matchPremadeBouquetToOrder(id, orderData, config) {
  const premade = await getPremadeBouquet(id);
  if (!premade.lines || premade.lines.length === 0) {
    const err = new Error('Premade bouquet has no lines — cannot match to order.');
    err.statusCode = 400;
    throw err;
  }

  const orderLines = premade.lines.map(l => ({
    stockItemId:      l['Stock Item']?.[0] || null,
    flowerName:       l['Flower Name'] || '',
    quantity:         Number(l.Quantity || 0),
    costPricePerUnit: Number(l['Cost Price Per Unit'] || 0),
    sellPricePerUnit: Number(l['Sell Price Per Unit'] || 0),
  }));

  const priceOverride = orderData.priceOverride != null
    ? orderData.priceOverride
    : (premade['Price Override'] || null);

  const result = await createOrder(
    {
      ...orderData,
      orderLines,
      priceOverride,
      notes: orderData.notes || premade.Notes || '',
    },
    config,
    { skipStockDeduction: true },
  );

  try {
    await premadeBouquetRepo.deleteById(premade._pgId);  // CASCADE removes lines
  } catch (cleanupErr) {
    console.error('[PREMADE] Cleanup after match failed:', cleanupErr.message);
  }

  broadcast({ type: 'premade_bouquet_matched', bouquetId: id, orderId: result.order?.id || null });
  return { ...result, premadeBouquetId: id };
}
```

- [ ] **Step 2: Verify**

```bash
node --check backend/src/services/premadeBouquetService.js
cd backend && npx vitest run src/__tests__/premadeBouquetService.test.js
```

Expected: parse OK; tests may need adjusting (next task covers integration tests). For now, unit tests of `premadeBouquetService.test.js` may need updates to mock `premadeBouquetRepo` instead of `airtable.js`. If they fail, note the specific failures — Task 12 includes test fixes.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/premadeBouquetService.js
git commit -m "$(cat <<'EOF'
refactor(premade): migrate premadeBouquetService to premadeBouquetRepo

- All persistence now via repo. ON DELETE CASCADE handles line deletion when bouquet is deleted.
- Wire format unchanged — routes/frontends untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Fix remaining bypasses in stock.js (velocity, pending-po, usage trace, premade price-sync PATCH)

**Files:**
- Modify: `backend/src/routes/stock.js`

- [ ] **Step 1: Update imports**

Replace lines 1–13 of `stock.js` with:

```javascript
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { actorFromReq } from '../utils/actor.js';
import { ORDER_STATUS, PO_STATUS, LOSS_REASON } from '../constants/statuses.js';
```

(`db`, `TABLES`, `listByIds` removed.)

- [ ] **Step 2: Rewrite `/velocity`**

Replace lines ~63–110 with:

```javascript
router.get('/velocity', async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const lines = await orderRepo.getLinesForVelocity(thirtyDaysAgo, today);

    const qtySoldByStock = {};
    for (const line of lines) {
      const id = line.stockItemId;
      if (!id) continue;
      qtySoldByStock[id] = (qtySoldByStock[id] || 0) + Number(line.quantity || 0);
    }

    // Existing per-stock velocity calculation continues from here unchanged.
    // ... (rest of original velocity body — days-of-supply math)
  } catch (err) {
    next(err);
  }
});
```

The rest of the velocity body (days-of-supply calculation against current stock) stays as-is from the original — only the data fetch at the top changed. Read the original lines 90–110 in `git show HEAD:backend/src/routes/stock.js` to copy the unchanged math.

- [ ] **Step 3: Rewrite `/pending-po`**

Replace lines ~224–326. The entire route — replace with:

```javascript
router.get('/pending-po', async (req, res, next) => {
  try {
    const pendingStatuses = [
      PO_STATUS.DRAFT, PO_STATUS.SENT, PO_STATUS.SHOPPING,
      PO_STATUS.REVIEWING, PO_STATUS.EVALUATING, PO_STATUS.EVAL_ERROR,
    ];

    // List all pending POs across statuses (small N — typically <30)
    const allPendingPOs = [];
    for (const s of pendingStatuses) {
      const pos = await stockOrderRepo.list({ status: s });
      allPendingPOs.push(...pos);
    }
    if (allPendingPOs.length === 0) return res.json({});

    const poIds = allPendingPOs.map(po => po._pgId).filter(Boolean);
    const linesByPo = await stockOrderRepo.getLinesForPos(poIds);
    const allLines = [];
    for (const po of allPendingPOs) {
      const ls = linesByPo.get(po._pgId) || [];
      for (const l of ls) allLines.push({ ...l, _poPgId: po._pgId });
    }

    const poMap = {};
    for (const po of allPendingPOs) {
      poMap[po._pgId] = {
        id: po.id, number: po['Stock Order ID'] || '',
        status: po.Status, plannedDate: po['Planned Date'] || null,
      };
    }

    // Auto-resolve unlinked lines (Flower Name → Stock Item)
    const unlinked = allLines
      .map((l, idx) => ({ idx, line: l }))
      .filter(({ line }) => !line['Stock Item']?.[0] && line['Flower Name']);

    const nameToId = {};
    if (unlinked.length > 0) {
      const uniqueNames = [...new Set(unlinked.map(u => u.line['Flower Name'].trim()))];
      for (const name of uniqueNames) {
        try {
          const matches = await stockRepo.list({
            pg: { active: true, includeEmpty: true, displayName: name },
            maxRecords: 1,
          });
          if (matches.length > 0) {
            nameToId[name] = matches[0].id;
            const existing = matches[0];
            if (!existing['Current Cost Price'] && !existing['Current Sell Price']) {
              const samplePoLine = unlinked.find(x => x.line['Flower Name']?.trim() === name)?.line;
              if (samplePoLine && (Number(samplePoLine['Cost Price']) || Number(samplePoLine['Sell Price']))) {
                stockRepo.update(existing.id, {
                  'Current Cost Price': Number(samplePoLine['Cost Price']) || 0,
                  'Current Sell Price': Number(samplePoLine['Sell Price']) || 0,
                  ...(samplePoLine.Supplier ? { Supplier: samplePoLine.Supplier } : {}),
                }, { actor: actorFromReq(req) }).catch(err =>
                  console.error(`[STOCK] Price backfill failed for ${existing.id}:`, err.message));
              }
            }
          } else {
            const samplePoLine = unlinked.find(x => x.line['Flower Name']?.trim() === name)?.line;
            const created = await stockRepo.create({
              'Display Name':       name,
              'Purchase Name':      name,
              'Current Quantity':   0,
              'Current Cost Price': Number(samplePoLine?.['Cost Price']) || 0,
              'Current Sell Price': Number(samplePoLine?.['Sell Price']) || 0,
              Supplier:             samplePoLine?.Supplier || '',
              Category:             'Other',
              Active:               true,
            }, { actor: actorFromReq(req) });
            nameToId[name] = created.id;
            console.log(`[STOCK] Auto-created "${name}" (${created.id}) from pending PO line`);
          }
        } catch { /* skip */ }
      }
      // Persist the auto-link via stockOrderRepo (was direct Airtable update)
      for (const u of unlinked) {
        const stockId = nameToId[u.line['Flower Name'].trim()];
        if (stockId && u.line.id) {
          allLines[u.idx]._resolvedStockId = stockId;
          stockOrderRepo.updateLine(u.line.id, { 'Stock Item': [stockId] }).catch(err =>
            console.error(`[STOCK] Failed to link PO line ${u.line.id} to stock ${stockId}:`, err.message));
        }
      }
    }

    // Aggregate by stock item
    const result = {};
    for (const line of allLines) {
      const stockItemId = line['Stock Item']?.[0] || line._resolvedStockId;
      if (!stockItemId) continue;
      if (!result[stockItemId]) result[stockItemId] = { ordered: 0, pos: [] };
      const qty = Number(line['Quantity Needed'] || 0);
      result[stockItemId].ordered += qty;
      const poInfo = poMap[line._poPgId];
      if (poInfo) {
        result[stockItemId].pos.push({
          id:          poInfo.id,
          number:      poInfo.number,
          quantity:    qty,
          status:      poInfo.status,
          plannedDate: poInfo.plannedDate,
        });
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Rewrite the usage trace's PO lookup + premade fetch sections**

In `GET /:id/usage` (around line 570–660), replace:

```javascript
// 3. Purchase records — switch to repo + dual marker regex
const allPurchases = await stockPurchasesRepo.list({});
const linePurchases = allPurchases.filter(p => siblingIds.has(p.Flower?.[0]));

// New regex: accepts both old recXXX and new human-readable PO number formats
const poMarkerRe = /PO #([A-Za-z0-9_\-]+)\s+L#([A-Za-z0-9_\-]+)\s+(primary|substitute|alt)/;

// Resolve PO references — if the captured group looks like a recXXX, look up via repo dual-lookup;
// if it's already human-readable (PO-YYYYMMDD-N), no lookup needed.
const poRefSet = new Set();
for (const p of linePurchases) {
  const m = p.Notes?.match(poMarkerRe);
  if (m && m[1].startsWith('rec')) poRefSet.add(m[1]);
}
const poMap = {};
if (poRefSet.size > 0) {
  try {
    const poRecs = await stockOrderRepo.listByIds([...poRefSet]);
    for (const po of poRecs) poMap[po.id] = po['Stock Order ID'] || '';
  } catch { /* best effort */ }
}

const usagePurchases = linePurchases.map(p => {
  const m = p.Notes?.match(poMarkerRe);
  const poRef = m?.[1] || null;
  const poDisplayId = poRef
    ? (poRef.startsWith('rec') ? (poMap[poRef] || '') : poRef)
    : '';
  const variant = m?.[3] || '';
  return {
    type:        'purchase',
    date:        p['Purchase Date'] || null,
    quantity:    +(p['Quantity Purchased'] || 0),
    supplier:    p.Supplier || '',
    costPerUnit: p['Price Per Unit'] || 0,
    notes:       p.Notes || '',
    poDisplayId,
    variant,
  };
});

// 4. Active premade bouquet lines — via repo
const allBouquets = await premadeBouquetRepo.list();
const usagePremades = [];
for (const bouquet of allBouquets) {
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  for (const l of lines) {
    if (!siblingIds.has(l['Stock Item']?.[0])) continue;
    usagePremades.push({
      type:        'premade',
      date:        null,
      quantity:    -(Number(l.Quantity) || 0),
      bouquetId:   bouquet.id,
      bouquetName: bouquet.Name || '?',
      flowerName:  l['Flower Name'] || displayName,
    });
  }
}
```

(Replace the corresponding original sections that used `db.list(TABLES.STOCK_PURCHASES, ...)`, `listByIds(TABLES.STOCK_ORDERS, ...)`, `db.list(TABLES.PREMADE_BOUQUETS, ...)`, and the linked-record formula.)

- [ ] **Step 5: Rewrite `PATCH /:id` premade price-sync cascade**

Replace lines ~705–725 with:

```javascript
    const costChanged = 'Current Cost Price' in safeFields;
    const sellChanged = 'Current Sell Price' in safeFields;
    if (costChanged || sellChanged) {
      try {
        const matchingLines = await premadeBouquetRepo.getLinesByStockId(req.params.id);
        for (const line of matchingLines) {
          const patch = {};
          if (costChanged) patch['Cost Price Per Unit'] = Number(safeFields['Current Cost Price']) || 0;
          if (sellChanged) patch['Sell Price Per Unit'] = Number(safeFields['Current Sell Price']) || 0;
          await premadeBouquetRepo.updateLine(line.id, patch);
        }
      } catch (err) {
        console.error('[STOCK] premade price-sync failed:', err.message);
      }
    }
```

- [ ] **Step 6: Verify no Airtable calls remain in stock.js**

```bash
grep -nE "TABLES\.|db\.list|db\.getById|db\.update|db\.create|db\.deleteRecord" backend/src/routes/stock.js | grep -v "//\|stockRepo\|orderRepo\|customerRepo\|stockLossRepo\|stockPurchasesRepo\|stockOrderRepo\|premadeBouquetRepo"
```

Expected: empty. Then `node --check backend/src/routes/stock.js` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/stock.js
git commit -m "$(cat <<'EOF'
fix(stock): replace remaining frozen-Airtable reads with PG repos

- /velocity uses orderRepo.getLinesForVelocity (was reading frozen ORDERS since 2026-05-02)
- /pending-po uses stockOrderRepo + getLinesForPos batch (was N+1 Airtable formula loop)
- /:id/usage purchase + premade trail via stockPurchasesRepo / stockOrderRepo / premadeBouquetRepo
- PATCH /:id premade price-sync cascade via premadeBouquetRepo.getLinesByStockId
- Marker regex widened to match both recXXX (historical) and human-readable PO numbers (new)

No Airtable calls remain in stock.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Integration tests for new repos + service tests update

**Files:**
- Create: `backend/src/__tests__/stockOrderRepo.integration.test.js`
- Create: `backend/src/__tests__/premadeBouquetRepo.integration.test.js`
- Modify: `backend/src/__tests__/premadeBouquetService.test.js` (replace airtable mocks with repo mocks)

- [ ] **Step 1: Write `stockOrderRepo.integration.test.js`**

Create with the same harness pattern as `stockRepo.integration.test.js`:

```javascript
// stockOrderRepo integration tests — exercise against real Postgres (pglite).
// Catches SQL syntax errors, default values, FK CASCADE behaviour, and
// dual-lookup correctness.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stockOrders, stockOrderLines, stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
}));

import * as stockOrderRepo from '../repos/stockOrderRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('stockOrderRepo header CRUD', () => {
  it('create() inserts with sensible defaults', async () => {
    const po = await stockOrderRepo.create({
      'Stock Order ID': 'PO-20260508-1',
      'Created Date':   '2026-05-08',
      Status:           'Draft',
    });
    expect(po.Status).toBe('Draft');
    expect(po['Stock Order ID']).toBe('PO-20260508-1');
    expect(po._pgId).toBeDefined();
  });

  it('getById() resolves recXXX via airtable_id and uuid via primary key', async () => {
    const [row] = await harness.db.insert(stockOrders).values({
      airtableId:  'recABC123',
      poNumber:    'PO-20260101-1',
      createdDate: '2026-01-01',
    }).returning();

    const byAt = await stockOrderRepo.getById('recABC123');
    expect(byAt._pgId).toBe(row.id);

    const byUuid = await stockOrderRepo.getById(row.id);
    expect(byUuid._pgId).toBe(row.id);
  });

  it('nextPoSequence() returns MAX(N)+1 for the date', async () => {
    await harness.db.insert(stockOrders).values([
      { poNumber: 'PO-20260508-1', createdDate: '2026-05-08' },
      { poNumber: 'PO-20260508-3', createdDate: '2026-05-08' },  // gap at 2
      { poNumber: 'PO-20260507-2', createdDate: '2026-05-07' },
    ]);
    const seq = await stockOrderRepo.nextPoSequence('2026-05-08');
    expect(seq).toBe(4);
  });

  it('update() patches only provided fields', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-X', 'Created Date': '2026-05-08' });
    const updated = await stockOrderRepo.update(po._pgId, {
      Status: 'Sent', 'Assigned Driver': 'Timur',
    });
    expect(updated.Status).toBe('Sent');
    expect(updated['Assigned Driver']).toBe('Timur');
    expect(updated['Stock Order ID']).toBe('PO-X');
  });
});

describe('stockOrderRepo line CRUD', () => {
  it('CASCADE deletes lines when PO is deleted', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-CD', 'Created Date': '2026-05-08' });
    await stockOrderRepo.createLine({
      'Stock Orders':    [po._pgId],
      'Flower Name':     'Rose',
      'Quantity Needed': 25,
    });
    let lines = await stockOrderRepo.getLinesByPoId(po._pgId);
    expect(lines).toHaveLength(1);

    await stockOrderRepo.deleteById(po._pgId);
    lines = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.poId, po._pgId));
    expect(lines).toHaveLength(0);
  });

  it('Stock Item link routes to stock_id (uuid) or stock_airtable_id (recXXX)', async () => {
    const [s] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, active: true,
    }).returning();

    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-S', 'Created Date': '2026-05-08' });
    const line1 = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Stock Item': [s.id], 'Flower Name': 'Rose',
    });
    const line2 = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Stock Item': ['recXYZ789'], 'Flower Name': 'Tulip',
    });

    const [r1] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line1._pgId));
    const [r2] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line2._pgId));
    expect(r1.stockId).toBe(s.id);
    expect(r1.stockAirtableId).toBeNull();
    expect(r2.stockAirtableId).toBe('recXYZ789');
    expect(r2.stockId).toBeNull();
  });

  it('updateLine maps Alt * fields to substitute_* columns', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-A', 'Created Date': '2026-05-08' });
    const line = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Flower Name': 'Rose',
    });
    await stockOrderRepo.updateLine(line._pgId, {
      'Alt Flower Name':    'Pink Rose',
      'Alt Cost':           4.5,
      'Alt Quantity Found': 20,
    });
    const [r] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line._pgId));
    expect(r.substituteFlowerName).toBe('Pink Rose');
    expect(Number(r.substituteCost)).toBe(4.5);
    expect(r.substituteQuantityFound).toBe(20);
  });
});
```

- [ ] **Step 2: Write `premadeBouquetRepo.integration.test.js`**

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { premadeBouquets, premadeBouquetLines, stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({ get db() { return dbHolder.db; } }));

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('premadeBouquetRepo', () => {
  it('create + line CRUD round-trip', async () => {
    const b = await premadeBouquetRepo.create({ Name: 'Spring Mix', 'Created By': 'florist' });
    expect(b.Name).toBe('Spring Mix');
    const line = await premadeBouquetRepo.createLine({
      'Premade Bouquets':    [b._pgId],
      'Flower Name':         'Tulip',
      Quantity:              10,
      'Cost Price Per Unit': 2.5,
      'Sell Price Per Unit': 8,
    });
    expect(line.Quantity).toBe(10);
    expect(line['Cost Price Per Unit']).toBe(2.5);

    const lines = await premadeBouquetRepo.getLinesByBouquetId(b._pgId);
    expect(lines).toHaveLength(1);
  });

  it('CASCADE on delete', async () => {
    const b = await premadeBouquetRepo.create({ Name: 'X' });
    await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Flower Name': 'Rose', Quantity: 5,
    });
    await premadeBouquetRepo.deleteById(b._pgId);
    const remaining = await harness.db.select().from(premadeBouquetLines)
      .where(eq(premadeBouquetLines.bouquetId, b._pgId));
    expect(remaining).toHaveLength(0);
  });

  it('getLinesByStockId resolves recXXX and uuid', async () => {
    const [s] = await harness.db.insert(stock).values({
      displayName: 'Lily', currentQuantity: 0, active: true,
    }).returning();

    const b = await premadeBouquetRepo.create({ Name: 'Lily Bouquet' });
    await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Stock Item': [s.id], 'Flower Name': 'Lily', Quantity: 3,
    });
    const found = await premadeBouquetRepo.getLinesByStockId(s.id);
    expect(found).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Update `premadeBouquetService.test.js` to mock the new repo**

Replace `airtable.js` mocks with `premadeBouquetRepo` mocks:

```javascript
vi.mock('../repos/premadeBouquetRepo.js', () => ({
  list:                vi.fn(),
  getById:             vi.fn(),
  create:              vi.fn(),
  update:              vi.fn(),
  deleteById:          vi.fn(),
  createLine:          vi.fn(),
  getLinesByBouquetId: vi.fn(),
  updateLine:          vi.fn(),
  deleteLineById:      vi.fn(),
}));
```

(Update test bodies that previously asserted on `db.create(TABLES.PREMADE_BOUQUETS, ...)` to instead assert on `premadeBouquetRepo.create(...)`. Same for line operations.)

- [ ] **Step 4: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all pass. Fix any failing tests inline — common fixes:
- Tests asserting on `TABLES.STOCK_ORDERS` — assert on `stockOrderRepo` calls instead.
- Tests using `airtable-mock` for PO/premade — replace with pglite + repo calls.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/
git commit -m "$(cat <<'EOF'
test: integration tests for stockOrderRepo + premadeBouquetRepo

- pglite-backed integration tests cover header + line CRUD, CASCADE deletes,
  dual-lookup, MAX-based PO sequence, substitute_* column mapping
- premadeBouquetService.test.js updated to mock premadeBouquetRepo (was airtable.js)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Backfill script + pglite test fixtures + airtableSchema cleanup

**Files:**
- Create: `backend/scripts/backfill-phase7.js` (DESTRUCTIVE)
- Create: `backend/src/__tests__/helpers/phase7-seed.js`
- Modify: `backend/src/__tests__/helpers/pgHarness.js` (auto-seed Phase 7 in tests if helper invoked)
- Modify: `backend/src/services/airtableSchema.js` (remove PO/premade entries)
- Modify: `backend/src/services/__fixtures__/airtable-test-base.json` (remove PO/premade tables)
- Modify: `backend/src/routes/test.js` (update `/test/state` to include PG counts)

- [ ] **Step 1: Write the backfill script**

Create `backend/scripts/backfill-phase7.js`:

```javascript
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

  // Map Airtable PO id → PG uuid
  const poIdMap = new Map();

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
      supplierPayments:  String(f['Supplier Payments'] || ''),
      driverPayment:     String(f['Driver Payment'] || ''),
    };
    if (DRY) { console.log(`[dry] would upsert PO ${h.id} → ${values.poNumber}`); continue; }

    const [row] = await db.insert(stockOrders).values(values)
      .onConflictDoUpdate({
        target: stockOrders.airtableId,
        set: { ...values, airtableId: undefined },  // don't overwrite airtable_id
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

    await db.insert(stockOrderLines).values(values)
      .onConflictDoUpdate({
        target: stockOrderLines.airtableId,
        set: { ...values, airtableId: undefined },
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
    const [row] = await db.insert(premadeBouquets).values(values)
      .onConflictDoUpdate({
        target: premadeBouquets.airtableId,
        set: { ...values, airtableId: undefined },
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
    await db.insert(premadeBouquetLines).values(values)
      .onConflictDoUpdate({
        target: premadeBouquetLines.airtableId,
        set: { ...values, airtableId: undefined },
      });
  }
  console.log(`[backfill] Premade Bouquets done.`);
}

async function main() {
  if (process.env.NODE_ENV === 'production' && DRY) {
    console.log('[backfill] DRY-RUN against prod Airtable. No PG writes.');
  }
  await backfillStockOrders();
  await backfillPremadeBouquets();

  // Health summary
  if (!DRY) {
    const [poCount] = await db.select({ c: sql`count(*)::int` }).from(stockOrders);
    const [pblCount] = await db.select({ c: sql`count(*)::int` }).from(premadeBouquetLines);
    console.log(`[backfill] PG row counts — stock_orders=${poCount.c}, premade_bouquet_lines=${pblCount.c}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Write pglite seed helper**

Create `backend/src/__tests__/helpers/phase7-seed.js`:

```javascript
// Seeds representative POs + premade bouquets into pglite for E2E tests.
// Mirrors the shape the airtable-mock previously seeded.

import { stockOrders, stockOrderLines, premadeBouquets, premadeBouquetLines, stock } from '../../db/schema.js';

export async function seedPhase7(db) {
  const [r] = await db.select({ id: stock.id, displayName: stock.displayName }).from(stock).limit(5);
  const sampleStockId = r?.id || null;

  // Two POs in different lifecycle stages
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

  // One active premade bouquet
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
}
```

- [ ] **Step 3: Update `airtableSchema.js` to remove PO/premade write-field validation**

In `backend/src/services/airtableSchema.js`, remove these entries from `EXPECTED_WRITE_FIELDS`:

```javascript
[TABLES.STOCK_ORDER_LINES]: [...],
[TABLES.STOCK_ORDERS]: [...],
[TABLES.PREMADE_BOUQUETS]: [...],
[TABLES.PREMADE_BOUQUET_LINES]: [...],
```

(The schema validator runs at boot — once the routes no longer write to these tables, the validation is no-op anyway, but cleaner to drop.)

- [ ] **Step 4: Update `airtable-test-base.json` to remove PO/premade tables**

Remove the four top-level keys: `tblMockStockOrders`, `tblMockStockOrderLines`, `tblMockPremadeBouquets`, `tblMockPremadeBouquetLines`.

(After Phase 7 these are unused — the harness covers POs/premades via pglite.)

- [ ] **Step 5: Update `/test/state` and `/test/reset` in `routes/test.js`**

Locate where the harness reset clears Airtable state and ensure it also seeds Phase 7 fixtures into pglite. The reset endpoint typically clears mock + reseeds. Find the reset handler and add:

```javascript
import { seedPhase7 } from '../__tests__/helpers/phase7-seed.js';
import { db } from '../db/index.js';

// In the reset handler, after pglite migrations are applied:
await seedPhase7(db);
```

Also update the `/test/state` endpoint to include row counts from PG for stock_orders + premade_bouquets so the existing E2E section 1 invariant (`tblMockStockOrders.length === 2`) can be updated to check `pg.stockOrders.length === 2`.

- [ ] **Step 6: Update E2E section 1 boot invariant**

In `scripts/e2e-test.js` line 265, change:

```javascript
assert('Mock has 2 POs', state.body.airtable.tblMockStockOrders?.length === 2);
```

To:

```javascript
assert('Mock has 2 POs', state.body.pg?.stockOrders?.length === 2);
```

(Or whatever shape `/test/state` now returns. Check the reset handler in `routes/test.js` for the actual JSON layout.)

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/backfill-phase7.js backend/src/__tests__/helpers/phase7-seed.js backend/src/services/airtableSchema.js backend/src/services/__fixtures__/airtable-test-base.json backend/src/routes/test.js scripts/e2e-test.js
git commit -m "$(cat <<'EOF'
feat(phase7): backfill script + pglite seed + harness cleanup

- backfill-phase7.js: DESTRUCTIVE, idempotent (ON CONFLICT DO UPDATE on airtable_id)
  Captures all POs (Draft/Sent/Shopping/Reviewing/Evaluating/Complete/Cancelled).
- phase7-seed.js: pglite seed for E2E harness — replaces airtable-mock PO/premade tables
- airtableSchema.js: dropped PO/premade write-field validation (frozen tables)
- airtable-test-base.json: dropped PO/premade mock tables
- /test/state and section 1 boot invariant updated to read PG counts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Verification + docs

**Files:**
- Modify: `BACKLOG.md`, `CHANGELOG.md`, `backend/CLAUDE.md`

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: 100% pass. Quote the final summary line. Fix any failures inline.

- [ ] **Step 2: Run shared package tests + builds for all three apps**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run
cd apps/florist && ./node_modules/.bin/vite build
cd apps/dashboard && ./node_modules/.bin/vite build
cd apps/delivery && ./node_modules/.bin/vite build
```

Expected: all green. (Phase 7 is backend-only but builds confirm no shared package regressions.)

- [ ] **Step 3: Run E2E suite against the harness**

```bash
cd /Users/oliwer/Projects/flower-studio
npm run harness &
HARNESS_PID=$!
sleep 5
npm run test:e2e
EXIT=$?
kill $HARNESS_PID
exit $EXIT
```

Expected: `🌸 ALL E2E TESTS PASSED`. Quote the section count. Fix any regressions inline.

- [ ] **Step 4: Update BACKLOG.md**

Edit the "Pick-up checklist for the next session" block at the top. Strike through Phase 7 read-path bypasses, mark Phase 7 stock-orders + premade as **DONE 2026-05-XX**, list the remaining Airtable retirement work for PR 2.

- [ ] **Step 5: Update CHANGELOG.md**

Add a Phase 7 entry under today's date:

```markdown
## 2026-05-XX — Phase 7 (PR 1): Stock Orders + Premade Bouquets on Postgres

### Schema
- 4 new tables: `stock_orders`, `stock_order_lines`, `premade_bouquets`, `premade_bouquet_lines` (migration 0011)
- `substitute_*` columns on `stock_order_lines` (CONTEXT.md domain term; API surface keeps "Alt *")
- ON DELETE CASCADE on lines

### Code migration
- `stockOrders.js` (~1000 LOC): every `db.*` call routed through `stockOrderRepo` / `stockRepo` / `stockPurchasesRepo`
- `premadeBouquetService.js`: full migration to `premadeBouquetRepo`
- `stock.js` 5 live bypasses fixed: `/velocity`, `/pending-po`, `/:id/usage` purchase + premade trail, PATCH `/:id` premade price-sync, `/meta/lookups`
- `orderService.js`: extracted `findOrdersNeedingSubstitution`, fixed premade price-sync in createOrder

### Operational
- New PO marker format embeds human-readable PO number (`PO #PO-20260508-1 L#<uuid>`) — see ADR-0003
- PO sequence now `MAX(N)+1` not `COUNT` — survives backfill gaps
- Backfill script: `backend/scripts/backfill-phase7.js` (DESTRUCTIVE, idempotent)
- E2E fixtures migrated from airtable-mock to pglite seed (helpers/phase7-seed.js)

### Out of scope (PR 2)
- Delete `airtable.js` / `airtableSchema.js` / `config/airtable.js`
- Remove `airtable` npm dep
- Remove `STOCK_BACKEND` / `ORDER_BACKEND` flag logic + boot guard
- Cancel Airtable subscription
```

- [ ] **Step 6: Update `backend/CLAUDE.md`**

In the Routes table, remove the airtable-only annotations from `stockOrders.js`. In the Services table, replace `premadeBouquetService.js` description to mention `premadeBouquetRepo`. Update the "Database (in transition…)" section to note that Phase 7 PR 1 has landed and only the cleanup PR (PR 2) remains.

- [ ] **Step 7: Commit + push + open PR**

```bash
git add BACKLOG.md CHANGELOG.md backend/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: Phase 7 PR 1 — Stock Orders + Premade Bouquets cutover complete

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

git push -u origin feat/phase7-stock-orders-premade

gh pr create --title "Phase 7 PR 1: Stock Orders + Premade Bouquets to Postgres" --body "$(cat <<'EOF'
## Summary
- Migrates STOCK_ORDERS / STOCK_ORDER_LINES / PREMADE_BOUQUETS / PREMADE_BOUQUET_LINES from Airtable to Postgres (migration 0011)
- Two new repos with dual-lookup (recXXX or uuid)
- Fixes 5 live Airtable bypasses (`/velocity`, `/meta/lookups`, `/pending-po` line write, usage trace, PATCH premade price-sync) — all reading from frozen Airtable since 2026-05-02
- New PO marker format embeds human-readable PO number — see ADR-0003
- Substitution detection extracted to `orderService.findOrdersNeedingSubstitution`
- Backfill script + pglite test fixtures
- PR 2 (separate plan) handles `airtable.js` deletion, npm dep removal, and `*_BACKEND` flag cleanup

## Verification
- `npm run harness && npm run test:e2e`: ALL PASSED
- Backend Vitest: ALL PASSED
- Shared Vitest + 3-app Vite builds: GREEN
- Backfill script tested with `--dry-run` against staging Airtable

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

Plan covers all decisions from the grill-with-docs session:

- ✅ Direct cutover with backfill (no shadow window) — backfill script in Task 13
- ✅ All POs incl. Complete + Cancelled — backfill iterates all rows
- ✅ Dual-lookup — `findPgByAirtableOrUuid` in both repos (Tasks 2, 3, 4)
- ✅ `substitute_*` PG / `Alt *` API — `lineToWire` / `lineToPg` in stockOrderRepo
- ✅ `MAX(N)+1` sequence — `nextPoSequence` in Task 2; used in Task 7
- ✅ New PO marker format — Task 9 evaluate body + ADR-0003 already written
- ✅ `findOrdersNeedingSubstitution` extracted — Task 5
- ✅ All 5 bypass fixes — Task 5 (orderService premade), Task 11 (stock.js)
- ✅ pglite fixtures + airtable-mock cleanup — Task 13
- ✅ `STOCK_BACKEND` / `ORDER_BACKEND` flag removal deferred to PR 2 — noted in CHANGELOG

**Type consistency check:** all repo function names (`getById`, `update`, `deleteById`, `createLine`, `getLineById`, `getLinesByPoId`, `getLinesByBouquetId`, `getLinesByStockId`, `getLinesForPos`, `getLinesForVelocity`, `getLinesForOrders`, `nextPoSequence`, `listByIds`) are consistent across the tasks where they appear.

**No placeholders:** Each task has complete code or explicit edits; no "TBD" or "similar to" references.
