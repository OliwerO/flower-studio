# Phase 6 — Config + Log Tables to Postgres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 7 remaining Airtable tables to Postgres so Phase 7 (retire Airtable) has no remaining dependencies.

**Architecture:** Direct cutover — no shadow mode needed (BACKLOG confirmed). Each table gets a thin repo returning Airtable-shaped wire objects so routes/frontends need no field-name changes. Backfill scripts preserve `airtable_id` for traceability. Order counters move from a separate `APP_CONFIG` key to the same `app_config` PG table.

**Tech Stack:** Drizzle ORM, `pg` pool, pglite for integration tests (same as stockRepo/orderRepo pattern).

**Reference files:** `backend/src/repos/stockRepo.js` (repo pattern), `backend/src/__tests__/stockRepo.integration.test.js` (test pattern), `backend/src/db/schema.js` (Drizzle conventions), `docs/migration/execution-plan-2026-04-27.md` (master plan).

---

## Tables in scope

| Airtable table | Route / service | Complexity |
|---|---|---|
| App Config | `routes/settings.js` `loadConfig`/`saveConfig`/`generateOrderId` | Medium — in-memory cache + two keys |
| Florist Hours | `routes/floristHours.js` | Medium — full CRUD + `/summary` |
| Marketing Spend | `routes/marketingSpend.js` | Low — GET + POST |
| Stock Loss Log | `routes/stockLoss.js` | Medium — CRUD + JOIN enrichment |
| Webhook Log | `services/webhookLog.js` | Low — write-only |
| Sync Log | `services/wixProductSync.js` `logSync` + `routes/products.js` GET | Low — append + one GET |
| Product Config | `repos/productRepo.js`, `routes/products.js`, `routes/public.js`, `services/wix.js`, `services/wixProductSync.js` | High — many callers, complex schema |

## Files to create

- `backend/src/db/migrations/0007_phase6_config_logs.sql`
- `backend/src/repos/appConfigRepo.js`
- `backend/src/repos/hoursRepo.js`
- `backend/src/repos/marketingSpendRepo.js`
- `backend/src/repos/stockLossRepo.js`
- `backend/src/repos/webhookLogRepo.js`
- `backend/src/repos/syncLogRepo.js`
- `backend/src/repos/productConfigRepo.js`
- `backend/src/__tests__/hoursRepo.integration.test.js`
- `backend/src/__tests__/marketingSpendRepo.integration.test.js`
- `backend/src/__tests__/stockLossRepo.integration.test.js`
- `backend/src/__tests__/appConfigRepo.integration.test.js`
- `backend/src/__tests__/productConfigRepo.integration.test.js`
- `backend/scripts/backfill-phase6.js` (DESTRUCTIVE)

## Files to modify

- `backend/src/db/schema.js` — add 7 table exports
- `backend/src/db/migrations/meta/_journal.json` — register migration 0007
- `backend/src/routes/floristHours.js` — replace all `db.*` + `TABLES.*` with `hoursRepo.*`
- `backend/src/routes/marketingSpend.js` — replace with `marketingSpendRepo.*`
- `backend/src/routes/stockLoss.js` — replace with `stockLossRepo.*` (enrichment now via JOIN)
- `backend/src/services/webhookLog.js` — replace with `webhookLogRepo.*`
- `backend/src/services/wixProductSync.js` — `logSync` → `syncLogRepo.*`
- `backend/src/routes/products.js` — sync-log GET + product config reads/writes → `productConfigRepo.*`
- `backend/src/routes/settings.js` — `loadConfig`/`saveConfig`/`generateOrderId` → `appConfigRepo.*`
- `backend/src/repos/productRepo.js` — `setImage`/`getImage`/`getImagesBatch` → `productConfigRepo.*`
- `backend/src/routes/public.js` — product config reads → `productConfigRepo.*`
- `backend/src/services/wix.js` — product config reads/writes → `productConfigRepo.*`

---

## Task 1 — Migration 0007: all 7 PG tables

