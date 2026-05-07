# Phase 5 — Customer Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut over the Customer domain from Airtable to Postgres — new `customers`, `key_people`, and `legacy_orders` PG tables; three backfill scripts; a full rewrite of `customerRepo.js` to use Drizzle; and E2E harness coverage.

**Architecture:** Direct flip, no shadow window. Migration 0006 creates the new tables. Three DESTRUCTIVE backfill scripts populate them from production Airtable data (owner runs these manually). Then `customerRepo.js` is rewritten to read/write PG exclusively — same public API, same wire format, no frontend changes. The `customers.js` insights route replaces its `airtable.js` `db.list(TABLES.ORDERS)` call with a Drizzle query. The test harness gains a customers seed so the E2E suite exercises the PG path.

**Tech Stack:** Node.js, Drizzle ORM (`drizzle-orm`), PG (`pg`), Vitest, the project's existing `backend/src/db/` layer.

**Design reference:** `docs/migration/execution-plan-2026-04-27.md` §§5a–5e (locked design, do not deviate without owner sign-off).

---

## File map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/src/db/migrations/0006_phase5_customers.sql` | DDL: customers, key_people, legacy_orders tables + orders.key_person_id |
| Modify | `backend/src/db/schema.js` | Add Drizzle table definitions; add `keyPersonId` to orders |
| Create | `backend/scripts/find-customer-duplicates.js` | SAFE pre-backfill dedup script |
| Create | `backend/scripts/backfill-customers.js` | DESTRUCTIVE — Airtable Clients → PG customers + key_people |
| Create | `backend/scripts/backfill-legacy-orders.js` | DESTRUCTIVE — Airtable LEGACY_ORDERS → PG legacy_orders |
| Create | `backend/scripts/backfill-customer-fk.js` | DESTRUCTIVE — orders.customer_id recXXX → UUID strings |
| Rewrite | `backend/src/repos/customerRepo.js` | Full PG implementation; same public API |
| Rewrite | `backend/src/__tests__/customerRepo.test.js` | Tests for PG implementation (mocking Drizzle, not Airtable) |
| Modify | `backend/src/routes/customers.js` | Insights route: replace Airtable `db.list` with Drizzle; update field refs |
| Modify | `backend/src/routes/test.js` | Harness reset: seed customers + key_people from mock fixture |
| Modify | `scripts/e2e-test.js` | Section 26: customer CRUD via PG |

---

## Task 1: Migration 0006 + schema.js

**Files:**
- Create: `backend/src/db/migrations/0006_phase5_customers.sql`
- Modify: `backend/src/db/schema.js`

- [ ] **Step 1.1: Write the migration SQL**

Create `backend/src/db/migrations/0006_phase5_customers.sql`:

```sql
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"name" text NOT NULL,
	"nickname" text,
	"phone" text,
	"email" text,
	"link" text,
	"language" text,
	"home_address" text,
	"sex_business" text,
	"segment" text,
	"found_us_from" text,
	"communication_method" text,
	"order_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "key_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_details" text,
	"important_date" date,
	"important_date_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legacy_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_date" date,
	"description" text,
	"amount" numeric(10, 2),
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "key_person_id" uuid;
--> statement-breakpoint
ALTER TABLE "key_people" ADD CONSTRAINT "key_people_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_orders" ADD CONSTRAINT "legacy_orders_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_key_person_id_fk" FOREIGN KEY ("key_person_id") REFERENCES "public"."key_people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_airtable_id_idx" ON "customers" USING btree ("airtable_id");
--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "customers_deleted_idx" ON "customers" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "key_people_customer_id_idx" ON "key_people" USING btree ("customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_orders_airtable_id_idx" ON "legacy_orders" USING btree ("airtable_id");
--> statement-breakpoint
CREATE INDEX "legacy_orders_customer_id_idx" ON "legacy_orders" USING btree ("customer_id");
--> statement-breakpoint
INSERT INTO system_meta (key, value) VALUES ('customers_migration_at', NOW()::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
```

- [ ] **Step 1.2: Add table definitions to schema.js**

In `backend/src/db/schema.js`, after the `parityLog` export, append:

```js
// ── Phase 5: Customers ──
//
// customers.airtable_id stays populated for all rows backfilled from Airtable.
// Rows created post-cutover have airtable_id = NULL.
//
// orders.customer_id is text during Phase 4-5 transition (holds recXXX).
// backfill-customer-fk.js converts the values to UUID strings; a future
// cleanup migration can ALTER COLUMN + add the formal FK constraint.
export const customers = pgTable('customers', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  airtableId:          text('airtable_id'),
  name:                text('name').notNull(),
  nickname:            text('nickname'),
  phone:               text('phone'),
  email:               text('email'),
  link:                text('link'),
  language:            text('language'),
  homeAddress:         text('home_address'),
  sexBusiness:         text('sex_business'),
  segment:             text('segment'),
  foundUsFrom:         text('found_us_from'),
  communicationMethod: text('communication_method'),
  orderSource:         text('order_source'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:           timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  airtableIdx: uniqueIndex('customers_airtable_id_idx').on(table.airtableId),
  nameIdx:     index('customers_name_idx').on(table.name),
  phoneIdx:    index('customers_phone_idx').on(table.phone),
  deletedIdx:  index('customers_deleted_idx').on(table.deletedAt),
}));

// Unlimited key people per customer. The 2-slot UI limit was an Airtable
// constraint — PG has no limit. First two rows (by created_at) map to
// 'Key person 1' / 'Key person 2' in the wire format for backward compat.
export const keyPeople = pgTable('key_people', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  customerId:         uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  contactDetails:     text('contact_details'),
  importantDate:      date('important_date'),
  importantDateLabel: text('important_date_label'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  customerIdx: index('key_people_customer_id_idx').on(table.customerId),
}));

// Read-only post-backfill. Schema is intentionally incompatible with orders
// (no status, no lines, no delivery FK) — kept separate, not attempted as a join.
export const legacyOrders = pgTable('legacy_orders', {
  id:          uuid('id').primaryKey().defaultRandom(),
  airtableId:  text('airtable_id').notNull(),
  customerId:  uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  orderDate:   date('order_date'),
  description: text('description'),
  amount:      numeric('amount', { precision: 10, scale: 2 }),
  raw:         jsonb('raw').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  airtableIdx: uniqueIndex('legacy_orders_airtable_id_idx').on(table.airtableId),
  customerIdx: index('legacy_orders_customer_id_idx').on(table.customerId),
}));
```

Also add `keyPersonId` to the `orders` table definition (inside the existing `pgTable('orders', { ... })`):

```js
keyPersonId: uuid('key_person_id'),  // nullable FK → key_people; set at order creation (issue #216)
```

Add the index in orders' second argument:

```js
keyPersonIdx: index('orders_key_person_id_idx').on(table.keyPersonId),
```

- [ ] **Step 1.3: Verify migration runs against pglite**

```bash
npm run harness
```

Expected: harness boots without error, pglite applies migration 0006. Watch for "Applying migration 0006_phase5_customers.sql" or similar in the logs. Then:

```bash
curl -s -X POST http://localhost:3002/api/test/reset | jq '.ok'
```

Expected: `true`

- [ ] **Step 1.4: Commit**