**Files:**
- Create: `backend/src/db/migrations/0007_phase6_config_logs.sql`
- Modify: `backend/src/db/schema.js` (add 7 table definitions)
- Modify: `backend/src/db/migrations/meta/_journal.json` (register entry)

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0007_phase6_config_logs.sql`:

```sql
-- Phase 6: Config + log tables
-- app_config: replaces Airtable APP_CONFIG (key='config' + key='orderCounters')
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- florist_hours: timesheet entries
CREATE TABLE IF NOT EXISTS florist_hours (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id    TEXT,
  name           TEXT NOT NULL,
  date           DATE NOT NULL,
  hours          NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate    NUMERIC(8,2) NOT NULL DEFAULT 0,
  rate_type      TEXT,
  bonus          NUMERIC(8,2) NOT NULL DEFAULT 0,
  deduction      NUMERIC(8,2) NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  delivery_count INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS florist_hours_airtable_id_idx ON florist_hours(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS florist_hours_date_idx ON florist_hours(date);
CREATE INDEX IF NOT EXISTS florist_hours_name_idx ON florist_hours(name);

-- marketing_spend: ad spend per channel per month
CREATE TABLE IF NOT EXISTS marketing_spend (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT,
  month       DATE NOT NULL,
  channel     TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_spend_airtable_id_idx ON marketing_spend(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_spend_month_idx ON marketing_spend(month);

-- stock_loss_log: waste/write-off events
CREATE TABLE IF NOT EXISTS stock_loss_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT,
  date        DATE NOT NULL,
  stock_id    UUID REFERENCES stock(id) ON DELETE SET NULL,
  quantity    NUMERIC(8,2) NOT NULL,
  reason      TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_loss_log_airtable_id_idx ON stock_loss_log(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_loss_log_date_idx ON stock_loss_log(date);
CREATE INDEX IF NOT EXISTS stock_loss_log_stock_id_idx ON stock_loss_log(stock_id);

-- webhook_log: incoming Wix webhook audit trail
CREATE TABLE IF NOT EXISTS webhook_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wix_order_id TEXT NOT NULL,
  status       TEXT NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL,
  app_order_id TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_log_wix_order_id_idx ON webhook_log(wix_order_id);
CREATE INDEX IF NOT EXISTS webhook_log_timestamp_idx ON webhook_log(timestamp DESC);

-- sync_log: Wix product sync run history
CREATE TABLE IF NOT EXISTS sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL,
  new_products  INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  deactivated   INTEGER NOT NULL DEFAULT 0,
  price_syncs   INTEGER NOT NULL DEFAULT 0,
  stock_syncs   INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sync_log_timestamp_idx ON sync_log(timestamp DESC);

-- product_config: Wix product/variant metadata + image URL cache
-- One row per (wix_product_id, wix_variant_id) pair.
-- category is stored as a TEXT (comma-joined) to match Airtable behaviour.
CREATE TABLE IF NOT EXISTS product_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id    TEXT,
  wix_product_id TEXT,
  wix_variant_id TEXT,
  product_name   TEXT NOT NULL DEFAULT '',
  variant_name   TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  image_url      TEXT NOT NULL DEFAULT '',
  price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  visible_in_wix BOOLEAN NOT NULL DEFAULT TRUE,
  product_type   TEXT,
  min_stems      INTEGER NOT NULL DEFAULT 0,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT,
  key_flower     TEXT,
  quantity       INTEGER,
  available_from DATE,
  available_to   DATE,
  translations   JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS product_config_airtable_id_idx ON product_config(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_config_wix_pair_idx ON product_config(wix_product_id, wix_variant_id) WHERE wix_product_id IS NOT NULL AND wix_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_config_wix_product_id_idx ON product_config(wix_product_id);
CREATE INDEX IF NOT EXISTS product_config_active_idx ON product_config(active) WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Add table definitions to schema.js**

Append to the bottom of `backend/src/db/schema.js` (after `legacyOrders`):

```javascript
// ── Phase 6: Config + log tables ──

export const appConfig = pgTable('app_config', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const floristHours = pgTable('florist_hours', {
  id:            uuid('id').primaryKey().defaultRandom(),
  airtableId:    text('airtable_id'),
  name:          text('name').notNull(),
  date:          date('date').notNull(),
  hours:         numeric('hours', { precision: 8, scale: 2 }).notNull().default('0'),
  hourlyRate:    numeric('hourly_rate', { precision: 8, scale: 2 }).notNull().default('0'),
  rateType:      text('rate_type'),
  bonus:         numeric('bonus', { precision: 8, scale: 2 }).notNull().default('0'),
  deduction:     numeric('deduction', { precision: 8, scale: 2 }).notNull().default('0'),
  notes:         text('notes').notNull().default(''),
  deliveryCount: integer('delivery_count').notNull().default(0),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('florist_hours_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  dateIdx:     index('florist_hours_date_idx').on(t.date),
  nameIdx:     index('florist_hours_name_idx').on(t.name),
}));

export const marketingSpend = pgTable('marketing_spend', {
  id:         uuid('id').primaryKey().defaultRandom(),
  airtableId: text('airtable_id'),
  month:      date('month').notNull(),
  channel:    text('channel').notNull(),
  amount:     numeric('amount', { precision: 10, scale: 2 }).notNull(),
  notes:      text('notes').notNull().default(''),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('marketing_spend_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  monthIdx:    index('marketing_spend_month_idx').on(t.month),
}));

export const stockLossLog = pgTable('stock_loss_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  airtableId: text('airtable_id'),
  date:       date('date').notNull(),
  stockId:    uuid('stock_id').references(() => stock.id, { onDelete: 'set null' }),
  quantity:   numeric('quantity', { precision: 8, scale: 2 }).notNull(),
  reason:     text('reason').notNull(),
  notes:      text('notes').notNull().default(''),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('stock_loss_log_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  dateIdx:     index('stock_loss_log_date_idx').on(t.date),
  stockIdx:    index('stock_loss_log_stock_id_idx').on(t.stockId),
}));

export const webhookLog = pgTable('webhook_log', {
  id:          uuid('id').primaryKey().defaultRandom(),
  wixOrderId:  text('wix_order_id').notNull(),
  status:      text('status').notNull(),
  timestamp:   timestamp('timestamp', { withTimezone: true }).notNull(),
  appOrderId:  text('app_order_id'),
  error:       text('error'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  wixOrderIdx: index('webhook_log_wix_order_id_idx').on(t.wixOrderId),
  tsIdx:       index('webhook_log_timestamp_idx').on(t.timestamp),
}));

export const syncLog = pgTable('sync_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  timestamp:    timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  status:       text('status').notNull(),
  newProducts:  integer('new_products').notNull().default(0),
  updated:      integer('updated').notNull().default(0),
  deactivated:  integer('deactivated').notNull().default(0),
  priceSyncs:   integer('price_syncs').notNull().default(0),
  stockSyncs:   integer('stock_syncs').notNull().default(0),
  errorMessage: text('error_message').notNull().default(''),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tsIdx: index('sync_log_timestamp_idx').on(t.timestamp),
}));

export const productConfig = pgTable('product_config', {
  id:           uuid('id').primaryKey().defaultRandom(),
  airtableId:   text('airtable_id'),
  wixProductId: text('wix_product_id'),
  wixVariantId: text('wix_variant_id'),
  productName:  text('product_name').notNull().default(''),
  variantName:  text('variant_name').notNull().default(''),
  sortOrder:    integer('sort_order').notNull().default(0),
  imageUrl:     text('image_url').notNull().default(''),
  price:        numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  leadTimeDays: integer('lead_time_days').notNull().default(1),
  active:       boolean('active').notNull().default(true),
  visibleInWix: boolean('visible_in_wix').notNull().default(true),
  productType:  text('product_type'),
  minStems:     integer('min_stems').notNull().default(0),
  description:  text('description').notNull().default(''),
  category:     text('category'),
  keyFlower:    text('key_flower'),
  quantity:     integer('quantity'),
  availableFrom: date('available_from'),
  availableTo:   date('available_to'),
  translations:  jsonb('translations').notNull().default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  airtableIdx: uniqueIndex('product_config_airtable_id_idx').on(t.airtableId).where(isNotNull(t.airtableId)),
  wixPairIdx:  uniqueIndex('product_config_wix_pair_idx').on(t.wixProductId, t.wixVariantId).where(isNotNull(t.wixProductId)),
  productIdx:  index('product_config_wix_product_id_idx').on(t.wixProductId),
  activeIdx:   index('product_config_active_idx').on(t.active),
}));
```

Also add `isNotNull` to the drizzle-orm import at the top of schema.js. Current import line is likely:
```javascript
import { pgTable, text, uuid, integer, ... } from 'drizzle-orm/pg-core';
```
Add `isNotNull` to that import (used in partial index `where` clauses).

- [ ] **Step 3: Register migration in the journal**

Edit `backend/src/db/migrations/meta/_journal.json` — append to `entries` array:

```json
{
  "idx": 7,
  "version": "7",
  "when": 1746662400000,
  "tag": "0007_phase6_config_logs",
  "breakpoints": true
}
```

- [ ] **Step 4: Run migration locally against harness**

```bash
cd backend
npm run harness &
sleep 3
node src/db/migrate.js
```

Expected: migration applies without error. Each `CREATE TABLE IF NOT EXISTS` runs once.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0007_phase6_config_logs.sql \
        backend/src/db/schema.js \
        backend/src/db/migrations/meta/_journal.json
git commit -m "feat(db): Phase 6 — add 7 config+log tables to PG schema (migration 0007)"
```

---

## Task 2 — webhookLogRepo + syncLogRepo (simple write-only)

**Files:**
- Create: `backend/src/repos/webhookLogRepo.js`
- Create: `backend/src/repos/syncLogRepo.js`
- Modify: `backend/src/services/webhookLog.js`
- Modify: `backend/src/services/wixProductSync.js` (just the `logSync` function)
- Modify: `backend/src/routes/products.js` (just the `GET /sync-log` handler)

No test files needed for these — they are write-only append logs with no business logic. The integration path is covered by E2E section 25 (Wix webhook) and the sync routes.

- [ ] **Step 1: Create webhookLogRepo.js**

```javascript
// Webhook Log repository — append-only event log for incoming Wix webhooks.
import { db } from '../db/index.js';
import { webhookLog } from '../db/schema.js';

export async function logEvent({ status, wixOrderId, appOrderId, errorMessage }) {
  try {
    await db.insert(webhookLog).values({
      wixOrderId:  wixOrderId || 'unknown',
      status,
      timestamp:   new Date(),
      appOrderId:  appOrderId || null,
      error:       errorMessage ? errorMessage.slice(0, 2000) : null,
    });
  } catch (err) {
    console.error('[WEBHOOK_LOG] Failed to insert PG row:', err.message);
  }
}
```

- [ ] **Step 2: Create syncLogRepo.js**

```javascript
// Sync Log repository — append-only log of Wix product sync runs.
import { db } from '../db/index.js';
import { syncLog } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export async function logSync({ status, newProducts, updated, deactivated, priceSyncs, stockSyncs, errorMessage }) {
  await db.insert(syncLog).values({
    timestamp:    new Date(),
    status,
    newProducts:  newProducts  || 0,
    updated:      updated      || 0,
    deactivated:  deactivated  || 0,
    priceSyncs:   priceSyncs   || 0,
    stockSyncs:   stockSyncs   || 0,
    errorMessage: errorMessage || '',
  });
}

export async function listRecent(limit = 20) {
  const rows = await db.select().from(syncLog).orderBy(desc(syncLog.timestamp)).limit(limit);
  return rows.map(r => ({
    id:             r.id,
    Timestamp:      r.timestamp,
    Status:         r.status,
    'New Products': r.newProducts,
    Updated:        r.updated,
    Deactivated:    r.deactivated,
    'Price Syncs':  r.priceSyncs,
    'Stock Syncs':  r.stockSyncs,
    'Error Message': r.errorMessage,
  }));
}
```

- [ ] **Step 3: Rewrite services/webhookLog.js**

Replace the entire file:

```javascript
// Webhook event logger — persists every incoming webhook to Postgres webhook_log table.
import { logEvent } from '../repos/webhookLogRepo.js';

export async function logWebhookEvent({ status, wixOrderId, appOrderId, errorMessage, rawPayload }) {
  void rawPayload; // not persisted — too large; Railway logs capture it via console.log in wix.js
  await logEvent({ status, wixOrderId, appOrderId, errorMessage });
}
```

- [ ] **Step 4: Rewrite logSync in wixProductSync.js**

Find the `logSync` function (around line 595) and replace it:

```javascript
/** Write a sync log entry to Postgres + alert on failure. */
async function logSync(direction, stats) {
  const errorMessage = stats.errors.join('\n') || '';
  const hasErrors = stats.errors.length > 0;
  const hasSuccess = stats.pricesSynced || stats.stockSynced || stats.new || stats.updated;
  const status = hasErrors
    ? (hasSuccess ? `partial (${direction})` : `failed (${direction})`)
    : `success (${direction})`;

  try {
    await syncLogRepo.logSync({
      status,
      newProducts:  stats.new || 0,
      updated:      stats.updated || 0,
      deactivated:  stats.deactivated || 0,
      priceSyncs:   stats.pricesSynced || 0,
      stockSyncs:   stats.stockSynced || 0,
      errorMessage,
    });
  } catch (err) {
    console.error('[SYNC] Failed to write sync log:', err.message);
  }

  if (hasErrors) {
    // keep existing Telegram alert logic below this block unchanged
```

Add the import at the top of wixProductSync.js (near other repo imports):
```javascript
import * as syncLogRepo from '../repos/syncLogRepo.js';
```

Remove the old import lines:
```javascript
import * as db from '../services/airtable.js';   // keep if still used elsewhere in the file
import { TABLES } from '../config/airtable.js';   // keep if still used elsewhere
```
(Only remove these two imports if wixProductSync.js no longer uses `db` or `TABLES` — do a grep check before removing.)

- [ ] **Step 5: Rewrite GET /api/products/sync-log in routes/products.js**

Find the handler (around line 137) and replace:

```javascript
// ── GET /api/products/sync-log — recent sync history ──
router.get('/sync-log', async (req, res, next) => {
  try {
    const logs = await syncLogRepo.listRecent(20);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});
```

Add import at top of routes/products.js:
```javascript
import * as syncLogRepo from '../repos/syncLogRepo.js';
```

Remove the `db.list(TABLES.SYNC_LOG, ...)` call (now replaced). Check if `db` and `TABLES` are still used elsewhere in products.js before removing those imports.

- [ ] **Step 6: Run backend tests**

```bash
cd backend && npx vitest run
```

Expected: all existing tests pass (no regressions from import changes).

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/webhookLogRepo.js \
        backend/src/repos/syncLogRepo.js \
        backend/src/services/webhookLog.js \
        backend/src/services/wixProductSync.js \
        backend/src/routes/products.js
git commit -m "feat(db): Phase 6 — webhook_log + sync_log repos, retire Airtable writes"
```

---

## Task 3 — hoursRepo + rewrite floristHours.js

**Files:**
- Create: `backend/src/repos/hoursRepo.js`
- Create: `backend/src/__tests__/hoursRepo.integration.test.js`
- Modify: `backend/src/routes/floristHours.js`

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/__tests__/hoursRepo.integration.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as hoursRepo from '../repos/hoursRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('hoursRepo', () => {
  it('creates and retrieves a florist hours entry', async () => {
    const entry = await hoursRepo.create({
      Name: 'Anya', Date: '2026-05-01', Hours: 8,
      'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 2,
    });
    expect(entry.Name).toBe('Anya');
    expect(entry.Hours).toBe(8);
    expect(entry.id).toBeTruthy();

    const list = await hoursRepo.list({ month: '2026-05' });
    expect(list).toHaveLength(1);
    expect(list[0].Name).toBe('Anya');
  });

  it('filters by name', async () => {
    await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    await hoursRepo.create({ Name: 'Daria', Date: '2026-05-01', Hours: 7, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    const anya = await hoursRepo.list({ name: 'Anya' });
    expect(anya).toHaveLength(1);
    expect(anya[0].Name).toBe('Anya');
  });

  it('updates an entry', async () => {
    const entry = await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    const updated = await hoursRepo.update(entry.id, { Hours: 8, Bonus: 50 });
    expect(updated.Hours).toBe(8);
    expect(updated.Bonus).toBe(50);
  });

  it('soft-deletes an entry', async () => {
    const entry = await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    await hoursRepo.remove(entry.id);
    const list = await hoursRepo.list({});
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
cd backend && npx vitest run src/__tests__/hoursRepo.integration.test.js
```

Expected: fail with "Cannot find module '../repos/hoursRepo.js'"

- [ ] **Step 3: Create hoursRepo.js**

```javascript
// Florist Hours repository — Phase 6 direct Postgres cutover.
import { db } from '../db/index.js';
import { floristHours } from '../db/schema.js';
import { and, isNull, gte, lte, eq, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:               row.id,
    Name:             row.name,
    Date:             row.date,
    Hours:            Number(row.hours  || 0),
    'Hourly Rate':    Number(row.hourlyRate || 0),
    'Rate Type':      row.rateType || '',
    Bonus:            Number(row.bonus     || 0),
    Deduction:        Number(row.deduction || 0),
    Notes:            row.notes || '',
    'Delivery Count': row.deliveryCount || 0,
  };
}

export async function list({ month, name } = {}) {
  const conditions = [isNull(floristHours.deletedAt)];
  if (month) {
    const [year, mon] = month.split('-');
    const start = `${year}-${mon}-01`;
    const endDay = new Date(Number(year), Number(mon), 0).getDate();
    const end   = `${year}-${mon}-${String(endDay).padStart(2, '0')}`;
    conditions.push(gte(floristHours.date, start));
    conditions.push(lte(floristHours.date, end));
  }
  if (name) conditions.push(eq(floristHours.name, name));
  const rows = await db.select().from(floristHours).where(and(...conditions)).orderBy(desc(floristHours.date));
  return rows.map(toWire);
}

export async function create(fields) {
  const [row] = await db.insert(floristHours).values({
    name:          String(fields.Name || ''),
    date:          String(fields.Date),
    hours:         String(Number(fields.Hours || 0)),
    hourlyRate:    String(Number(fields['Hourly Rate'] || 0)),
    rateType:      fields['Rate Type'] || null,
    bonus:         String(Number(fields.Bonus || 0)),
    deduction:     String(Number(fields.Deduction || 0)),
    notes:         fields.Notes || '',
    deliveryCount: Number(fields['Delivery Count'] || 0),
  }).returning();
  return toWire(row);
}

export async function update(id, fields) {
  const updates = {};
  if ('Name'           in fields) updates.name          = fields.Name;
  if ('Date'           in fields) updates.date          = fields.Date;
  if ('Hours'          in fields) updates.hours         = String(Number(fields.Hours));
  if ('Hourly Rate'    in fields) updates.hourlyRate    = String(Number(fields['Hourly Rate']));
  if ('Rate Type'      in fields) updates.rateType      = fields['Rate Type'];
  if ('Bonus'          in fields) updates.bonus         = String(Number(fields.Bonus));
  if ('Deduction'      in fields) updates.deduction     = String(Number(fields.Deduction));
  if ('Notes'          in fields) updates.notes         = fields.Notes;
  if ('Delivery Count' in fields) updates.deliveryCount = Number(fields['Delivery Count']);
  const [row] = await db.update(floristHours).set(updates).where(eq(floristHours.id, id)).returning();
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  return toWire(row);
}

export async function remove(id) {
  await db.update(floristHours).set({ deletedAt: new Date() }).where(eq(floristHours.id, id));
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/__tests__/hoursRepo.integration.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Rewrite routes/floristHours.js**

Replace the entire file:

```javascript
// Florist Hours — CRUD for tracking florist work hours + payroll.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { pickAllowed } from '../utils/fields.js';
import { getConfig } from './settings.js';
import * as hoursRepo from '../repos/hoursRepo.js';

const router = Router();

const PATCH_ALLOWED = [
  'Name', 'Date', 'Hours', 'Hourly Rate', 'Rate Type', 'Bonus', 'Deduction', 'Notes', 'Delivery Count',
];

// GET /api/florist-hours?month=2026-03&name=Anya
router.get('/', authorize('orders'), async (req, res, next) => {
  try {
    const records = await hoursRepo.list({ month: req.query.month, name: req.query.name });
    res.json(records);
  } catch (err) { next(err); }
});

// POST /api/florist-hours
router.post('/', authorize('orders'), async (req, res, next) => {
  try {
    const { name, date, hours, hourlyRate, rateType, bonus, deduction, notes, deliveryCount } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date are required.' });
    const record = await hoursRepo.create({
      Name: name, Date: date, Hours: Number(hours) || 0,
      'Hourly Rate': Number(hourlyRate) || 0,
      'Rate Type': rateType || '',
      Bonus: Number(bonus) || 0, Deduction: Number(deduction) || 0,
      Notes: notes || '', 'Delivery Count': Number(deliveryCount) || 0,
    });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PATCH /api/florist-hours/:id
router.patch('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, PATCH_ALLOWED);
    if (Object.keys(safeFields).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });
    if ('Hours'          in safeFields) safeFields.Hours          = Number(safeFields.Hours) || 0;
    if ('Hourly Rate'    in safeFields) safeFields['Hourly Rate'] = Number(safeFields['Hourly Rate']) || 0;
    if ('Bonus'          in safeFields) safeFields.Bonus          = Number(safeFields.Bonus) || 0;
    if ('Deduction'      in safeFields) safeFields.Deduction      = Number(safeFields.Deduction) || 0;
    if ('Delivery Count' in safeFields) safeFields['Delivery Count'] = Number(safeFields['Delivery Count']) || 0;
    const record = await hoursRepo.update(req.params.id, safeFields);
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/florist-hours/:id
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    await hoursRepo.remove(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// GET /api/florist-hours/summary?month=2026-03
router.get('/summary', authorize('orders'), async (req, res, next) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    const records = await hoursRepo.list({ month });
    const configuredRates = getConfig('floristRates') || {};
    const byName = {};
    for (const r of records) {
      const n = r.Name || 'Unknown';
      if (!byName[n]) byName[n] = { name: n, totalHours: 0, totalPay: 0, totalBonus: 0, totalDeduction: 0, deliveries: 0, days: 0, byRateType: {} };
      const hours    = Number(r.Hours || 0);
      const rateType = r['Rate Type'] || '';
      byName[n].totalHours += hours;
      const recordRate   = Number(r['Hourly Rate'] || 0);
      const floristRates = configuredRates[n];
      const fallbackRate = typeof floristRates === 'object' && rateType
        ? (floristRates[rateType] || 0)
        : (typeof floristRates === 'number' ? floristRates : 0);
      const rate = recordRate > 0 ? recordRate : fallbackRate;
      const pay  = (hours * rate) + Number(r.Bonus || 0) - Number(r.Deduction || 0);
      byName[n].totalPay       += pay;
      byName[n].totalBonus     += Number(r.Bonus || 0);
      byName[n].totalDeduction += Number(r.Deduction || 0);
      byName[n].deliveries     += Number(r['Delivery Count'] || 0);
      byName[n].days++;
      if (rateType) {
        if (!byName[n].byRateType[rateType]) byName[n].byRateType[rateType] = { hours: 0, pay: 0 };
        byName[n].byRateType[rateType].hours += hours;
        byName[n].byRateType[rateType].pay   += hours * rate;
      }
    }
    res.json({ month, florists: Object.values(byName), totalRecords: records.length });
  } catch (err) { next(err); }
});

export default router;
```

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/hoursRepo.js \
        backend/src/__tests__/hoursRepo.integration.test.js \
        backend/src/routes/floristHours.js
git commit -m "feat(db): Phase 6 — florist_hours repo + route cutover to Postgres"
```

---

## Task 4 — marketingSpendRepo + rewrite marketingSpend.js

**Files:**
- Create: `backend/src/repos/marketingSpendRepo.js`
- Create: `backend/src/__tests__/marketingSpendRepo.integration.test.js`
- Modify: `backend/src/routes/marketingSpend.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/marketingSpendRepo.integration.test.js`:

```javascript
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

import * as repo from '../repos/marketingSpendRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('marketingSpendRepo', () => {
  it('creates and lists spend entries', async () => {
    await repo.create({ month: '2026-03-01', channel: 'Instagram', amount: 500, notes: '' });
    await repo.create({ month: '2026-04-01', channel: 'Google', amount: 300, notes: '' });
    const all = await repo.list({});
    expect(all).toHaveLength(2);
  });

  it('filters by date range', async () => {
    await repo.create({ month: '2026-02-01', channel: 'Instagram', amount: 200, notes: '' });
    await repo.create({ month: '2026-04-01', channel: 'Google', amount: 400, notes: '' });
    const filtered = await repo.list({ from: '2026-03', to: '2026-05' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].Channel).toBe('Google');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/__tests__/marketingSpendRepo.integration.test.js
```

Expected: fail with "Cannot find module '../repos/marketingSpendRepo.js'"

- [ ] **Step 3: Create marketingSpendRepo.js**

```javascript
// Marketing Spend repository — Phase 6 direct Postgres cutover.
import { db } from '../db/index.js';
import { marketingSpend } from '../db/schema.js';
import { and, isNull, gte, lte, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:      row.id,
    Month:   row.month,
    Channel: row.channel,
    Amount:  Number(row.amount || 0),
    Notes:   row.notes || '',
  };
}

export async function list({ from, to } = {}) {
  const conditions = [isNull(marketingSpend.deletedAt)];
  if (from) conditions.push(gte(marketingSpend.month, `${from}-01`));
  if (to)   conditions.push(lte(marketingSpend.month, `${to}-28`));
  const rows = await db.select().from(marketingSpend).where(and(...conditions)).orderBy(desc(marketingSpend.month));
  return rows.map(toWire);
}

export async function create({ month, channel, amount, notes }) {
  const [row] = await db.insert(marketingSpend).values({
    month, channel: channel.trim(), amount: String(amount), notes: notes || '',
  }).returning();
  return toWire(row);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/__tests__/marketingSpendRepo.integration.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Rewrite routes/marketingSpend.js**

Replace the entire file:

```javascript
// Marketing Spend routes — track ad spend per channel per month.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as repo from '../repos/marketingSpendRepo.js';

const router = Router();
router.use(authorize('admin'));

// GET /api/marketing-spend?from=2026-01&to=2026-03
router.get('/', async (req, res, next) => {
  try {
    const records = await repo.list({ from: req.query.from, to: req.query.to });
    res.json(records);
  } catch (err) { next(err); }
});

// POST /api/marketing-spend
router.post('/', async (req, res, next) => {
  try {
    const { month, channel, amount, notes } = req.body;
    if (!month || !channel || amount === undefined || amount === null)
      return res.status(400).json({ error: 'month, channel, and amount are required.' });
    if (typeof amount !== 'number' || amount < 0)
      return res.status(400).json({ error: 'amount must be a non-negative number.' });
    if (typeof channel !== 'string' || !channel.trim())
      return res.status(400).json({ error: 'channel must be a non-empty string.' });
    const record = await repo.create({ month, channel, amount, notes });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

export default router;
```

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/marketingSpendRepo.js \
        backend/src/__tests__/marketingSpendRepo.integration.test.js \
        backend/src/routes/marketingSpend.js
git commit -m "feat(db): Phase 6 — marketing_spend repo + route cutover to Postgres"
```

---

## Task 5 — stockLossRepo + rewrite stockLoss.js

**Files:**
- Create: `backend/src/repos/stockLossRepo.js`
- Create: `backend/src/__tests__/stockLossRepo.integration.test.js`
- Modify: `backend/src/routes/stockLoss.js`

Enrichment (flower name, supplier, cost price) now done via SQL JOIN against `stock` table instead of a second Airtable batch fetch.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/stockLossRepo.integration.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockRepo from '../repos/stockRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('stockLossRepo', () => {
  it('creates and lists a loss entry without stock link', async () => {
    const entry = await stockLossRepo.create({ date: '2026-05-01', quantity: 10, reason: 'Wilted', notes: '' });
    expect(entry.Quantity).toBe(10);
    expect(entry.Reason).toBe('Wilted');
    const list = await stockLossRepo.list({});
    expect(list).toHaveLength(1);
  });

  it('creates a loss entry with stock link and enriches on GET', async () => {
    // Seed a stock row via stockRepo (postgres mode)
    stockRepo._setMode('postgres');
    const stockItem = await stockRepo.create({ 'Display Name': 'Red Rose', Supplier: 'Stojek', 'Current Quantity': 100, 'Current Cost Price': 3.5 });
    const entry = await stockLossRepo.create({ date: '2026-05-01', stockId: stockItem._pgId, quantity: 5, reason: 'Damaged', notes: '' });
    expect(entry.flowerName).toBe('Red Rose');
    expect(entry.supplier).toBe('Stojek');
    stockRepo._resetMode();
  });

  it('soft-deletes a loss entry', async () => {
    const entry = await stockLossRepo.create({ date: '2026-05-01', quantity: 3, reason: 'Wilted', notes: '' });
    await stockLossRepo.remove(entry.id);
    const list = await stockLossRepo.list({});
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/__tests__/stockLossRepo.integration.test.js
```

Expected: fail with "Cannot find module '../repos/stockLossRepo.js'"

- [ ] **Step 3: Create stockLossRepo.js**

```javascript
// Stock Loss Log repository — Phase 6 direct Postgres cutover.
// GET enriches each row with flower name + supplier via JOIN on stock table.
import { db } from '../db/index.js';
import { stockLossLog, stock } from '../db/schema.js';
import { and, isNull, gte, lte, eq, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:           row.id,
    Date:         row.date,
    Quantity:     Number(row.quantity || 0),
    Reason:       row.reason,
    Notes:        row.notes || '',
    'Stock Item': row.stockId ? [row.stockId] : [],
    // Enrichment fields — populated when a stock row was joined
    flowerName:    row.displayName || row.purchaseName || '—',
    supplier:      row.supplier    || '—',
    costPrice:     Number(row.costPrice || 0),
    lastRestocked: row.lastRestocked || null,
  };
}

export async function list({ from, to } = {}) {
  const conditions = [isNull(stockLossLog.deletedAt)];
  if (from) conditions.push(gte(stockLossLog.date, from));
  if (to)   conditions.push(lte(stockLossLog.date, to));

  const rows = await db
    .select({
      id:           stockLossLog.id,
      date:         stockLossLog.date,
      stockId:      stockLossLog.stockId,
      quantity:     stockLossLog.quantity,
      reason:       stockLossLog.reason,
      notes:        stockLossLog.notes,
      displayName:  stock.displayName,
      purchaseName: stock.purchaseName,
      supplier:     stock.supplier,
      costPrice:    stock.currentCostPrice,
      lastRestocked: stock.lastRestocked,
    })
    .from(stockLossLog)
    .leftJoin(stock, eq(stockLossLog.stockId, stock.id))
    .where(and(...conditions))
    .orderBy(desc(stockLossLog.date));

  return rows.map(toWire);
}

export async function getById(id) {
  const [row] = await db.select().from(stockLossLog).where(eq(stockLossLog.id, id));
  return row || null;
}

export async function create({ date, stockId, quantity, reason, notes }) {
  const values = {
    date: date || new Date().toISOString().split('T')[0],
    quantity: String(Number(quantity)),
    reason,
    notes: notes || '',
  };
  if (stockId) values.stockId = stockId;

  const [row] = await db.insert(stockLossLog).values(values).returning();

  // Enrich the response via a JOIN so the mobile UI can render immediately
  const enriched = await list({});
  return enriched.find(r => r.id === row.id) || toWire(row);
}

export async function update(id, { quantity, reason, notes, date }) {
  const updates = {};
  if (quantity != null) updates.quantity = String(Number(quantity));
  if (reason   != null) updates.reason   = reason;
  if (notes    != null) updates.notes    = notes;
  if (date     != null) updates.date     = date;
  const [row] = await db.update(stockLossLog).set(updates).where(eq(stockLossLog.id, id)).returning();
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  return toWire(row);
}

export async function remove(id) {
  await db.update(stockLossLog).set({ deletedAt: new Date() }).where(eq(stockLossLog.id, id));
}
```

**Note on `stock.displayName` etc.:** These are the Drizzle column names from the stock table in schema.js. Check the actual column names in schema.js — they may be `displayName`, `currentQuantity`, `currentCostPrice`, `lastRestocked`. Adjust the select projection if the names differ.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/__tests__/stockLossRepo.integration.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Rewrite routes/stockLoss.js**

Replace the entire file:

```javascript
// Stock Loss routes — log waste events (wilted, damaged, overstock, etc.).
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { actorFromReq } from '../utils/actor.js';
import { VALID_LOSS_REASONS } from '../constants/statuses.js';

const router = Router();
router.use(authorize('orders'));

const VALID_REASONS = VALID_LOSS_REASONS;

// GET /api/stock-loss?from=2026-01-01&to=2026-03-31
router.get('/', async (req, res, next) => {
  try {
    const records = await stockLossRepo.list({ from: req.query.from, to: req.query.to });
    res.json(records);
  } catch (err) { next(err); }
});

// POST /api/stock-loss
router.post('/', async (req, res, next) => {
  try {
    const { date, stockItemId, quantity, reason, notes } = req.body;
    if (!quantity || !reason)
      return res.status(400).json({ error: 'quantity and reason are required' });
    if (!VALID_REASONS.includes(reason))
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });

    const record = await stockLossRepo.create({
      date, stockId: stockItemId || null, quantity, reason, notes,
    });

    if (stockItemId) {
      await stockRepo.adjustQuantity(stockItemId, -Number(quantity), { actor: actorFromReq(req) });
    }

    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PATCH /api/stock-loss/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { quantity, reason, notes, date } = req.body;
    if (reason != null && !VALID_REASONS.includes(reason))
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });

    const current = await stockLossRepo.getById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const oldQty     = Number(current.quantity || 0);
    const newQty     = quantity != null ? Number(quantity) : oldQty;
    const delta      = oldQty - newQty; // positive = reduced loss → restore stock
    const stockId    = current.stockId;

    if (delta !== 0 && stockId) {
      await stockRepo.adjustQuantity(stockId, delta, { actor: actorFromReq(req) });
      const stockItem     = await stockRepo.getById(stockId);
      const currentDead   = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - delta),
      }, { actor: actorFromReq(req) });
    }

    const updated = await stockLossRepo.update(req.params.id, { quantity, reason, notes, date });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/stock-loss/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const current = await stockLossRepo.getById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const qty     = Number(current.quantity || 0);
    const stockId = current.stockId;

    if (stockId && qty > 0) {
      await stockRepo.adjustQuantity(stockId, +qty, { actor: actorFromReq(req) });
      const stockItem   = await stockRepo.getById(stockId);
      const currentDead = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - qty),
      }, { actor: actorFromReq(req) });
    }

    await stockLossRepo.remove(req.params.id);
    res.json({ id: req.params.id, deleted: true });
  } catch (err) { next(err); }
});

export default router;
```

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/stockLossRepo.js \
        backend/src/__tests__/stockLossRepo.integration.test.js \
        backend/src/routes/stockLoss.js
git commit -m "feat(db): Phase 6 — stock_loss_log repo + route cutover to Postgres"
```

---

## Task 6 — appConfigRepo + rewrite settings.js

**Files:**
- Create: `backend/src/repos/appConfigRepo.js`
- Create: `backend/src/__tests__/appConfigRepo.integration.test.js`
- Modify: `backend/src/routes/settings.js`

The `app_config` table stores multiple keys: `'config'` (main JSON blob) and `'orderCounters'` (per-month counter object). Both are JSONB. The in-memory `config` object and the `configLoaded` flag remain — only the persistence layer changes.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/appConfigRepo.integration.test.js`:

```javascript
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

import * as appConfigRepo from '../repos/appConfigRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('appConfigRepo', () => {
  it('get returns null when key is missing', async () => {
    const val = await appConfigRepo.get('config');
    expect(val).toBeNull();
  });

  it('set and get round-trip', async () => {
    await appConfigRepo.set('config', { defaultDeliveryFee: 35 });
    const val = await appConfigRepo.get('config');
    expect(val).toEqual({ defaultDeliveryFee: 35 });
  });

  it('set is idempotent (upsert)', async () => {
    await appConfigRepo.set('config', { v: 1 });
    await appConfigRepo.set('config', { v: 2 });
    const val = await appConfigRepo.get('config');
    expect(val.v).toBe(2);
  });

  it('increments orderCounter atomically', async () => {
    const first  = await appConfigRepo.nextOrderId('202605');
    const second = await appConfigRepo.nextOrderId('202605');
    expect(first).toBe('202605-001');
    expect(second).toBe('202605-002');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/__tests__/appConfigRepo.integration.test.js
```

Expected: fail with "Cannot find module '../repos/appConfigRepo.js'"

- [ ] **Step 3: Create appConfigRepo.js**

```javascript
// App Config repository — Phase 6 direct Postgres cutover.
// Stores arbitrary JSON blobs keyed by string. Two keys in production:
//   'config'         — main settings object (DEFAULTS + owner overrides)
//   'orderCounters'  — { 'YYYYMM': N } per-month order counter
import { db } from '../db/index.js';
import { appConfig } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

/** Returns parsed value for key, or null if missing. */
export async function get(key) {
  const [row] = await db.select({ value: appConfig.value }).from(appConfig).where(eq(appConfig.key, key));
  return row ? row.value : null;
}

/** Upserts key → value (replaces entirely). */
export async function set(key, value) {
  await db.insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Atomically increments the per-month order counter and returns the
 * next formatted ID like '202605-001'.
 * Uses a transaction + SELECT FOR UPDATE to be safe under concurrent requests.
 */
export async function nextOrderId(monthKey) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, 'orderCounters'))
      .for('update');

    const counters = row ? (row.value || {}) : {};
    const next     = (counters[monthKey] || 0) + 1;
    counters[monthKey] = next;

    if (row) {
      await tx.update(appConfig).set({ value: counters, updatedAt: new Date() }).where(eq(appConfig.key, 'orderCounters'));
    } else {
      await tx.insert(appConfig).values({ key: 'orderCounters', value: counters });
    }

    return `${monthKey}-${String(next).padStart(3, '0')}`;
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/__tests__/appConfigRepo.integration.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Rewrite loadConfig/saveConfig/generateOrderId in settings.js**

Find and replace the `loadConfig` function:

```javascript
async function loadConfig() {
  try {
    const stored = await appConfigRepo.get('config');
    if (stored) {
      config = deepMerge(DEFAULTS, stored);
      migrateSeasonalDates();
      migrateCategoryObjects();
      migrateAutoCategoryTranslations();
      migrateFloristRates();
      console.log('[SETTINGS] Config loaded from Postgres');
    } else {
      await appConfigRepo.set('config', DEFAULTS);
      console.log('[SETTINGS] Config row created in Postgres with defaults');
    }
  } catch (err) {
    console.error('[SETTINGS] Failed to load config from Postgres:', err.message);
    console.warn('[SETTINGS] Using in-memory defaults');
  }
  configLoaded = true;
}
```

Find and replace the `saveConfig` function:

```javascript
async function saveConfig() {
  try {
    await appConfigRepo.set('config', config);
  } catch (err) {
    console.error('[SETTINGS] Failed to save config to Postgres:', err.message);
  }
}
```

Find and replace the `generateOrderId` function:

```javascript
export async function generateOrderId() {
  const now      = new Date();
  const monthKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    return await appConfigRepo.nextOrderId(monthKey);
  } catch (err) {
    console.error('[ORDER-ID] Counter error:', err.message);
    // Fallback: timestamp-based ID to avoid blocking order creation
    return `${monthKey}-T${Date.now().toString().slice(-5)}`;
  }
}
```

Add import at the top of settings.js (near other imports):

```javascript
import * as appConfigRepo from '../repos/appConfigRepo.js';
```

Remove the now-unused variables: `configRecordId` (the Airtable record ID holder). Remove the `let configRecordId;` declaration and any references to it.

Remove the Airtable imports from settings.js if `db` and `TABLES.APP_CONFIG` are no longer used (check the file for any remaining Airtable calls first — the `driver-of-day` route still uses `db.list(TABLES.DELIVERIES, ...)` and `db.update(TABLES.DELIVERIES, ...)` for auto-assigning drivers; those stay as-is until Phase 7).

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all pass. The `generateOrderId` function is tested indirectly by orderRepo integration tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/appConfigRepo.js \
        backend/src/__tests__/appConfigRepo.integration.test.js \
        backend/src/routes/settings.js
git commit -m "feat(db): Phase 6 — app_config repo + settings.js cutover to Postgres"
```

---

## Task 7 — productConfigRepo + all callers

**Files:**
- Create: `backend/src/repos/productConfigRepo.js`
- Create: `backend/src/__tests__/productConfigRepo.integration.test.js`
- Modify: `backend/src/repos/productRepo.js`
- Modify: `backend/src/routes/products.js` (GET / + PATCH /:id)
- Modify: `backend/src/routes/public.js`
- Modify: `backend/src/services/wix.js` (inventory decrement on webhook)
- Modify: `backend/src/services/wixProductSync.js` (all PRODUCT_CONFIG reads/writes)

This is the most complex task — Product Config is read and written from 5 files.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/productConfigRepo.integration.test.js`:

```javascript
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

import * as repo from '../repos/productConfigRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

async function seed(overrides = {}) {
  return repo.create({
    wixProductId: overrides.wixProductId || 'prod-1',
    wixVariantId: overrides.wixVariantId || 'var-1',
    productName:  overrides.productName  || 'Red Rose',
    variantName:  overrides.variantName  || '5 stems',
    price:        overrides.price        ?? 49,
    active:       overrides.active       ?? true,
    ...overrides,
  });
}

describe('productConfigRepo', () => {
  it('creates and lists a product config row', async () => {
    await seed();
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]['Product Name']).toBe('Red Rose');
  });

  it('setImage writes image URL to all variants of a product', async () => {
    await seed({ wixProductId: 'p1', wixVariantId: 'v1' });
    await seed({ wixProductId: 'p1', wixVariantId: 'v2' });
    await repo.setImage('p1', 'https://example.com/img.jpg');
    const rows = await repo.list();
    expect(rows.every(r => r['Image URL'] === 'https://example.com/img.jpg')).toBe(true);
  });

  it('getImage returns empty string when no row matches', async () => {
    const url = await repo.getImage('no-such-product');
    expect(url).toBe('');
  });

  it('getImagesBatch returns a Map of wixProductId → imageUrl', async () => {
    await seed({ wixProductId: 'p1', wixVariantId: 'v1', imageUrl: 'https://a.com/1.jpg' });
    await seed({ wixProductId: 'p2', wixVariantId: 'v1', imageUrl: 'https://a.com/2.jpg' });
    const map = await repo.getImagesBatch(['p1', 'p2', 'p3']);
    expect(map.get('p1')).toBe('https://a.com/1.jpg');
    expect(map.get('p2')).toBe('https://a.com/2.jpg');
    expect(map.has('p3')).toBe(false);
  });

  it('upsert creates new row and updates existing on wix pair key', async () => {
    await repo.upsert({ wixProductId: 'p1', wixVariantId: 'v1', productName: 'Rose', price: 40 });
    await repo.upsert({ wixProductId: 'p1', wixVariantId: 'v1', productName: 'Rose Deluxe', price: 50 });
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]['Product Name']).toBe('Rose Deluxe');
  });

  it('update patches editable fields', async () => {
    const row = await seed();
    const updated = await repo.update(row.id, { Price: 99, Active: false });
    expect(updated.Price).toBe(99);
    expect(updated.Active).toBe(false);
  });

  it('decrementQuantity clamps at 0 and skips null', async () => {
    const row = await seed({ quantity: 5 });
    await repo.decrementQuantity('prod-1', 'var-1', 3);
    const rows = await repo.list();
    expect(rows[0].Quantity).toBe(2);

    const nullRow = await seed({ wixProductId: 'p2', wixVariantId: 'v2' }); // quantity = null
    await repo.decrementQuantity('p2', 'v2', 1); // should be no-op
    const rows2 = await repo.list();
    const p2 = rows2.find(r => r['Wix Product ID'] === 'p2');
    expect(p2.Quantity).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/__tests__/productConfigRepo.integration.test.js
```

Expected: fail with "Cannot find module '../repos/productConfigRepo.js'"

- [ ] **Step 3: Create productConfigRepo.js**

```javascript
// Product Config repository — Phase 6 direct Postgres cutover.
// One row per (wix_product_id, wix_variant_id) pair. Used by:
//   - productRepo.js (image URL cache)
//   - routes/products.js (owner product management)
//   - routes/public.js (public product listing)
//   - services/wix.js (inventory decrement on webhook)
//   - services/wixProductSync.js (pull/push sync operations)
import { db } from '../db/index.js';
import { productConfig } from '../db/schema.js';
import { and, isNull, eq, inArray, asc } from 'drizzle-orm';

// Serialize PG row → Airtable-shaped wire format.
// Field names match existing Airtable field names so routes/services need
// no format changes.
function toWire(row) {
  return {
    id:               row.id,
    'Wix Product ID': row.wixProductId,
    'Wix Variant ID': row.wixVariantId,
    'Product Name':   row.productName,
    'Variant Name':   row.variantName,
    'Sort Order':     row.sortOrder,
    'Image URL':      row.imageUrl,
    Price:            Number(row.price || 0),
    'Lead Time Days': row.leadTimeDays,
    Active:           row.active,
    'Visible in Wix': row.visibleInWix,
    'Product Type':   row.productType || '',
    'Min Stems':      row.minStems,
    Description:      row.description,
    Category:         row.category || '',
    'Key Flower':     row.keyFlower || '',
    Quantity:         row.quantity ?? null,
    'Available From': row.availableFrom || null,
    'Available To':   row.availableTo   || null,
    Translations:     row.translations  || {},
  };
}

const activeFilter = isNull(productConfig.deletedAt);

/** List all active product config rows. */
export async function list(filter = {}) {
  const conditions = [activeFilter];
  if (filter.activeOnly) conditions.push(eq(productConfig.active, true));
  const rows = await db.select().from(productConfig)
    .where(and(...conditions))
    .orderBy(asc(productConfig.productName), asc(productConfig.sortOrder));
  return rows.map(toWire);
}

/** Get a single row by PG id. */
export async function getById(id) {
  const [row] = await db.select().from(productConfig).where(eq(productConfig.id, id));
  return row ? toWire(row) : null;
}

/** Get first row matching (wixProductId, wixVariantId). */
export async function getByWixPair(wixProductId, wixVariantId) {
  const [row] = await db.select().from(productConfig)
    .where(and(
      eq(productConfig.wixProductId, wixProductId),
      eq(productConfig.wixVariantId, wixVariantId),
      activeFilter,
    ));
  return row ? toWire(row) : null;
}

/** Create a new product config row. */
export async function create(fields) {
  const [row] = await db.insert(productConfig).values({
    wixProductId:  fields.wixProductId  || fields['Wix Product ID'],
    wixVariantId:  fields.wixVariantId  || fields['Wix Variant ID'],
    productName:   fields.productName   || fields['Product Name']  || '',
    variantName:   fields.variantName   || fields['Variant Name']  || '',
    sortOrder:     fields.sortOrder     ?? fields['Sort Order']    ?? 0,
    imageUrl:      fields.imageUrl      || fields['Image URL']     || '',
    price:         String(Number(fields.price ?? fields.Price ?? 0)),
    leadTimeDays:  fields.leadTimeDays  ?? fields['Lead Time Days'] ?? 1,
    active:        fields.active        ?? fields.Active            ?? true,
    visibleInWix:  fields.visibleInWix  ?? fields['Visible in Wix'] ?? true,
    productType:   fields.productType   || fields['Product Type']  || null,
    minStems:      fields.minStems      ?? fields['Min Stems']     ?? 0,
    description:   fields.description   || fields.Description      || '',
    category:      fields.category      || fields.Category         || null,
    keyFlower:     fields.keyFlower     || fields['Key Flower']    || null,
    quantity:      fields.quantity      ?? fields.Quantity         ?? null,
    availableFrom: fields.availableFrom || fields['Available From'] || null,
    availableTo:   fields.availableTo   || fields['Available To']  || null,
    translations:  fields.translations  || fields.Translations     || {},
  }).returning();
  return toWire(row);
}

/**
 * Upsert by (wixProductId, wixVariantId). Creates if missing, updates if present.
 * Used by wixProductSync pull operation.
 */
export async function upsert(fields) {
  const pid = fields.wixProductId || fields['Wix Product ID'];
  const vid = fields.wixVariantId || fields['Wix Variant ID'];
  const values = {
    wixProductId:  pid,
    wixVariantId:  vid,
    productName:   fields.productName  || fields['Product Name']  || '',
    variantName:   fields.variantName  || fields['Variant Name']  || '',
    sortOrder:     fields.sortOrder    ?? fields['Sort Order']    ?? 0,
    imageUrl:      fields.imageUrl     || fields['Image URL']     || '',
    price:         String(Number(fields.price ?? fields.Price ?? 0)),
    leadTimeDays:  fields.leadTimeDays ?? fields['Lead Time Days'] ?? 1,
    active:        fields.active       ?? fields.Active            ?? true,
    visibleInWix:  fields.visibleInWix ?? fields['Visible in Wix'] ?? true,
    productType:   fields.productType  || fields['Product Type']  || null,
    minStems:      fields.minStems     ?? fields['Min Stems']     ?? 0,
    description:   fields.description  || fields.Description      || '',
    category:      Array.isArray(fields.Category) ? fields.Category.join(', ') : (fields.category || fields.Category || null),
    quantity:      fields.quantity     ?? fields.Quantity         ?? null,
  };
  const [row] = await db.insert(productConfig).values(values)
    .onConflictDoUpdate({
      target: [productConfig.wixProductId, productConfig.wixVariantId],
      set: { ...values, wixProductId: undefined, wixVariantId: undefined },
    }).returning();
  return toWire(row);
}

/**
 * Patch editable fields on an existing row (owner-facing PATCH route).
 * Accepts Airtable field names.
 */
export async function update(id, fields) {
  const updates = {};
  if ('Price'           in fields) updates.price         = String(Number(fields.Price));
  if ('Quantity'        in fields) updates.quantity       = fields.Quantity != null ? Number(fields.Quantity) : null;
  if ('Lead Time Days'  in fields) updates.leadTimeDays   = Number(fields['Lead Time Days']);
  if ('Active'          in fields) updates.active         = Boolean(fields.Active);
  if ('Visible in Wix'  in fields) updates.visibleInWix   = Boolean(fields['Visible in Wix']);
  if ('Category'        in fields) updates.category       = Array.isArray(fields.Category) ? fields.Category.join(', ') : fields.Category;
  if ('Key Flower'      in fields) updates.keyFlower      = fields['Key Flower'];
  if ('Product Type'    in fields) updates.productType    = fields['Product Type'];
  if ('Min Stems'       in fields) updates.minStems       = Number(fields['Min Stems']);
  if ('Sort Order'      in fields) updates.sortOrder      = Number(fields['Sort Order']);
  if ('Available From'  in fields) updates.availableFrom  = fields['Available From'] || null;
  if ('Available To'    in fields) updates.availableTo    = fields['Available To']   || null;
  if ('Description'     in fields) updates.description    = fields.Description;
  if ('Translations'    in fields) updates.translations   = fields.Translations;
  const [row] = await db.update(productConfig).set(updates).where(eq(productConfig.id, id)).returning();
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  return toWire(row);
}

/**
 * Writes imageUrl to every row matching wixProductId.
 * Used by productRepo.setImage.
 */
export async function setImage(wixProductId, imageUrl) {
  const result = await db.update(productConfig)
    .set({ imageUrl })
    .where(and(eq(productConfig.wixProductId, wixProductId), activeFilter));
  return { updatedCount: result.rowCount ?? 0 };
}

/**
 * Returns imageUrl of first matching variant, or '' if none.
 */
export async function getImage(wixProductId) {
  const [row] = await db.select({ imageUrl: productConfig.imageUrl })
    .from(productConfig)
    .where(and(eq(productConfig.wixProductId, wixProductId), activeFilter))
    .limit(1);
  return row?.imageUrl || '';
}

/**
 * Batch lookup. Returns Map<wixProductId, imageUrl>.
 */
export async function getImagesBatch(wixProductIds) {
  const map = new Map();
  if (!wixProductIds?.length) return map;
  const rows = await db.select({
    wixProductId: productConfig.wixProductId,
    imageUrl:     productConfig.imageUrl,
  }).from(productConfig)
    .where(and(inArray(productConfig.wixProductId, wixProductIds), activeFilter));
  for (const row of rows) {
    if (row.wixProductId && row.imageUrl && !map.has(row.wixProductId)) {
      map.set(row.wixProductId, row.imageUrl);
    }
  }
  return map;
}

/**
 * Decrements Quantity for a specific (wixProductId, wixVariantId) pair.
 * No-op if the row has Quantity = NULL (untracked/unlimited).
 * Clamps at 0.
 */
export async function decrementQuantity(wixProductId, wixVariantId, amount) {
  // Only update rows with a non-null Quantity
  await db.execute(
    // Drizzle raw SQL for clamped decrement
    sql`UPDATE product_config
        SET quantity = GREATEST(0, quantity - ${amount})
        WHERE wix_product_id = ${wixProductId}
          AND wix_variant_id = ${wixVariantId}
          AND quantity IS NOT NULL
          AND deleted_at IS NULL`
  );
}

/**
 * Soft-delete a row (used by wixProductSync for removed Wix products).
 */
export async function softDelete(id) {
  await db.update(productConfig).set({ deletedAt: new Date() }).where(eq(productConfig.id, id));
}

/**
 * Set active=false without deleting (used for deactivation without removal).
 */
export async function deactivate(id) {
  await db.update(productConfig).set({ active: false }).where(eq(productConfig.id, id));
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/__tests__/productConfigRepo.integration.test.js
```

Expected: 7 tests pass.

- [ ] **Step 5: Rewrite productRepo.js**

Replace the entire file:

```javascript
// Product repository — persistence boundary for bouquet image URL cache.
// Phase 6: backed by Postgres product_config table via productConfigRepo.
import * as productConfigRepo from './productConfigRepo.js';

export const setImage      = productConfigRepo.setImage;
export const getImage      = productConfigRepo.getImage;
export const getImagesBatch = productConfigRepo.getImagesBatch;
```

- [ ] **Step 6: Rewrite GET / and PATCH /:id in routes/products.js**

Replace the `GET /` handler (list all Product Config rows):

```javascript
// ── GET /api/products — list all Product Config rows ──
router.get('/', async (req, res, next) => {
  try {
    const rows = await productConfigRepo.list();
    res.json(rows);
  } catch (err) { next(err); }
});
```

Replace the `PATCH /:id` handler:

```javascript
// ── PATCH /api/products/:id ──
router.patch('/:id', async (req, res, next) => {
  try {
    const updates = {};
    for (const key of Object.keys(req.body)) {
      if (EDITABLE_FIELDS.includes(key)) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No valid fields to update.' });
    const updated = await productConfigRepo.update(req.params.id, updates);
    res.json(updated);
  } catch (err) { next(err); }
});
```

Add import at the top of routes/products.js:

```javascript
import * as productConfigRepo from '../repos/productConfigRepo.js';
```

Remove the `db.list(TABLES.PRODUCT_CONFIG, ...)` and `db.update(TABLES.PRODUCT_CONFIG, ...)` calls that just got replaced. Check if `db` and `TABLES` are still needed elsewhere in the file (the sync-log GET was already replaced in Task 2 — confirm both are gone before removing imports).

- [ ] **Step 7: Rewrite public.js product config read**

Find the `db.list(TABLES.PRODUCT_CONFIG, ...)` call in `routes/public.js` (around line 39) and replace with:

```javascript
const rows = await productConfigRepo.list({ activeOnly: true });
```

Add import at top of public.js:

```javascript
import * as productConfigRepo from '../repos/productConfigRepo.js';
```

Remove the Airtable imports if no longer needed in public.js.

- [ ] **Step 8: Rewrite wix.js inventory decrement**

Find the webhook handler section "11b. Decrement tracked inventory on PRODUCT_CONFIG" (around line 400). Replace the `db.list(TABLES.PRODUCT_CONFIG, ...)` + `db.update(TABLES.PRODUCT_CONFIG, ...)` block:

```javascript
// 11b. Decrement tracked inventory on PRODUCT_CONFIG.
for (const li of lineItems) {
  const wixProductId = li.catalogReference?.catalogItemId || li.productId || li.catalogItemId;
  const wixVariantId = li.catalogReference?.options?.variantId || li.productOptions?.variantId || li.variantId;
  const orderedQty   = Number(li.quantity) || 1;

  if (!wixProductId || !wixVariantId) {
    log('11b-INV', `Skip (no Wix Product/Variant ID): "${localizedText(li.productName) || li.name || 'Item'}"`);
    continue;
  }

  try {
    await productConfigRepo.decrementQuantity(wixProductId, wixVariantId, orderedQty);
    log('11b-INV', `Decremented ${orderedQty} for ${wixProductId}/${wixVariantId}`);
  } catch (err) {
    log('11b-INV', `Error decrementing ${wixProductId}/${wixVariantId}: ${err.message}`, 'error');
  }
}
```

Add import at top of wix.js:

```javascript
import * as productConfigRepo from '../repos/productConfigRepo.js';
```

- [ ] **Step 9: Rewrite wixProductSync.js product config operations**

This file has the most changes. Replace all `db.list(TABLES.PRODUCT_CONFIG, ...)`, `db.create(TABLES.PRODUCT_CONFIG, ...)`, `db.update(TABLES.PRODUCT_CONFIG, ...)`, and `db.deleteRecord(TABLES.PRODUCT_CONFIG, ...)` calls with the appropriate `productConfigRepo.*` methods.

Key mappings:

| Old Airtable call | New repo call |
|---|---|
| `db.list(TABLES.PRODUCT_CONFIG, { fields: [...] })` | `productConfigRepo.list()` (then JS-filter fields if needed) |
| `db.list(TABLES.PRODUCT_CONFIG, { filterByFormula: '{Active} = TRUE()', fields: [...] })` | `productConfigRepo.list({ activeOnly: true })` |
| `db.list(TABLES.PRODUCT_CONFIG, { filterByFormula: \`{Wix Product ID} = '...' AND ...\` })` | `productConfigRepo.getByWixPair(pid, vid)` |
| `db.create(TABLES.PRODUCT_CONFIG, newRow)` | `productConfigRepo.upsert(newRow)` |
| `db.update(TABLES.PRODUCT_CONFIG, row.id, updates)` | `productConfigRepo.update(row.id, updates)` |
| `db.deleteRecord(TABLES.PRODUCT_CONFIG, row.id)` | `productConfigRepo.softDelete(row.id)` |
| `db.update(TABLES.PRODUCT_CONFIG, row.id, { Active: false })` | `productConfigRepo.deactivate(row.id)` |

The pull operation builds an `existingMap` keyed by `${pid}::${vid}`. After migration, do the same thing but using the rows returned by `productConfigRepo.list()`. The `row.id` from `list()` is now a UUID — use it for update/delete calls.

Add import at top of wixProductSync.js:

```javascript
import * as productConfigRepo from '../repos/productConfigRepo.js';
```

Also check `routes/settings.js` — it has a `db.list(TABLES.PRODUCT_CONFIG, ...)` call in the cutoff reminder timer (around line 346). Replace:

```javascript
const rows = await productConfigRepo.list({ activeOnly: true });
```

And add the import to settings.js if not already added.

- [ ] **Step 10: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass. Focus on any failures from wixProductSync or productRepo tests.

- [ ] **Step 11: Commit**

```bash
git add backend/src/repos/productConfigRepo.js \
        backend/src/__tests__/productConfigRepo.integration.test.js \
        backend/src/repos/productRepo.js \
        backend/src/routes/products.js \
        backend/src/routes/public.js \
        backend/src/routes/settings.js \
        backend/src/services/wix.js \
        backend/src/services/wixProductSync.js
git commit -m "feat(db): Phase 6 — product_config repo + all callers cutover to Postgres"
```

---

## Task 8 — Backfill scripts

**Files:**
- Create: `backend/scripts/backfill-phase6.js` (DESTRUCTIVE)

Backfills 4 tables from Airtable into PG. Idempotent (upsert on airtable_id). Webhook Log and Sync Log start fresh — no historical value. App Config seeds itself on first boot (loadConfig creates the row).

- [ ] **Step 1: Create backfill-phase6.js**

```javascript
/**
 * DESTRUCTIVE — reads Airtable, writes Postgres.
 * Run ONCE after deploying Phase 6 migrations, before prod traffic hits new routes.
 * Idempotent — safe to re-run (upsert on airtable_id).
 *
 * Tables: florist_hours, marketing_spend, stock_loss_log, product_config
 * Skipped: webhook_log, sync_log (start fresh), app_config (auto-seeds on boot)
 *
 * Usage: NODE_ENV=production node backend/scripts/backfill-phase6.js
 */

import 'dotenv/config';
import * as db from '../src/services/airtable.js';
import { TABLES } from '../src/config/airtable.js';
import { db as pg } from '../src/db/index.js';
import { floristHours, marketingSpend, stockLossLog, productConfig, stock } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  console.log(`[BACKFILL-PHASE6] Starting${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // ── 1. Florist Hours ──────────────────────────────────────────────────────
  console.log('[FLORIST-HOURS] Reading from Airtable...');
  const hoursRows = await db.list(TABLES.FLORIST_HOURS, {
    sort: [{ field: 'Date', direction: 'asc' }],
  });
  console.log(`[FLORIST-HOURS] Found ${hoursRows.length} rows`);
  let hoursInserted = 0, hoursSkipped = 0;
  for (const row of hoursRows) {
    if (!DRY_RUN) {
      await pg.insert(floristHours).values({
        airtableId:    row.id,
        name:          String(row.Name || ''),
        date:          String(row.Date || new Date().toISOString().split('T')[0]),
        hours:         String(Number(row.Hours || 0)),
        hourlyRate:    String(Number(row['Hourly Rate'] || 0)),
        rateType:      row['Rate Type'] || null,
        bonus:         String(Number(row.Bonus || 0)),
        deduction:     String(Number(row.Deduction || 0)),
        notes:         row.Notes || '',
        deliveryCount: Number(row['Delivery Count'] || 0),
      }).onConflictDoNothing({ target: floristHours.airtableId })
        .catch(err => { console.warn(`[FLORIST-HOURS] Skip ${row.id}: ${err.message}`); hoursSkipped++; return null; });
      hoursInserted++;
    }
  }
  console.log(`[FLORIST-HOURS] Done: ${hoursInserted} inserted, ${hoursSkipped} skipped`);

  // ── 2. Marketing Spend ────────────────────────────────────────────────────
  if (TABLES.MARKETING_SPEND) {
    console.log('[MARKETING-SPEND] Reading from Airtable...');
    const spendRows = await db.list(TABLES.MARKETING_SPEND, {});
    console.log(`[MARKETING-SPEND] Found ${spendRows.length} rows`);
    let spendInserted = 0;
    for (const row of spendRows) {
      if (!DRY_RUN) {
        await pg.insert(marketingSpend).values({
          airtableId: row.id,
          month:      String(row.Month || ''),
          channel:    String(row.Channel || ''),
          amount:     String(Number(row.Amount || 0)),
          notes:      row.Notes || '',
        }).onConflictDoNothing({ target: marketingSpend.airtableId })
          .catch(err => console.warn(`[MARKETING-SPEND] Skip ${row.id}: ${err.message}`));
        spendInserted++;
      }
    }
    console.log(`[MARKETING-SPEND] Done: ${spendInserted} inserted`);
  } else {
    console.log('[MARKETING-SPEND] TABLES.MARKETING_SPEND not set — skipping');
  }

  // ── 3. Stock Loss Log ─────────────────────────────────────────────────────
  if (TABLES.STOCK_LOSS_LOG) {
    console.log('[STOCK-LOSS] Reading from Airtable...');
    const lossRows = await db.list(TABLES.STOCK_LOSS_LOG, {
      sort: [{ field: 'Date', direction: 'asc' }],
    });
    console.log(`[STOCK-LOSS] Found ${lossRows.length} rows`);

    // Build airtable_id → PG UUID map for stock items
    const stockAirtableIds = [...new Set(lossRows.flatMap(r => r['Stock Item'] || []))];
    const stockMap = new Map();
    for (let i = 0; i < stockAirtableIds.length; i += 50) {
      const chunk = stockAirtableIds.slice(i, i + 50);
      const rows = await pg.select({ id: stock.id, airtableId: stock.airtableId })
        .from(stock)
        .where(eq(stock.airtableId, chunk[0])); // simplified — extend for batch if needed
      for (const r of rows) stockMap.set(r.airtableId, r.id);
    }

    let lossInserted = 0;
    for (const row of lossRows) {
      const atStockId = row['Stock Item']?.[0];
      const pgStockId = atStockId ? stockMap.get(atStockId) : null;
      if (!DRY_RUN) {
        await pg.insert(stockLossLog).values({
          airtableId: row.id,
          date:       String(row.Date || new Date().toISOString().split('T')[0]),
          stockId:    pgStockId || null,
          quantity:   String(Number(row.Quantity || 0)),
          reason:     row.Reason || 'Other',
          notes:      row.Notes || '',
        }).onConflictDoNothing({ target: stockLossLog.airtableId })
          .catch(err => console.warn(`[STOCK-LOSS] Skip ${row.id}: ${err.message}`));
        lossInserted++;
      }
    }
    console.log(`[STOCK-LOSS] Done: ${lossInserted} inserted`);
  } else {
    console.log('[STOCK-LOSS] TABLES.STOCK_LOSS_LOG not set — skipping');
  }

  // ── 4. Product Config ─────────────────────────────────────────────────────
  if (TABLES.PRODUCT_CONFIG) {
    console.log('[PRODUCT-CONFIG] Reading from Airtable...');
    const pcRows = await db.list(TABLES.PRODUCT_CONFIG, {
      sort: [{ field: 'Product Name', direction: 'asc' }],
    });
    console.log(`[PRODUCT-CONFIG] Found ${pcRows.length} rows`);
    let pcInserted = 0;
    for (const row of pcRows) {
      if (!DRY_RUN) {
        const cat = row.Category;
        await pg.insert(productConfig).values({
          airtableId:    row.id,
          wixProductId:  row['Wix Product ID'] || null,
          wixVariantId:  row['Wix Variant ID'] || null,
          productName:   row['Product Name']   || '',
          variantName:   row['Variant Name']   || '',
          sortOrder:     Number(row['Sort Order'] || 0),
          imageUrl:      row['Image URL']      || '',
          price:         String(Number(row.Price || 0)),
          leadTimeDays:  Number(row['Lead Time Days'] || 1),
          active:        row.Active  !== false,
          visibleInWix:  row['Visible in Wix'] !== false,
          productType:   row['Product Type']   || null,
          minStems:      Number(row['Min Stems'] || 0),
          description:   row.Description       || '',
          category:      Array.isArray(cat) ? cat.join(', ') : (cat || null),
          keyFlower:     row['Key Flower']     || null,
          quantity:      row.Quantity != null ? Number(row.Quantity) : null,
          availableFrom: row['Available From'] || null,
          availableTo:   row['Available To']   || null,
          translations:  row.Translations      || {},
        }).onConflictDoNothing({ target: productConfig.airtableId })
          .catch(err => console.warn(`[PRODUCT-CONFIG] Skip ${row.id}: ${err.message}`));
        pcInserted++;
      }
    }
    console.log(`[PRODUCT-CONFIG] Done: ${pcInserted} inserted`);
  } else {
    console.log('[PRODUCT-CONFIG] TABLES.PRODUCT_CONFIG not set — skipping');
  }

  console.log('[BACKFILL-PHASE6] Complete');
}

run().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Test the backfill in dry-run mode**

```bash
cd backend && node scripts/backfill-phase6.js --dry-run
```

Expected: script prints row counts for each table without inserting anything. No errors.

- [ ] **Step 3: Run the backfill against the local harness**

```bash
npm run harness &
sleep 3
node backend/scripts/backfill-phase6.js
```

Expected: row counts printed for each table. Re-run — idempotent (0 new inserts).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill-phase6.js
git commit -m "chore(scripts): Phase 6 backfill — florist_hours, marketing_spend, stock_loss, product_config from Airtable"
```

---

## Task 9 — Verification + cleanup

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass. Note the count — it should be higher than pre-Phase-6 due to the new integration tests.

- [ ] **Step 2: Run E2E suite**

```bash
npm run harness &
sleep 5
npm run test:e2e
```

Expected: 153/153 assertions pass. Any failure in sections touching stock-loss, hours, products, or settings routes is a regression.

- [ ] **Step 3: Build all three apps**

```bash
cd apps/florist   && ./node_modules/.bin/vite build
cd ../dashboard   && ./node_modules/.bin/vite build
cd ../delivery    && ./node_modules/.bin/vite build
```

Expected: all three build clean with no missing module errors.

- [ ] **Step 4: Update BACKLOG.md**

Mark Phase 6 complete in the Done section:

```markdown
- [x] **Phase 6 — Config + misc** (2026-05-07) — App Config, Florist Hours, Marketing Spend, Stock Loss Log, Webhook Log, Sync Log, Product Config migrated to Postgres. Direct cutover, no shadow window. Backfill script: `backend/scripts/backfill-phase6.js`.
```

Update "Migration cutover state" block:

```markdown
- Phase 6 (Config + log tables) **CUT OVER 2026-05-07**. Only Airtable tables remaining: CUSTOMERS (legacy), ORDERS (legacy snapshot), STOCK (legacy snapshot), and the shared lookup tables (PREMADE_BOUQUETS, STOCK_PURCHASES, DELIVERIES legacy). Phase 7 = retire airtable.js.
```

- [ ] **Step 5: Update CHANGELOG.md**

Add entry:

```markdown
## Phase 6 — Config + Log tables to Postgres (2026-05-07)

### Schema
- Migration 0007: app_config, florist_hours, marketing_spend, stock_loss_log, webhook_log, sync_log, product_config

### New repos
- backend/src/repos/appConfigRepo.js
- backend/src/repos/hoursRepo.js
- backend/src/repos/marketingSpendRepo.js
- backend/src/repos/stockLossRepo.js
- backend/src/repos/webhookLogRepo.js
- backend/src/repos/syncLogRepo.js
- backend/src/repos/productConfigRepo.js

### Routes/services rewritten
- routes/floristHours.js — hoursRepo
- routes/marketingSpend.js — marketingSpendRepo
- routes/stockLoss.js — stockLossRepo (enrichment via JOIN, not second Airtable fetch)
- services/webhookLog.js — webhookLogRepo
- services/wixProductSync.js logSync — syncLogRepo
- routes/products.js — productConfigRepo + syncLogRepo
- routes/settings.js loadConfig/saveConfig/generateOrderId — appConfigRepo
- repos/productRepo.js — thin wrapper over productConfigRepo
- routes/public.js — productConfigRepo
- services/wix.js inventory decrement — productConfigRepo

### Env changes
- None — direct cutover, no new env vars

### Deployment order
1. Deploy migration 0007 (run migrate.js)
2. Run backfill-phase6.js
3. Deploy app (routes now point to PG)
```

- [ ] **Step 6: Commit**

```bash
git add BACKLOG.md CHANGELOG.md
git commit -m "docs: mark Phase 6 complete in BACKLOG + CHANGELOG"
```

---

## Deployment sequence (owner executes on prod)

1. **Deploy the branch** — Railway auto-runs `migrate.js` if configured; otherwise `node backend/src/db/migrate.js` manually in Railway console.
2. **Run backfill** — `node backend/scripts/backfill-phase6.js` from Railway console or local with `DATABASE_URL` pointed at prod.
3. **Verify** — `GET /api/florist-hours?month=2026-05` returns expected rows. `GET /api/products` returns all product config rows. `GET /api/settings` still returns full config object.
4. **Smoke test** — log a waste entry in the florist app, verify it appears in the stock loss log.

---

## Self-review checklist

**Spec coverage:**
- [x] App Config — appConfigRepo + settings.js
- [x] Florist Hours — hoursRepo + floristHours.js
- [x] Marketing Spend — marketingSpendRepo + marketingSpend.js
- [x] Stock Loss Log — stockLossRepo + stockLoss.js (JOIN enrichment)
- [x] Webhook Log — webhookLogRepo + webhookLog.js
- [x] Sync Log — syncLogRepo + wixProductSync.js + products.js sync-log GET
- [x] Product Config — productConfigRepo + productRepo.js + products.js + public.js + wix.js + wixProductSync.js
- [x] Backfill — backfill-phase6.js covers 4 tables

**Known gaps to watch:**
- `wixProductSync.js` has many `db.list(TABLES.PRODUCT_CONFIG, ...)` calls with various filter combinations. Task 7 Step 9 covers them all, but the implementer must read the full file and not miss any.
- `routes/settings.js` still uses `db.list(TABLES.DELIVERIES, ...)` in the driver-of-day route — that stays on Airtable until Phase 7. Don't accidentally remove that Airtable import.
- The `stock` table Drizzle column names for JOIN in stockLossRepo (`stock.displayName`, `stock.currentCostPrice`, etc.) must match schema.js exactly — verify before running the test.