```bash
git add backend/src/db/migrations/0006_phase5_customers.sql backend/src/db/schema.js
git commit -m "feat(db): Phase 5 migration — customers, key_people, legacy_orders tables"
```

---

## Task 2: SAFE dedup script

**Files:**
- Create: `backend/scripts/find-customer-duplicates.js`

Run this before the backfill to give the owner a chance to merge duplicate Airtable customer records.

- [ ] **Step 2.1: Write the script**

```js
// backend/scripts/find-customer-duplicates.js
// Category: SAFE
// Reads Clients (B2C) from Airtable (no writes). Groups by exact-match phone
// then exact-match email to surface likely duplicate pairs. Owner reviews
// and merges in the Airtable UI. Re-run until output says "0 suspected pairs".
//
// Usage: node backend/scripts/find-customer-duplicates.js

import 'dotenv/config';
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const CUSTOMERS_TABLE = process.env.AIRTABLE_CUSTOMERS_TABLE;
if (!CUSTOMERS_TABLE) {
  console.error('AIRTABLE_CUSTOMERS_TABLE env var required');
  process.exit(1);
}

async function fetchAll() {
  const rows = [];
  await base(CUSTOMERS_TABLE).select({
    fields: ['Name', 'Nickname', 'Phone', 'Email'],
  }).eachPage((records, next) => {
    for (const r of records) {
      rows.push({ id: r.id, name: r.get('Name') || r.get('Nickname') || '(unnamed)', phone: r.get('Phone') || '', email: r.get('Email') || '' });
    }
    next();
  });
  return rows;
}

function findDuplicates(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

const rows = await fetchAll();
console.log(`Fetched ${rows.length} customer records.\n`);

const byPhone = findDuplicates(rows, r => r.phone.replace(/\s+/g, '').toLowerCase());
const byEmail = findDuplicates(rows, r => r.email.trim().toLowerCase());

let total = 0;

if (byPhone.length) {
  console.log('=== Duplicate phone numbers ===');
  for (const group of byPhone) {
    console.log(`  Phone: ${group[0].phone}`);
    for (const r of group) console.log(`    ${r.id}  ${r.name}`);
    total += group.length - 1;
  }
}

if (byEmail.length) {
  console.log('\n=== Duplicate emails ===');
  for (const group of byEmail) {
    console.log(`  Email: ${group[0].email}`);
    for (const r of group) console.log(`    ${r.id}  ${r.name}`);
    total += group.length - 1;
  }
}

if (total === 0) {
  console.log('✓ 0 suspected duplicate pairs. Safe to backfill.');
} else {
  console.log(`\n⚠️  ${total} suspected duplicate record(s). Merge in Airtable UI before backfilling.`);
}
```

- [ ] **Step 2.2: Verify script reads env correctly**

```bash
cd backend && node scripts/find-customer-duplicates.js
```

Expected: prints customer count and either "✓ 0 suspected duplicate pairs" or a list of duplicates. No writes happen.

- [ ] **Step 2.3: Commit**

```bash
git add backend/scripts/find-customer-duplicates.js
git commit -m "feat(scripts): SAFE customer dedup script for Phase 5 pre-backfill"
```

---

## Task 3: DESTRUCTIVE backfill scripts

**Files:**
- Create: `backend/scripts/backfill-customers.js`
- Create: `backend/scripts/backfill-legacy-orders.js`
- Create: `backend/scripts/backfill-customer-fk.js`

**CRITICAL:** These scripts mutate production Postgres. They must be idempotent (upsert on `airtable_id`). Run **only after the owner has confirmed 0 dedup pairs** and **only after migration 0006 is deployed to Railway**.

Run order: `backfill-customers.js` → `backfill-legacy-orders.js` → `backfill-customer-fk.js`.

- [ ] **Step 3.1: Write backfill-customers.js**

```js
// backend/scripts/backfill-customers.js
// Category: DESTRUCTIVE
// Reads all active rows from Airtable Clients (B2C), writes each to the PG
// `customers` table (preserving airtable_id = recXXX), and backfills up to
// two `key_people` rows per customer from Key person 1 / Key person 2 fields.
// Idempotent: upserts on airtable_id (safe to re-run).
//
// Requires owner approval phrase before running.
// Usage: APPROVE=yes node backend/scripts/backfill-customers.js

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const CUSTOMERS_TABLE = process.env.AIRTABLE_CUSTOMERS_TABLE;

const LEGACY_ODER_DATE_RE = /^(\d{4})(\d{2})-.*-(\d{1,2})[A-Za-z]{3}-\d+$/;
function parseLegacyOderDate(s) {
  if (!s) return null;
  const m = LEGACY_ODER_DATE_RE.exec(s);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

const rows = [];
await base(CUSTOMERS_TABLE).select({
  fields: [
    'Name', 'Nickname', 'Phone', 'Email', 'Link', 'Language',
    'Home address', 'Sex / Business', 'Segment (client)',
    'Found us from', 'Communication method', 'Order Source',
    'Key person 1 (Name + Contact details)',
    'Key person 2 (Name + Contact details)',
    'Key person 1 (important DATE)',
    'Key person 2 (important DATE)',
  ],
}).eachPage((records, next) => {
  for (const r of records) rows.push(r);
  next();
});

console.log(`Fetched ${rows.length} Airtable customer records.`);

let custInserted = 0, custUpdated = 0, kpInserted = 0;

for (const r of rows) {
  const result = await pool.query(
    `INSERT INTO customers
       (airtable_id, name, nickname, phone, email, link, language, home_address,
        sex_business, segment, found_us_from, communication_method, order_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (airtable_id) DO UPDATE SET
       name = EXCLUDED.name, nickname = EXCLUDED.nickname, phone = EXCLUDED.phone,
       email = EXCLUDED.email, link = EXCLUDED.link, language = EXCLUDED.language,
       home_address = EXCLUDED.home_address, sex_business = EXCLUDED.sex_business,
       segment = EXCLUDED.segment, found_us_from = EXCLUDED.found_us_from,
       communication_method = EXCLUDED.communication_method,
       order_source = EXCLUDED.order_source
     RETURNING id, (xmax = 0) AS inserted`,
    [
      r.id,
      r.get('Name') || r.get('Nickname') || '(unnamed)',
      r.get('Nickname') || null,
      r.get('Phone') || null,
      r.get('Email') || null,
      r.get('Link') || null,
      r.get('Language') || null,
      r.get('Home address') || null,
      r.get('Sex / Business') || null,
      r.get('Segment (client)') || null,
      r.get('Found us from') || null,
      r.get('Communication method') || null,
      r.get('Order Source') || null,
    ],
  );
  const { id: custId, inserted } = result.rows[0];
  if (inserted) custInserted++; else custUpdated++;

  const kpSlots = [
    { name: r.get('Key person 1 (Name + Contact details)'), date: r.get('Key person 1 (important DATE)') },
    { name: r.get('Key person 2 (Name + Contact details)'), date: r.get('Key person 2 (important DATE)') },
  ];

  for (const kp of kpSlots) {
    if (!kp.name) continue;
    await pool.query(
      `INSERT INTO key_people (customer_id, name, important_date)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [custId, kp.name, kp.date || null],
    );
    kpInserted++;
  }
}

console.log(`customers: ${custInserted} inserted, ${custUpdated} updated.`);
console.log(`key_people: ${kpInserted} inserted.`);
await pool.end();
```

- [ ] **Step 3.2: Write backfill-legacy-orders.js**

```js
// backend/scripts/backfill-legacy-orders.js
// Category: DESTRUCTIVE
// Reads LEGACY_ORDERS from Airtable; for each record, resolves the linked
// customer by airtable_id in PG, then upserts into legacy_orders.
// Run AFTER backfill-customers.js.
// Usage: APPROVE=yes node backend/scripts/backfill-legacy-orders.js

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const LEGACY_ORDERS_TABLE = process.env.AIRTABLE_LEGACY_ORDERS_TABLE;

const LEGACY_ODER_DATE_RE = /^(\d{4})(\d{2})-.*-(\d{1,2})[A-Za-z]{3}-\d+$/;
function parseLegacyOderDate(s) {
  if (!s) return null;
  const m = LEGACY_ODER_DATE_RE.exec(s);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function legacyDate(r) {
  return r.get('Order Delivery Date') || r.get('Order date')
    || parseLegacyOderDate(r.get('Oder Number'));
}

const rows = [];
await base(LEGACY_ORDERS_TABLE).select({
  fields: [
    'Oder Number', 'Flowers+Details of order', 'Order Reason',
    'Order Delivery Date', 'Order date', 'Price (with Delivery)',
    'Clients (B2C)',
  ],
}).eachPage((records, next) => {
  for (const r of records) rows.push(r);
  next();
});

console.log(`Fetched ${rows.length} legacy order records.`);

let inserted = 0, skipped = 0;

for (const r of rows) {
  const atCustomerId = r.get('Clients (B2C)')?.[0];
  if (!atCustomerId) { skipped++; continue; }

  const custResult = await pool.query(
    'SELECT id FROM customers WHERE airtable_id = $1',
    [atCustomerId],
  );
  if (custResult.rows.length === 0) {
    console.warn(`  No PG customer for Airtable id ${atCustomerId} — skipping legacy order ${r.id}`);
    skipped++;
    continue;
  }

  const customerId = custResult.rows[0].id;
  const description = [
    r.get('Oder Number'), r.get('Flowers+Details of order'), r.get('Order Reason'),
  ].filter(Boolean).join(' — ');

  await pool.query(
    `INSERT INTO legacy_orders (airtable_id, customer_id, order_date, description, amount, raw)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (airtable_id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id,
       order_date  = EXCLUDED.order_date,
       description = EXCLUDED.description,
       amount      = EXCLUDED.amount,
       raw         = EXCLUDED.raw`,
    [
      r.id,
      customerId,
      legacyDate(r) || null,
      description || null,
      r.get('Price (with Delivery)') != null ? String(r.get('Price (with Delivery)')) : null,
      JSON.stringify(r.fields),
    ],
  );
  inserted++;
}

console.log(`legacy_orders: ${inserted} upserted, ${skipped} skipped (no linked customer).`);
await pool.end();
```

- [ ] **Step 3.3: Write backfill-customer-fk.js**

This script converts `orders.customer_id` from Airtable recXXX strings to PG UUID strings (both text — no column type change). Run last.

```js
// backend/scripts/backfill-customer-fk.js
// Category: DESTRUCTIVE
// Updates orders.customer_id from recXXX (Airtable text) to the UUID string
// of the matching customers row. Both columns stay type=text; a future
// cleanup migration can ALTER COLUMN + add the formal FK constraint.
// Safe to re-run: WHERE customer_id LIKE 'rec%' limits to unprocessed rows.
// Usage: APPROVE=yes node backend/scripts/backfill-customer-fk.js

import 'dotenv/config';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Only update rows whose customer_id still looks like a recXXX.
const updateResult = await pool.query(`
  UPDATE orders
  SET customer_id = customers.id::text
  FROM customers
  WHERE customers.airtable_id = orders.customer_id
    AND orders.customer_id LIKE 'rec%'
`);
console.log(`Updated ${updateResult.rowCount} orders to UUID customer_id.`);

// Report any orders that still have recXXX ids (no matching customer found).
const unmatched = await pool.query(`
  SELECT id, customer_id FROM orders WHERE customer_id LIKE 'rec%' LIMIT 20
`);
if (unmatched.rows.length > 0) {
  console.error(`⚠️  ${unmatched.rows.length} orders still have Airtable customer_id:`);
  for (const row of unmatched.rows) {
    console.error(`  order ${row.id} → customer_id ${row.customer_id}`);
  }
  console.error('Resolve these manually before cutover.');
} else {
  console.log('✓ All orders now have UUID customer_id. Safe to flip customerRepo to PG.');
}

await pool.end();
```

- [ ] **Step 3.4: Commit**

```bash
git add backend/scripts/backfill-customers.js \
        backend/scripts/backfill-legacy-orders.js \
        backend/scripts/backfill-customer-fk.js
git commit -m "feat(scripts): DESTRUCTIVE Phase 5 backfill scripts — customers, legacy_orders, customer_fk"
```

---

## Task 4: customerRepo.js PG rewrite (TDD)

**Files:**
- Rewrite: `backend/src/__tests__/customerRepo.test.js`
- Rewrite: `backend/src/repos/customerRepo.js`

The public API (method names and return shapes) must stay identical so the routes and frontends need no changes. Wire format fields that the frontend already reads via `c._agg.totalSpend` etc. are preserved. The Airtable `'App Total Spend'` / `'App Order Count'` formula fields are NOT included in the PG response — frontends already use `c._agg.*` exclusively (confirmed in codebase grep).

`Key person 1` / `Key person 2` slots are mapped from the first two `key_people` rows (ordered by `created_at`) for backward compat with `KeyPersonChips.jsx`.

- [ ] **Step 4.1: Write failing tests for the PG customerRepo**

Replace the entire content of `backend/src/__tests__/customerRepo.test.js`:

```js
// customerRepo tests — PG implementation (Phase 5).
// Mocks the Drizzle `db` handle, NOT airtable.js.
// Verifies: same public API, same wire format, same sort/merge behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module — we verify which Drizzle calls are made, not real SQL.
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  isPostgresConfigured: true,
}));

// Mock schema exports so imports resolve without a real DB.
vi.mock('../db/schema.js', () => ({
  customers:    {},
  keyPeople:    {},
  legacyOrders: {},
  orders:       {},
}));

// Mock drizzle-orm operators — the actual logic under test is the repo's
// data mapping, not Drizzle's query builder.
vi.mock('drizzle-orm', () => ({
  eq:     vi.fn((a, b) => ({ eq: [a, b] })),
  and:    vi.fn((...args) => ({ and: args })),
  or:     vi.fn((...args) => ({ or: args })),
  ilike:  vi.fn((col, pat) => ({ ilike: [col, pat] })),
  like:   vi.fn((col, pat) => ({ like: [col, pat] })),
  isNull: vi.fn((col) => ({ isNull: col })),
  asc:    vi.fn((col) => ({ asc: col })),
  desc:   vi.fn((col) => ({ desc: col })),
  sql:    vi.fn((s) => s),
}));

import { db } from '../db/index.js';
import * as repo from '../repos/customerRepo.js';

// Helper: build a fake customer PG row (column names match Drizzle schema).
function makeRow(overrides = {}) {
  return {
    id:                  'uuid-cust-1',
    airtableId:          'recC1',
    name:                'Alice Kowalska',
    nickname:            'Ala',
    phone:               '+48 555 000 001',
    email:               'alice@test.com',
    link:                null,
    language:            'pl',
    homeAddress:         null,
    sexBusiness:         'Female',
    segment:             'Rare',
    foundUsFrom:         null,
    communicationMethod: 'WhatsApp',
    orderSource:         null,
    createdAt:           new Date('2026-01-01'),
    deletedAt:           null,
    ...overrides,
  };
}

// Helper: build a fake chainable Drizzle query that resolves to `rows`.
function makeChain(rows) {
  const chain = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    then:    vi.fn((resolve) => resolve(rows)),
  };
  // make it awaitable
  const thenable = Object.assign(Promise.resolve(rows), chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  repo._resetAggregateCache();
});

// ── pgCustomerToResponse ──
describe('pgCustomerToResponse (wire format)', () => {
  it('maps PG row to Airtable-shaped response with field aliases', async () => {
    const chain = makeChain([makeRow()]);
    db.select.mockReturnValue(chain);

    const customers = await repo.list({ withAggregates: false });

    expect(customers).toHaveLength(1);
    const c = customers[0];
    expect(c.id).toBe('uuid-cust-1');
    expect(c.Name).toBe('Alice Kowalska');
    expect(c.Nickname).toBe('Ala');
    expect(c.Phone).toBe('+48 555 000 001');
    expect(c.Segment).toBe('Rare');
    expect(c['Segment (client)']).toBe('Rare');  // alias kept for compat
    expect(c['Communication method']).toBe('WhatsApp');
    expect(c.Language).toBe('pl');
  });

  it('includes key person fields from keyPeople param (first two by position)', async () => {
    const kp1 = { id: 'kp-1', name: 'Bob', contactDetails: '0700', importantDate: '1990-03-15', importantDateLabel: 'birthday' };
    const kp2 = { id: 'kp-2', name: 'Carol', contactDetails: null, importantDate: null, importantDateLabel: null };

    const c = repo._pgCustomerToResponse(makeRow(), [kp1, kp2]);

    expect(c['Key person 1']).toBe('Bob');
    expect(c['Key person 1 (Name + Contact details)']).toBe('Bob');
    expect(c['Key person 1 (important DATE)']).toBe('1990-03-15');
    expect(c['Key person 2']).toBe('Carol');
    expect(c['Key person 2 (important DATE)']).toBeNull();
    expect(c._keyPeople).toHaveLength(2);
  });

  it('returns null for key person slots when keyPeople is empty', () => {
    const c = repo._pgCustomerToResponse(makeRow(), []);
    expect(c['Key person 1']).toBeNull();
    expect(c['Key person 2']).toBeNull();
  });
});

// ── list ──
describe('repo.list', () => {
  it('returns customers sorted by name, without _agg when withAggregates=false', async () => {
    const chain = makeChain([makeRow(), makeRow({ id: 'uuid-cust-2', name: 'Zofia', airtableId: 'recC2' })]);
    db.select.mockReturnValue(chain);

    const result = await repo.list({ withAggregates: false });

    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty('_agg');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('enriches with _agg when withAggregates=true', async () => {
    const custChain = makeChain([makeRow()]);
    const aggChain  = makeChain([{ customerId: 'uuid-cust-1', lastOrderDate: '2026-04-01', orderCount: '3', totalSpend: '450.00' }]);
    db.select.mockReturnValueOnce(custChain).mockReturnValueOnce(aggChain);

    const result = await repo.list({ withAggregates: true });

    expect(result[0]._agg).toEqual({ lastOrderDate: '2026-04-01', orderCount: 3, totalSpend: 450 });
  });

  it('empty _agg for customers with no orders', async () => {
    const custChain = makeChain([makeRow()]);
    const aggChain  = makeChain([]);  // no aggregate rows
    db.select.mockReturnValueOnce(custChain).mockReturnValueOnce(aggChain);

    const result = await repo.list({ withAggregates: true });

    expect(result[0]._agg).toEqual({ lastOrderDate: null, orderCount: 0, totalSpend: 0 });
  });
});

// ── getById ──
describe('repo.getById', () => {
  it('returns customer with computedSegment=Constant for 10+ orders', async () => {
    const custChain  = makeChain([makeRow()]);
    const kpChain    = makeChain([]);
    const countChain = makeChain([{ count: '12' }]);
    db.select
      .mockReturnValueOnce(custChain)
      .mockReturnValueOnce(kpChain)
      .mockReturnValueOnce(countChain);

    const c = await repo.getById('uuid-cust-1');

    expect(c.computedSegment).toBe('Constant');
  });

  it('computedSegment=New for 1 order', async () => {
    const custChain  = makeChain([makeRow()]);
    const kpChain    = makeChain([]);
    const countChain = makeChain([{ count: '1' }]);
    db.select
      .mockReturnValueOnce(custChain)
      .mockReturnValueOnce(kpChain)
      .mockReturnValueOnce(countChain);

    const c = await repo.getById('uuid-cust-1');
    expect(c.computedSegment).toBe('New');
  });

  it('throws 404-shaped error when customer not found', async () => {
    db.select.mockReturnValue(makeChain([]));

    await expect(repo.getById('no-such-uuid')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── create ──
describe('repo.create', () => {
  it('maps Airtable field names to PG columns and returns response-shaped object', async () => {
    const insertedRow = makeRow();
    const insertChain = { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([insertedRow]) }) };
    const kpChain = makeChain([]);
    db.insert.mockReturnValue(insertChain);
    db.select.mockReturnValue(kpChain);

    const result = await repo.create({ Name: 'Alice Kowalska', Phone: '+48 555 000 001', Segment: 'Rare' });

    expect(db.insert).toHaveBeenCalled();
    const insertedValues = insertChain.values.mock.calls[0][0];
    expect(insertedValues.name).toBe('Alice Kowalska');
    expect(insertedValues.phone).toBe('+48 555 000 001');
    expect(insertedValues.segment).toBe('Rare');
    // Wire format: result has Name, not name
    expect(result.Name).toBe('Alice Kowalska');
  });

  it('throws 400 when Name and Nickname are both missing', async () => {
    await expect(repo.create({ Phone: '+48 000' })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ── update ──
describe('repo.update', () => {
  it('maps Segment alias → segment column', async () => {
    const updatedRow = makeRow({ segment: 'VIP' });
    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedRow]) }) }) };
    const kpChain = makeChain([]);
    db.update.mockReturnValue(updateChain);
    db.select.mockReturnValue(kpChain);

    const result = await repo.update('uuid-cust-1', { Segment: 'VIP' });

    const setCall = updateChain.set.mock.calls[0][0];
    expect(setCall).toHaveProperty('segment', 'VIP');
    expect(result.Segment).toBe('VIP');
  });

  it('throws 400 when no recognised fields are in the patch body', async () => {
    await expect(repo.update('uuid-cust-1', { BogusField: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ── listOrders ──
describe('repo.listOrders', () => {
  it('merges legacy + app orders, sorts date-desc, nulls last', async () => {
    const appRow = {
      id: 'order-uuid-1', source: 'app', orderDate: '2026-03-20',
      customerRequest: 'Pink roses', priceOverride: '300.00', status: 'Delivered',
    };
    const legacyRow = {
      id: 'lo-uuid-1', source: 'legacy', orderDate: '2023-04-15',
      description: 'Roses — Birthday', amount: '150.00',
    };
    const nullDateRow = {
      id: 'lo-uuid-2', source: 'legacy', orderDate: null,
      description: 'Tulips', amount: '0',
    };

    // repo does two selects (app orders + legacy orders) and merges
    const appChain    = makeChain([appRow]);
    const legacyChain = makeChain([legacyRow, nullDateRow]);
    db.select.mockReturnValueOnce(appChain).mockReturnValueOnce(legacyChain);

    const merged = await repo.listOrders('uuid-cust-1');

    expect(merged).toHaveLength(3);
    expect(merged[0].source).toBe('app');
    expect(merged[0].date).toBe('2026-03-20');
    expect(merged[0].amount).toBe(300);
    expect(merged[1].source).toBe('legacy');
    expect(merged[1].date).toBe('2023-04-15');
    expect(merged[2].date).toBeNull();
  });

  it('returns empty array when no orders exist', async () => {
    db.select.mockReturnValue(makeChain([]));
    const result = await repo.listOrders('uuid-cust-1');
    expect(result).toEqual([]);
  });
});

// ── getAggregateMap — caching ──
describe('repo.getAggregateMap — caching', () => {
  it('caches result; second call uses the same object without a new DB query', async () => {
    const aggChain = makeChain([
      { customerId: 'uuid-c1', lastOrderDate: '2026-04-01', orderCount: '2', totalSpend: '500.00' },
    ]);
    db.select.mockReturnValue(aggChain);

    const first  = await repo.getAggregateMap();
    const second = await repo.getAggregateMap();

    expect(first).toBe(second);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('recomputes after cache reset', async () => {
    db.select.mockReturnValue(makeChain([]));

    await repo.getAggregateMap();
    repo._resetAggregateCache();
    await repo.getAggregateMap();

    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they all fail (red phase)**

```bash
cd backend && npx vitest run src/__tests__/customerRepo.test.js
```

Expected: all tests FAIL — `repo._pgCustomerToResponse is not a function` (or similar import error, since the repo still has old Airtable implementation).

- [ ] **Step 4.3: Write the PG customerRepo implementation**

Replace the entire content of `backend/src/repos/customerRepo.js`:

```js
// Customer repository — Phase 5 Postgres implementation.
//
// Public API is identical to the Airtable version so routes and frontends
// need no changes. Wire format uses Airtable field names (Name, Phone, etc.)
// mapped from PG column names (name, phone, etc.) in pgCustomerToResponse().
//
// Key person 1 / Key person 2 fields map to the first two key_people rows
// (ordered by created_at) for backward compat with KeyPersonChips.jsx.

import { db } from '../db/index.js';
import { customers, keyPeople, legacyOrders, orders } from '../db/schema.js';
import {
  eq, and, or, ilike, like, isNull, asc, desc, sql,
} from 'drizzle-orm';

// ── Field mapping: request body → PG column ──
const PATCH_MAP = {
  'Name':               'name',
  'Nickname':           'nickname',
  'Phone':              'phone',
  'Email':              'email',
  'Link':               'link',
  'Language':           'language',
  'Home address':       'homeAddress',
  'Sex / Business':     'sexBusiness',
  'Segment':            'segment',
  'Segment (client)':   'segment',
  'Found us from':      'foundUsFrom',
  'Communication method': 'communicationMethod',
  'Order Source':       'orderSource',
};

// Key person patches: field name → { slot (0|1), prop ('name'|'importantDate') }
const KP_PATCH_MAP = {
  'Key person 1':                          { slot: 0, prop: 'name' },
  'Key person 1 (Name + Contact details)': { slot: 0, prop: 'name' },
  'Key person 1 (important DATE)':         { slot: 0, prop: 'importantDate' },
  'Key person 2':                          { slot: 1, prop: 'name' },
  'Key person 2 (Name + Contact details)': { slot: 1, prop: 'name' },
  'Key person 2 (important DATE)':         { slot: 1, prop: 'importantDate' },
};

// ── Wire format ──
export function _pgCustomerToResponse(row, kps = [], agg = null) {
  const kp1 = kps[0] ?? null;
  const kp2 = kps[1] ?? null;
  return {
    id:   row.id,
    Name: row.name,
    Nickname: row.nickname ?? null,
    Phone:    row.phone ?? null,
    Email:    row.email ?? null,
    Link:     row.link ?? null,
    Language: row.language ?? null,
    'Home address':       row.homeAddress ?? null,
    'Sex / Business':     row.sexBusiness ?? null,
    Segment:              row.segment ?? null,
    'Segment (client)':   row.segment ?? null,
    'Found us from':      row.foundUsFrom ?? null,
    'Communication method': row.communicationMethod ?? null,
    'Order Source':       row.orderSource ?? null,
    // Key people — first two slots for backward compat with KeyPersonChips.jsx
    'Key person 1':                          kp1?.name ?? null,
    'Key person 1 (Name + Contact details)': kp1?.name ?? null,
    'Key person 1 (important DATE)':         kp1?.importantDate ?? null,
    'Key person 2':                          kp2?.name ?? null,
    'Key person 2 (Name + Contact details)': kp2?.name ?? null,
    'Key person 2 (important DATE)':         kp2?.importantDate ?? null,
    _keyPeople: kps,
    // Aggregate (when enriched by list())
    ...(agg != null ? { _agg: agg } : {}),
  };
}

// ── Aggregate cache ──
const AGG_TTL_MS = 60 * 1000;
let aggCache = { data: null, computedAt: 0 };

export function _resetAggregateCache() {
  aggCache = { data: null, computedAt: 0 };
}

async function computeAggregateMap() {
  // Single UNION ALL query across orders + legacy_orders, GROUP BY customer_id.
  // Returns one row per customer that has at least one order.
  const rows = await db.select({
    customerId:    sql`customer_id`,
    lastOrderDate: sql`MAX(order_date)::text`,
    orderCount:    sql`COUNT(*)`,
    totalSpend:    sql`SUM(amount)`,
  }).from(
    sql`(
      SELECT customer_id, order_date, COALESCE(price_override, 0) AS amount
      FROM ${orders}
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT customer_id, order_date, COALESCE(amount, 0) AS amount
      FROM ${legacyOrders}
    ) combined`,
  ).groupBy(sql`customer_id`);

  const map = {};
  for (const r of rows) {
    map[r.customerId] = {
      lastOrderDate: r.lastOrderDate || null,
      orderCount:    Number(r.orderCount),
      totalSpend:    Number(r.totalSpend || 0),
    };
  }
  return map;
}

const EMPTY_AGG = { lastOrderDate: null, orderCount: 0, totalSpend: 0 };

export async function getAggregateMap() {
  if (aggCache.data && Date.now() - aggCache.computedAt < AGG_TTL_MS) {
    return aggCache.data;
  }
  const data = await computeAggregateMap();
  aggCache = { data, computedAt: Date.now() };
  return data;
}

// ── Public API ──

export async function list({ search, withAggregates = true } = {}) {
  const filters = [isNull(customers.deletedAt)];
  if (search) {
    filters.push(or(
      ilike(customers.name,     `%${search}%`),
      ilike(customers.nickname, `%${search}%`),
      like(customers.phone,     `%${search}%`),
      ilike(customers.link,     `%${search}%`),
      ilike(customers.email,    `%${search}%`),
    ));
  }

  const [rows, aggMap] = await Promise.all([
    db.select().from(customers).where(and(...filters)).orderBy(asc(customers.name)),
    withAggregates ? getAggregateMap() : Promise.resolve({}),
  ]);

  return rows.map(row => _pgCustomerToResponse(
    row,
    [],  // key_people not fetched in list() — only in getById()
    withAggregates ? (aggMap[row.id] ?? EMPTY_AGG) : undefined,
  ));
}

export async function getById(id) {
  const rows = await db.select().from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
  if (rows.length === 0) {
    const err = new Error('Customer not found.');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];

  const [kps, countRows] = await Promise.all([
    db.select().from(keyPeople)
      .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
      .orderBy(asc(keyPeople.createdAt))
      .limit(2),
    db.select({ count: sql`COUNT(*)` }).from(orders)
      .where(and(eq(orders.customerId, id), isNull(orders.deletedAt))),
  ]);

  const orderCount = Number(countRows[0]?.count || 0);
  const computedSegment =
    orderCount >= 10 ? 'Constant' :
    orderCount >= 2  ? 'Rare' :
    orderCount >= 1  ? 'New' : null;

  const customer = _pgCustomerToResponse(row, kps);
  customer.computedSegment = computedSegment;
  return customer;
}

export async function create(fields) {
  if (!fields.Name && !fields.Nickname) {
    const err = new Error('Name or Nickname is required.');
    err.statusCode = 400;
    throw err;
  }

  const colValues = {};
  for (const [airtableField, pgCol] of Object.entries(PATCH_MAP)) {
    if (airtableField in fields) colValues[pgCol] = fields[airtableField] ?? null;
  }

  const [inserted] = await db.insert(customers).values(colValues).returning();
  const kps = await db.select().from(keyPeople)
    .where(and(eq(keyPeople.customerId, inserted.id), isNull(keyPeople.deletedAt)))
    .orderBy(asc(keyPeople.createdAt)).limit(2);
  return _pgCustomerToResponse(inserted, kps);
}

export async function update(id, fields) {
  // Split: customer column patches vs key_people patches
  const colValues = {};
  const kpChanges = {};  // { 0: { name?, importantDate? }, 1: { name?, importantDate? } }

  for (const [field, value] of Object.entries(fields)) {
    if (field in PATCH_MAP) {
      colValues[PATCH_MAP[field]] = value ?? null;
    } else if (field in KP_PATCH_MAP) {
      const { slot, prop } = KP_PATCH_MAP[field];
      if (!kpChanges[slot]) kpChanges[slot] = {};
      kpChanges[slot][prop] = value ?? null;
    }
  }

  if (Object.keys(colValues).length === 0 && Object.keys(kpChanges).length === 0) {
    const err = new Error('No valid fields to update.');
    err.statusCode = 400;
    throw err;
  }

  let updatedRow;
  if (Object.keys(colValues).length > 0) {
    const rows = await db.update(customers)
      .set(colValues)
      .where(eq(customers.id, id))
      .returning();
    updatedRow = rows[0];
  } else {
    const rows = await db.select().from(customers).where(eq(customers.id, id));
    updatedRow = rows[0];
  }

  if (!updatedRow) {
    const err = new Error('Customer not found.');
    err.statusCode = 404;
    throw err;
  }

  // Apply key_people changes: get current first-two, upsert by slot position.
  if (Object.keys(kpChanges).length > 0) {
    const existing = await db.select().from(keyPeople)
      .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
      .orderBy(asc(keyPeople.createdAt)).limit(2);

    for (const [slotStr, changes] of Object.entries(kpChanges)) {
      const slot = Number(slotStr);
      const row  = existing[slot];

      if (changes.name === null || changes.name === '') {
        // Clear: soft-delete the key person row if it exists.
        if (row) {
          await db.update(keyPeople)
            .set({ deletedAt: new Date() })
            .where(eq(keyPeople.id, row.id));
        }
      } else if (row) {
        await db.update(keyPeople)
          .set({ name: changes.name ?? row.name, importantDate: 'importantDate' in changes ? changes.importantDate : row.importantDate })
          .where(eq(keyPeople.id, row.id));
      } else if (changes.name) {
        await db.insert(keyPeople).values({ customerId: id, name: changes.name, importantDate: changes.importantDate ?? null });
      }
    }
  }

  const kps = await db.select().from(keyPeople)
    .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
    .orderBy(asc(keyPeople.createdAt)).limit(2);

  return _pgCustomerToResponse(updatedRow, kps);
}

export async function listOrders(customerId) {
  const [appRows, legacyRows] = await Promise.all([
    db.select({
      id:     orders.id,
      date:   orders.orderDate,
      description: orders.customerRequest,
      amount: orders.priceOverride,
      status: orders.status,
    }).from(orders)
      .where(and(eq(orders.customerId, customerId), isNull(orders.deletedAt))),
    db.select({
      id:     legacyOrders.id,
      date:   legacyOrders.orderDate,
      description: legacyOrders.description,
      amount: legacyOrders.amount,
    }).from(legacyOrders)
      .where(eq(legacyOrders.customerId, customerId)),
  ]);

  const normalizedApp = appRows.map(r => ({
    id:          r.id,
    source:      'app',
    date:        r.date || null,
    description: r.description || '',
    amount:      Number(r.amount || 0),
    status:      r.status || null,
    link:        `/orders/${r.id}`,
    lines:       null,
    raw:         r,
  }));

  const normalizedLegacy = legacyRows.map(r => ({
    id:          r.id,
    source:      'legacy',
    date:        r.date || null,
    description: r.description || '',
    amount:      Number(r.amount || 0),
    status:      null,
    link:        null,
    lines:       null,
    raw:         r,
  }));

  return [...normalizedApp, ...normalizedLegacy].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}
```

- [ ] **Step 4.4: Run tests — all must pass (green phase)**

```bash
cd backend && npx vitest run src/__tests__/customerRepo.test.js
```

Expected: all tests PASS. Fix any failures before continuing.

- [ ] **Step 4.5: Commit**

```bash
git add backend/src/repos/customerRepo.js backend/src/__tests__/customerRepo.test.js
git commit -m "feat(repo): Phase 5 — customerRepo.js PG implementation + new test suite"
```

---

## Task 5: Update insights route for PG

**Files:**
- Modify: `backend/src/routes/customers.js`

The insights route uses `db.list(TABLES.ORDERS, ...)` from Airtable for churn-risk computation, and reads `c['App Order Count']` / `c['App Total Spend']` from Airtable formula fields. After Phase 5, all of these come from PG.

- [ ] **Step 5.1: Update imports in customers.js**

At the top of `backend/src/routes/customers.js`, replace:

```js
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import * as customerRepo from '../repos/customerRepo.js';
```

with:

```js
import { db as pgDb } from '../db/index.js';
import { orders } from '../db/schema.js';
import { isNull, desc } from 'drizzle-orm';
import * as customerRepo from '../repos/customerRepo.js';
```

- [ ] **Step 5.2: Replace Airtable order fetch in insights route**

In the insights route handler, find the block:

```js
const recentOrders = await db.list(TABLES.ORDERS, {
  sort: [{ field: 'Order Date', direction: 'desc' }],
  fields: ['Customer', 'Order Date'],
  maxRecords: 500,
});
```

Replace with:

```js
const recentOrders = await pgDb.select({
  customerId: orders.customerId,
  orderDate:  orders.orderDate,
}).from(orders)
  .where(isNull(orders.deletedAt))
  .orderBy(desc(orders.orderDate))
  .limit(500);
```

- [ ] **Step 5.3: Update lastOrderByCustomer mapping**

Find:

```js
const lastOrderByCustomer = {};
for (const o of recentOrders) {
  const cid = o.Customer?.[0];
  if (cid && !lastOrderByCustomer[cid]) {
    lastOrderByCustomer[cid] = o['Order Date'];
  }
}
```

Replace with:

```js
const lastOrderByCustomer = {};
for (const o of recentOrders) {
  const cid = o.customerId;
  if (cid && !lastOrderByCustomer[cid]) {
    lastOrderByCustomer[cid] = o.orderDate;
  }
}
```

- [ ] **Step 5.4: Update churn risk filter to use _agg**

Find:

```js
const churnRisk = customers
  .filter(c => {
    if ((c['App Order Count'] || 0) < 2) return false;
    if (c.Segment === 'DO NOT CONTACT') return false;
```

Replace with:

```js
const churnRisk = customers
  .filter(c => {
    if ((c._agg?.orderCount || 0) < 2) return false;
    if (c.Segment === 'DO NOT CONTACT') return false;
```

- [ ] **Step 5.5: Update churnRisk map response fields**

Find:

```js
      return {
        id: c.id,
        Name: c.Name,
        Nickname: c.Nickname,
        Segment: c.Segment,
        'App Total Spend': c['App Total Spend'] || 0,
        'App Order Count': c['App Order Count'] || 0,
```

Replace with:

```js
      return {
        id: c.id,
        Name: c.Name,
        Nickname: c.Nickname,
        Segment: c.Segment,
        'App Total Spend': c._agg?.totalSpend || 0,
        'App Order Count': c._agg?.orderCount || 0,
```

- [ ] **Step 5.6: Update topCustomers filter to use _agg**

Find:

```js
const topCustomers = customers
  .filter(c => (c['App Total Spend'] || 0) > 0)
  .sort((a, b) => (b['App Total Spend'] || 0) - (a['App Total Spend'] || 0))
  .slice(0, 10);
```

Replace with:

```js
const topCustomers = customers
  .filter(c => (c._agg?.totalSpend || 0) > 0)
  .sort((a, b) => (b._agg?.totalSpend || 0) - (a._agg?.totalSpend || 0))
  .slice(0, 10);
```

- [ ] **Step 5.7: Update segmentRevenue and computedSegment to use _agg**

Find:

```js
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segmentRevenue[seg] = (segmentRevenue[seg] || 0) + (c['App Total Spend'] || 0);
    }
```

Replace with:

```js
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segmentRevenue[seg] = (segmentRevenue[seg] || 0) + (c._agg?.totalSpend || 0);
    }
```

Find the RFM section:

```js
      const frequencyValues = scoredCustomers.map(c => c['App Order Count'] || 0);
      const monetaryValues = scoredCustomers.map(c => c['App Total Spend'] || 0);
```

Replace with:

```js
      const frequencyValues = scoredCustomers.map(c => c._agg?.orderCount || 0);
      const monetaryValues = scoredCustomers.map(c => c._agg?.totalSpend || 0);
```

Find the rfmByCustomer loop:

```js
      scoredCustomers.forEach((c, i) => {
        const label = rfmLabel(rScores[i], fScores[i], mScores[i]);
        const spend = c['App Total Spend'] || 0;
```

Replace with:

```js
      scoredCustomers.forEach((c, i) => {
        const label = rfmLabel(rScores[i], fScores[i], mScores[i]);
        const spend = c._agg?.totalSpend || 0;
```

Find the computedSegment block at the bottom of insights:

```js
    for (const c of customers) {
      const count = c['App Order Count'] || 0;
      c.computedSegment = count >= 10 ? 'Constant' : count >= 2 ? 'Rare' : count >= 1 ? 'New' : null;
    }
```

Replace with:

```js
    for (const c of customers) {
      const count = c._agg?.orderCount || 0;
      c.computedSegment = count >= 10 ? 'Constant' : count >= 2 ? 'Rare' : count >= 1 ? 'New' : null;
    }
```

- [ ] **Step 5.8: Run backend test suite**

```bash
cd backend && npx vitest run
```

Expected: all tests pass. The customerRepo tests and any existing order/stock tests should all be green.

- [ ] **Step 5.9: Commit**

```bash
git add backend/src/routes/customers.js
git commit -m "feat(routes): insights route — replace Airtable order fetch with Drizzle PG query"
```

---

## Task 6: Harness seed + E2E section 26

**Files:**
- Modify: `backend/src/routes/test.js`
- Modify: `scripts/e2e-test.js`

After Phase 5, `customerRepo.js` reads from PG only. The harness must seed customers from the mock fixture so the E2E suite has data to query.

- [ ] **Step 6.1: Import new schema tables in test.js**

In `backend/src/routes/test.js`, update the schema import line:

```js
import { auditLog, parityLog, stock, orders, orderLines, deliveries } from '../db/schema.js';
```

to:

```js
import { auditLog, parityLog, stock, orders, orderLines, deliveries, customers, keyPeople, legacyOrders } from '../db/schema.js';
```

- [ ] **Step 6.2: Truncate new tables in the reset route**

In the reset handler in `test.js`, find the block that truncates PG tables (look for `await db.delete(auditLog)` or similar). Add truncates for the new tables:

```js
await db.delete(legacyOrders);
await db.delete(keyPeople);
await db.delete(customers);
```

These must run BEFORE the orders truncate (due to FK from orders.key_person_id → key_people). If orders are truncated first, key_people truncate is safe (no FK violation). The safest order is: legacyOrders → keyPeople → customers → everything else. If the existing code truncates orders already, add the three new deletes BEFORE orders. Exact placement: look for `await db.delete(orderLines)` and add these lines immediately before it.

- [ ] **Step 6.3: Seed customers in seedPgFromFixture()**

In `backend/src/routes/test.js`, in the `seedPgFromFixture()` function, after the stock seed block, add:

```js
  // Seed customers from the mock fixture (Phase 5 — customerRepo reads PG).
  const customerRows = [..._getTable(TABLES.CUSTOMERS).values()];
  const customerIdMap = new Map(); // airtable recXXX → PG uuid
  for (const r of customerRows) {
    const [inserted] = await db.insert(customers).values({
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
    }).returning();
    customerIdMap.set(r.id, inserted.id);
  }

  // After customers are inserted, update orders.customer_id from recXXX → UUID string.
  // This mirrors what backfill-customer-fk.js does on prod.
  for (const [atId, pgId] of customerIdMap.entries()) {
    await db.execute(sql`
      UPDATE orders SET customer_id = ${pgId}
      WHERE customer_id = ${atId}
    `);
  }
```

Also add `sql` to the imports from `drizzle-orm` at the top of `test.js`:

```js
import { sql } from 'drizzle-orm';
```

And add `TABLES.CUSTOMERS` — ensure `TABLES` is already imported (it should be from the existing `import { TABLES } from '../config/airtable.js'` line).

Update the return value of `seedPgFromFixture()` to include the customer count:

```js
return { stock: stockInserts.length, orders: orderCount, lines: lineCount, deliveries: deliveryCount, customers: customerRows.length };
```

- [ ] **Step 6.4: Add E2E section 26 to scripts/e2e-test.js**

Near the end of `scripts/e2e-test.js`, before the final summary/exit block, add a new section:

```js
// ── Section 26: Customer CRUD via PG (Phase 5) ──
{
  await reset();

  // 26.1 List returns seeded customers with _agg
  const listResp = await fetch(`${BASE}/customers`, { headers: ownerH });
  eq('26.1 GET /customers → 200', listResp.status, 200);
  const custList = await listResp.json();
  assert('26.1 List has 5 seeded customers', custList.length === 5);
  assert('26.1 First customer has _agg', typeof custList[0]._agg === 'object');
  assert('26.1 Maria in list', custList.some(c => c.Name === 'Maria Kowalska'));

  // 26.2 Get by UUID
  const maria = custList.find(c => c.Name === 'Maria Kowalska');
  const getResp = await fetch(`${BASE}/customers/${maria.id}`, { headers: ownerH });
  eq('26.2 GET /customers/:uuid → 200', getResp.status, 200);
  const mariaDet = await getResp.json();
  eq('26.2 Detail id matches', mariaDet.id, maria.id);
  assert('26.2 computedSegment present', 'computedSegment' in mariaDet);

  // 26.3 Create new customer → PG row with UUID
  const createResp = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { ...ownerH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Name: 'Nowa Klientka', Phone: '+48 999 000 111' }),
  });
  eq('26.3 POST /customers → 201', createResp.status, 201);
  const newCust = await createResp.json();
  assert('26.3 New customer has UUID id', newCust.id.length > 20);
  eq('26.3 Name preserved', newCust.Name, 'Nowa Klientka');

  // 26.4 Patch customer
  const patchResp = await fetch(`${BASE}/customers/${newCust.id}`, {
    method: 'PATCH',
    headers: { ...ownerH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Segment: 'New', 'Key person 1': 'Jan Kowalski' }),
  });
  eq('26.4 PATCH /customers/:id → 200', patchResp.status, 200);
  const patched = await patchResp.json();
  eq('26.4 Segment updated', patched.Segment, 'New');
  eq('26.4 Key person 1 persisted', patched['Key person 1'], 'Jan Kowalski');

  // 26.5 Order history returns empty for new customer
  const ordersResp = await fetch(`${BASE}/customers/${newCust.id}/orders`, { headers: ownerH });
  eq('26.5 GET /customers/:id/orders → 200', ordersResp.status, 200);
  const custOrders = await ordersResp.json();
  assert('26.5 Empty order history for new customer', Array.isArray(custOrders) && custOrders.length === 0);

  // 26.6 POST /customers → 400 when name missing
  const badResp = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { ...ownerH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Phone: '+48 000' }),
  });
  eq('26.6 Missing name → 400', badResp.status, 400);

  // 26.7 Florist cannot access /customers
  const floristResp = await fetch(`${BASE}/customers`, { headers: floristH });
  eq('26.7 Florist blocked from /customers', floristResp.status, 403);

  console.log('✓ Section 26: Customer CRUD via PG — all assertions passed');
}
```

At the top of the file, verify `ownerH` and `floristH` are already defined (they should be — other sections use them). If not, add:

```js
const ownerH   = { 'X-Auth-PIN': PIN_OWNER };
const floristH = { 'X-Auth-PIN': PIN_FLORIST };
```

- [ ] **Step 6.5: Boot harness and run E2E suite**

```bash
npm run harness &
sleep 3
node scripts/e2e-test.js 2>&1 | tail -40
```

Expected: all 26 sections pass. Section 26 should show "✓ Section 26: Customer CRUD via PG — all assertions passed".

Kill the harness after: `kill %1`

- [ ] **Step 6.6: Commit**

```bash
git add backend/src/routes/test.js scripts/e2e-test.js
git commit -m "test(harness): seed customers in PG; add E2E section 26 for Phase 5 customer CRUD"
```

---

## Task 7: Pre-PR verification

**No new files — verification pass only.**

- [ ] **Step 7.1: Run full backend test suite**

```bash
cd backend && npx vitest run
```

Expected: all tests PASS. Note any failures and fix before continuing.

- [ ] **Step 7.2: Boot harness and run full E2E suite**

```bash
npm run harness &
sleep 3
node scripts/e2e-test.js
```

Expected: all 26 sections pass. Section 26 must pass. No regressions in sections 1–25.

Kill harness: `kill %1`

- [ ] **Step 7.3: Verify no silent catch blocks introduced**

```bash
grep -n 'catch.*{[[:space:]]*}' backend/src/repos/customerRepo.js backend/src/routes/customers.js backend/scripts/backfill-*.js
```

Expected: no output (no empty catch blocks).

- [ ] **Step 7.4: Build all three frontend apps (shared-dep safety check)**

```bash
cd apps/florist   && ./node_modules/.bin/vite build 2>&1 | tail -5
cd ../dashboard   && ./node_modules/.bin/vite build 2>&1 | tail -5
cd ../delivery    && ./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: all three exit 0 with "built in X.XXs". Frontend code is unchanged, but building verifies no import breakage from schema.js changes.

- [ ] **Step 7.5: Commit and push**

```bash
git status
# Confirm nothing unstaged
git log --oneline -6
```

Then open PR. PR description must include:
- The 6 task commits from this plan
- Verification: "E2E suite: all 26 sections pass. Backend vitest: X passing. All 3 frontend builds: clean."
- Note on production cutover sequence: migration 0006 deploys first, then owner runs 3 backfill scripts in order, then PR is merged.

---

## Production cutover sequence

This is NOT automated. After the PR merges and Railway redeploys:

1. **Migration runs automatically** at Railway boot (pglite-style runner is Railway's `npm run migrate` step — confirm with `CHANGELOG.md`).
2. **Owner runs dedup script**: `node backend/scripts/find-customer-duplicates.js` — repeat until 0 pairs.
3. **Owner runs backfill scripts in order** (with `APPROVE=yes`):
   - `backfill-customers.js`
   - `backfill-legacy-orders.js`
   - `backfill-customer-fk.js`
4. **Verify**: `GET /api/customers` returns PG UUIDs. Dashboard Customer tab shows full timeline. Creating an order creates a new `customers` row in PG.
5. **"Done" criteria** (from execution plan §5e):
   - `find-customer-duplicates.js` reports 0 pairs on PG data
   - Dashboard Customer tab shows combined legacy + app timeline
   - New orders create customers rows in PG (UUIDs in `id`)
   - `key_people` rows exist for customers who had Airtable Key person 1/2 data

---

## Out of scope

- Key Person autocomplete at order creation (issue #216) — blocked on this phase being stable
- Multiple important dates per Key Person (issue #217)
- Formal `orders.customer_id` FK constraint (ALTER COLUMN text → uuid) — deferred until data is fully clean; backfill-customer-fk.js gets us data integrity without the constraint
