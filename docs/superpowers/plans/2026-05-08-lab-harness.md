# Lab Harness v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Docker-Postgres rehearsal harness with synthetic fixtures, agent-drivable, alongside the existing pglite E2E harness. Enables seeded UI inspection + automated test paths for major overhauls (Stock redesign first).

**Architecture:** Postgres 15 in Docker on `:5433`. Drizzle migrations from `backend/src/db/migrations/` apply at boot. Synthetic factory functions build entities; named scenarios compose them. Sub-second per-test isolation via Postgres template-database clone (`CREATE DATABASE ... TEMPLATE`). Two test surfaces: API (vitest, fast logic assertions) and UI (Playwright, click-through flows). Coexists with existing pglite harness — does not replace it. Per ADR `docs/adr/0004-lab-harness-rehearsal-env.md`.

**Tech Stack:** Docker Compose, Postgres 15, Node.js, pg (node-postgres), Drizzle ORM (migrations only — schema reused from `backend/src/db/schema.js`), Vitest, Playwright, `@faker-js/faker` for synthetic data.

---

## File Structure

**Root additions:**
- `docker-compose.lab.yml` — Postgres 15 service on `:5433`
- `playwright.lab.config.js` — separate Playwright config for lab UI tests

**New `lab/` directory (not a workspace, shares root + backend deps):**
- `lab/README.md` — agent + owner invocation guide
- `lab/vitest.config.js` — vitest config scoped to lab tests + factory tests
- `lab/package.json` — lab-only dev deps (`@faker-js/faker`)
- `lab/factories/` — entity factories, one file per entity, each colocated with `.test.js`
  - `customer.js`, `customer.test.js`
  - `stockItem.js`, `stockItem.test.js`
  - `order.js`, `order.test.js`
  - `orderLine.js` (no separate test — covered via order test)
  - `delivery.js`, `delivery.test.js`
  - `index.js` — re-exports
- `lab/scenarios/` — composed fixtures
  - `baseline.js`, `baseline.test.js`
  - `stockOverhaul.js`
  - `index.js` — registry mapping scenario name → builder fn
- `lab/helpers/`
  - `db.js` — pg.Pool factory pointed at lab DB
  - `seed.js` — orchestrates factories → DB inserts in dependency order
  - `reset.js` — template-DB clone reset
  - `api.js` — fetch wrapper with auth headers for lab API tests
  - `mocks.js` — Telegram + Claude AI deterministic stubs (lab-test-only helpers)
- `lab/scripts/`
  - `start-lab-backend.js` — boots backend pointed at lab PG
  - `start-lab-dev.js` — boots backend + 3 frontends (Concurrently)
  - `seed-cli.js` — `npm run lab:seed -- --scenario=X`
  - `rebuild-template.js` — drops + reseeds `lab_template`
- `lab/tests/`
  - `api/` — vitest API tests
    - `cancel-with-return.test.js`
  - `ui/` — Playwright UI tests
    - `stock-tab-smoke.spec.js`
  - `exploratory/README.md` — how an agent uses the lab interactively

**Root `package.json` script additions:**
- `lab:db:up`, `lab:db:down`, `lab:db:logs`
- `lab:migrate`
- `lab:template:rebuild`
- `lab:seed`
- `lab:reset`
- `lab:backend`, `lab:dev`
- `lab:test:unit`, `lab:test:api`, `lab:test:ui`

**CI additions to `.github/workflows/test.yml`:**
- New `lab-api` job: spins up Postgres service, runs `npm run lab:test:unit` + `npm run lab:test:api`. Existing `e2e` (pglite) job stays untouched.

---

## Conventions

- Factories take an optional `overrides` object and return a row-shaped JS object matching `backend/src/db/schema.js`. They do NOT insert — `helpers/seed.js` does.
- Factories must be deterministic when given a seed via `faker.seed(N)`. The seed is set once per scenario builder.
- Scenario builders return `{ customers, stockItems, orders, orderLines, deliveries, ... }` — plain arrays of rows. `seed.js` inserts them in FK order.
- Reset uses Postgres `CREATE DATABASE lab TEMPLATE lab_template` — requires no active connections to `lab` at reset time. Pool drains before reset.
- Lab DB: `postgres://lab:lab@localhost:5433/lab`. Template DB: `lab_template`. Both live in the Docker volume.
- Lab backend listens on `:3003` (3001 = real local backend, 3002 = pglite harness, 3003 = lab — three layers, three ports, no collisions).
- Lab Vite dev servers: florist `:5176`, dashboard `:5177`, delivery `:5178` (existing harness uses 5173–5175).

---

## Task 1: Docker Compose + lab Postgres boot

**Files:**
- Create: `docker-compose.lab.yml`
- Modify: `package.json` (add `lab:db:up`, `lab:db:down`, `lab:db:logs`, `lab:migrate`)
- Modify: `.gitignore` (add `lab/.tmp/` for any local scratch)

- [ ] **Step 1: Write `docker-compose.lab.yml`**

```yaml
# docker-compose.lab.yml
# Local Postgres 15 for the lab harness. Port 5433 to avoid colliding with
# any other Postgres on :5432. Volume persists across `compose down/up` so
# the template DB survives between sessions.
services:
  postgres:
    image: postgres:15-alpine
    container_name: flower-lab-pg
    environment:
      POSTGRES_USER: lab
      POSTGRES_PASSWORD: lab
      POSTGRES_DB: lab
    ports:
      - "5433:5432"
    volumes:
      - lab-pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lab -d lab"]
      interval: 2s
      timeout: 2s
      retries: 20

volumes:
  lab-pg-data:
```

- [ ] **Step 2: Add lab scripts to root `package.json`**

In the `scripts` block, add after `"test:e2e:ui"`:

```json
"lab:db:up": "docker compose -f docker-compose.lab.yml up -d postgres && docker compose -f docker-compose.lab.yml exec -T postgres sh -c 'until pg_isready -U lab -d lab; do sleep 0.5; done'",
"lab:db:down": "docker compose -f docker-compose.lab.yml down",
"lab:db:logs": "docker compose -f docker-compose.lab.yml logs -f postgres",
"lab:migrate": "DATABASE_URL=postgres://lab:lab@localhost:5433/lab node backend/src/db/migrate.js"
```

- [ ] **Step 3: Verify Postgres boots and migrations apply**

Run:
```
npm run lab:db:up
npm run lab:migrate
```

Expected output: `[PG] Applying N pending migration(s):` followed by every file under `backend/src/db/migrations/`. Then `[PG] All migrations applied.`

If `pg_isready` loop times out: confirm Docker Desktop is running, port 5433 is free (`lsof -nP -iTCP:5433`).

- [ ] **Step 4: Verify schema is present**

Run:
```
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "\dt"
```

Expected: tables `audit_log`, `system_meta`, `stock`, `parity_log`, `orders`, `order_lines`, `deliveries`, `customers`, `app_config`, `feedback_*`, `stock_purchases`, `stock_orders`, `stock_order_lines`, `premade_bouquets`, `premade_bouquet_lines` (whichever exist after migration 0011).

- [ ] **Step 5: Add `lab/.tmp/` to `.gitignore`**

Append to `.gitignore`:
```
# Lab harness scratch
lab/.tmp/
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.lab.yml package.json .gitignore
git commit -m "feat(lab): add Docker Compose Postgres + db lifecycle scripts"
```

---

## Task 2: Lab backend boot script

**Files:**
- Create: `lab/scripts/start-lab-backend.js`
- Create: `lab/package.json`
- Modify: `package.json` (add `lab:backend`)

- [ ] **Step 1: Create `lab/package.json`**

```json
{
  "name": "flower-lab",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Local Docker-PG rehearsal harness. See lab/README.md.",
  "devDependencies": {
    "@faker-js/faker": "^9.0.0"
  }
}
```

- [ ] **Step 2: Install lab deps from repo root**

```
npm install --save-dev --workspace lab @faker-js/faker
```

If `lab` is not yet a workspace, instead run from inside `lab/`:
```
cd lab && npm install
```

(We do NOT add `lab` to the root `workspaces` array — keeping it out simplifies CI install and avoids hoisting surprises with the apps. Lab depends on root devDeps via Node's module resolution.)

- [ ] **Step 3: Write `lab/scripts/start-lab-backend.js`**

```javascript
// lab/scripts/start-lab-backend.js — boot the backend against Docker PG.
//
// Mirrors backend/scripts/start-test-backend.js but points DATABASE_URL at
// the Docker container instead of pglite. Uses port 3003 to avoid clashing
// with the real local backend (3001) and the pglite harness (3002).
//
// Refuses to boot under NODE_ENV=production. The lab DSN talks to a local
// container, so the worst-case blast radius is wiping the local lab DB —
// not prod — but the production guard stays as belt-and-braces.

if (process.env.NODE_ENV === 'production') {
  console.error('[FATAL] Refusing to start lab backend under NODE_ENV=production.');
  process.exit(1);
}

const LAB_ENV = {
  NODE_ENV:                          process.env.NODE_ENV || 'test',
  DATABASE_URL:                      'postgres://lab:lab@localhost:5433/lab',
  STOCK_BACKEND:                     'postgres',
  ORDER_BACKEND:                     'postgres',
  TEST_BACKEND:                      'mock-airtable',
  PORT:                              process.env.PORT || '3003',

  PIN_OWNER:                         '1111',
  PIN_FLORIST:                       '2222',
  PIN_DRIVER_TIMUR:                  '3333',
  PIN_DRIVER_NIKITA:                 '4444',

  // Airtable identity — mock backend ignores values, but config/airtable.js
  // initialises the SDK defensively. Mirror start-test-backend.js exactly.
  AIRTABLE_API_KEY:                  'lab-mock-key',
  AIRTABLE_BASE_ID:                  'appLabBase',
  AIRTABLE_CUSTOMERS_TABLE:          'tblLabCustomers',
  AIRTABLE_ORDERS_TABLE:             'tblLabOrders',
  AIRTABLE_ORDER_LINES_TABLE:        'tblLabOrderLines',
  AIRTABLE_STOCK_TABLE:              'tblLabStock',
  AIRTABLE_DELIVERIES_TABLE:         'tblLabDeliveries',
  AIRTABLE_STOCK_PURCHASES_TABLE:    'tblLabStockPurchases',
  AIRTABLE_STOCK_ORDERS_TABLE:       'tblLabStockOrders',
  AIRTABLE_STOCK_ORDER_LINES_TABLE:  'tblLabStockOrderLines',
  AIRTABLE_PRODUCT_CONFIG_TABLE:     'tblLabProductConfig',
  AIRTABLE_SYNC_LOG_TABLE:           'tblLabSyncLog',
  AIRTABLE_APP_CONFIG_TABLE:         'tblLabAppConfig',
  AIRTABLE_FLORIST_HOURS_TABLE:      'tblLabFloristHours',
  AIRTABLE_WEBHOOK_LOG_TABLE:        'tblLabWebhookLog',
  AIRTABLE_MARKETING_SPEND_TABLE:    'tblLabMarketingSpend',
  AIRTABLE_STOCK_LOSS_LOG_TABLE:     'tblLabStockLossLog',
  AIRTABLE_LEGACY_ORDERS_TABLE:      'tblLabLegacyOrders',
  AIRTABLE_PREMADE_BOUQUETS_TABLE:   'tblLabPremadeBouquets',
  AIRTABLE_PREMADE_BOUQUET_LINES_TABLE: 'tblLabPremadeBouquetLines',

  // Third-party stubs — same pattern as start-test-backend.js.
  ANTHROPIC_API_KEY:                 'lab-mock-anthropic',
  TELEGRAM_BOT_TOKEN:                'lab-mock-telegram',
  WIX_WEBHOOK_SECRET:                'lab-mock-wix-secret',
  WIX_API_KEY:                       'lab-mock-wix-api-key',
  WIX_SITE_ID:                       'lab-mock-wix-site-id',
};

for (const [k, v] of Object.entries(LAB_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

console.log('[LAB] Booting backend against', process.env.DATABASE_URL, 'on :' + process.env.PORT);

await import('../../backend/src/index.js');
```

- [ ] **Step 4: Add `lab:backend` to root `package.json`**

```json
"lab:backend": "node lab/scripts/start-lab-backend.js"
```

- [ ] **Step 5: Verify backend boots against lab PG**

Pre-req: lab PG is up + migrated (`npm run lab:db:up && npm run lab:migrate`).

Run:
```
npm run lab:backend
```

Expected: log lines `[LAB] Booting backend against postgres://lab:lab@localhost:5433/lab on :3003`, then standard backend boot, then `Server listening on port 3003`.

In another terminal:
```
curl -s http://localhost:3003/api/health
```

Expected: 200 with health JSON.

Stop the server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add lab/ package.json
git commit -m "feat(lab): add lab backend boot script (Docker PG, port 3003)"
```

---

## Task 3: Customer + StockItem factories (TDD)

**Files:**
- Create: `lab/factories/customer.js`, `lab/factories/customer.test.js`
- Create: `lab/factories/stockItem.js`, `lab/factories/stockItem.test.js`
- Create: `lab/factories/index.js`
- Create: `lab/vitest.config.js`
- Modify: `package.json` (add `lab:test:unit`)

- [ ] **Step 1: Write `lab/vitest.config.js`**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'factories/**/*.test.js',
      'scenarios/**/*.test.js',
      'helpers/**/*.test.js',
      'tests/api/**/*.test.js',
    ],
    environment: 'node',
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2: Add `lab:test:unit` to root `package.json`**

```json
"lab:test:unit": "cd lab && npx vitest run --config vitest.config.js factories scenarios helpers"
```

- [ ] **Step 3: Write the failing test `lab/factories/customer.test.js`**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeCustomer } from './customer.js';

describe('makeCustomer', () => {
  beforeEach(() => faker.seed(42));

  it('returns a row matching the customers schema with realistic data', () => {
    const c = makeCustomer();
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);    // uuid
    expect(typeof c.name).toBe('string');
    expect(c.name.length).toBeGreaterThan(0);
    expect(typeof c.phone).toBe('string');
    expect(c.phone).toMatch(/^\+/);                         // E.164-ish
    expect(c.created_at).toBeInstanceOf(Date);
    expect(c.deleted_at).toBeNull();
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeCustomer();
    faker.seed(42);
    const b = makeCustomer();
    expect(a).toEqual(b);
  });

  it('honours overrides', () => {
    const c = makeCustomer({ name: 'Maria Schmidt', phone: '+48123456789' });
    expect(c.name).toBe('Maria Schmidt');
    expect(c.phone).toBe('+48123456789');
  });
});
```

- [ ] **Step 4: Run the test to verify failure**

Run: `npm run lab:test:unit`

Expected: FAIL — module `./customer.js` not found.

- [ ] **Step 5: Write minimal `lab/factories/customer.js`**

```javascript
// lab/factories/customer.js
//
// Synthetic Customer row — matches backend/src/db/schema.js `customers` table.
// PII-clean by construction (faker generates fake people).

import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';

export function makeCustomer(overrides = {}) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return {
    id: randomUUID(),
    airtable_id: null,
    name: `${firstName} ${lastName}`,
    phone: '+48' + faker.string.numeric(9),
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    address: faker.location.streetAddress(),
    notes: null,
    key_people: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  };
}
```

NOTE: The exact column list above MUST match the `customers` table in `backend/src/db/schema.js`. If schema has columns this factory omits, add them with sensible defaults. If it has columns this factory includes that don't exist, remove them. Run `\d customers` in psql against the lab DB to get the authoritative list before finalising.

- [ ] **Step 6: Run the test to verify pass**

Run: `npm run lab:test:unit`

Expected: 3 tests pass.

- [ ] **Step 7: Write the failing test `lab/factories/stockItem.test.js`**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeStockItem } from './stockItem.js';

describe('makeStockItem', () => {
  beforeEach(() => faker.seed(42));

  it('produces a Batch (with date suffix) by default', () => {
    const s = makeStockItem();
    expect(s.name).toMatch(/\(\d{2}\.[A-Z][a-z]{2}\.\)$/);  // "(06.May.)"
    expect(s.qty).toBeGreaterThanOrEqual(0);
  });

  it('produces a Demand Entry when type=demand', () => {
    const s = makeStockItem({ type: 'demand', name: 'Pink Peonies' });
    expect(s.name).toBe('Pink Peonies');
    expect(s.qty).toBeLessThan(0);  // demand = negative qty
  });

  it('honours qty + cost overrides', () => {
    const s = makeStockItem({ qty: 25, cost_price: 12.5, sell_price: 30 });
    expect(s.qty).toBe(25);
    expect(s.cost_price).toBe(12.5);
    expect(s.sell_price).toBe(30);
  });
});
```

- [ ] **Step 8: Write `lab/factories/stockItem.js`**

```javascript
// lab/factories/stockItem.js
//
// Synthetic Stock Item — matches backend/src/db/schema.js `stock` table.
// Two shapes per CONTEXT.md "Stock Item":
//   - Batch (default): variety name + arrival-date suffix "(DD.Mmm.)"
//   - Demand Entry (type='demand'): variety name only, qty < 0

import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';

const VARIETIES = [
  'Pink Peonies', 'White Roses', 'Red Roses', 'Yellow Tulips',
  'Eucalyptus', 'Lisianthus', 'Hydrangea', 'Ranunculus',
  'Anemone', 'Carnations', 'Chrysanthemum', 'Gypsophila',
];

function dateSuffix(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = d.toLocaleString('en-GB', { month: 'short' });
  return `(${dd}.${mmm}.)`;
}

export function makeStockItem(overrides = {}) {
  const { type = 'batch', ...rest } = overrides;
  const variety = rest.variety ?? faker.helpers.arrayElement(VARIETIES);
  const arrivalDate = rest.arrivalDate ?? faker.date.recent({ days: 7 });

  const name = type === 'demand'
    ? variety
    : `${variety} ${dateSuffix(arrivalDate)}`;

  const qty = type === 'demand'
    ? -faker.number.int({ min: 5, max: 30 })
    : faker.number.int({ min: 0, max: 100 });

  return {
    id: randomUUID(),
    airtable_id: null,
    name,
    qty,
    cost_price: Number(faker.commerce.price({ min: 3, max: 20 })),
    sell_price: Number(faker.commerce.price({ min: 8, max: 60 })),
    supplier: faker.helpers.arrayElement(['Ekipa', 'Hurt', 'Direct']),
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...rest,
  };
}
```

NOTE: again, reconcile column list against the `stock` table in `backend/src/db/schema.js`. Watch for fields like `length_cm` (Stock PRD), `notes`, `image_url`, etc.

- [ ] **Step 9: Run all factory tests**

Run: `npm run lab:test:unit`

Expected: 6 tests pass (3 customer + 3 stockItem).

- [ ] **Step 10: Write `lab/factories/index.js`**

```javascript
export { makeCustomer } from './customer.js';
export { makeStockItem } from './stockItem.js';
// Order/OrderLine/Delivery factories added in Task 4.
```

- [ ] **Step 11: Commit**

```bash
git add lab/factories/customer.js lab/factories/customer.test.js \
        lab/factories/stockItem.js lab/factories/stockItem.test.js \
        lab/factories/index.js lab/vitest.config.js \
        lab/package.json package.json
git commit -m "feat(lab): add Customer + StockItem factories with TDD coverage"
```

---

## Task 4: Order + OrderLine + Delivery factories (TDD)

**Files:**
- Create: `lab/factories/order.js`, `lab/factories/order.test.js`
- Create: `lab/factories/orderLine.js`
- Create: `lab/factories/delivery.js`, `lab/factories/delivery.test.js`
- Modify: `lab/factories/index.js`

- [ ] **Step 1: Write the failing test `lab/factories/order.test.js`**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeCustomer, makeStockItem } from './index.js';
import { makeOrder } from './order.js';
import { makeOrderLine } from './orderLine.js';

describe('makeOrder', () => {
  beforeEach(() => faker.seed(42));

  it('returns an order linked to a customer with default status New', () => {
    const customer = makeCustomer();
    const o = makeOrder({ customerId: customer.id });
    expect(o.customer_id).toBe(customer.id);
    expect(o.status).toBe('New');
    expect(['delivery', 'pickup']).toContain(o.delivery_type);
    expect(typeof o.required_by).toBe('string');  // ISO date
  });

  it('honours explicit status + delivery_type', () => {
    const o = makeOrder({ status: 'Ready', delivery_type: 'pickup' });
    expect(o.status).toBe('Ready');
    expect(o.delivery_type).toBe('pickup');
  });
});

describe('makeOrderLine', () => {
  it('snapshots cost + sell from the source stock item', () => {
    const stock = makeStockItem({ cost_price: 5, sell_price: 15 });
    const order = makeOrder();
    const line = makeOrderLine({ orderId: order.id, stockItemId: stock.id, qty: 3, costSnapshot: 5, sellSnapshot: 15 });
    expect(line.order_id).toBe(order.id);
    expect(line.stock_item_id).toBe(stock.id);
    expect(line.qty).toBe(3);
    expect(line.cost_snapshot).toBe(5);
    expect(line.sell_snapshot).toBe(15);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run lab:test:unit`

Expected: FAIL — `./order.js` and `./orderLine.js` not found.

- [ ] **Step 3: Write `lab/factories/order.js`**

```javascript
// lab/factories/order.js
//
// Synthetic Order row — matches backend/src/db/schema.js `orders` table.
// Status values come from backend/src/constants/statuses.js (ORDER_STATUS).

import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';

const STATUSES = ['New', 'Ready', 'Out for Delivery', 'Delivered', 'Picked Up', 'Cancelled'];

export function makeOrder(overrides = {}) {
  const requiredByDate = overrides.required_by
    ?? faker.date.soon({ days: 14 }).toISOString().slice(0, 10);

  return {
    id: randomUUID(),
    airtable_id: null,
    customer_id: overrides.customerId ?? null,
    status: 'New',
    delivery_type: faker.helpers.arrayElement(['delivery', 'pickup']),
    required_by: requiredByDate,
    delivery_time: '14:00',
    payment_method: faker.helpers.arrayElement(['Cash', 'Card', 'Transfer']),
    payment_status: 'Unpaid',
    source: faker.helpers.arrayElement(['In-store', 'Instagram', 'WhatsApp', 'Wix']),
    total_price: Number(faker.commerce.price({ min: 80, max: 400 })),
    delivery_fee: 0,
    notes: null,
    florist_note: null,
    card_message: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
    customer_id: overrides.customerId ?? overrides.customer_id ?? null,
  };
}

// Re-export status list so scenarios can pick valid values.
export const ORDER_STATUSES = STATUSES;
```

NOTE: reconcile against actual `orders` schema. Add any missing columns (e.g. `image_url`, `wix_order_id`, `recipient_*` if those live on orders vs deliveries).

- [ ] **Step 4: Write `lab/factories/orderLine.js`**

```javascript
// lab/factories/orderLine.js
//
// Synthetic Order Line — matches `order_lines` in schema.
// Snapshots cost + sell at creation time per CLAUDE.md Airtable Rules.

import { randomUUID } from 'crypto';

export function makeOrderLine(overrides = {}) {
  return {
    id: randomUUID(),
    airtable_id: null,
    order_id: overrides.orderId ?? overrides.order_id ?? null,
    stock_item_id: overrides.stockItemId ?? overrides.stock_item_id ?? null,
    flower_name: overrides.flower_name ?? null,
    qty: 1,
    cost_snapshot: 0,
    sell_snapshot: 0,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
    order_id: overrides.orderId ?? overrides.order_id ?? null,
    stock_item_id: overrides.stockItemId ?? overrides.stock_item_id ?? null,
    cost_snapshot: overrides.costSnapshot ?? overrides.cost_snapshot ?? 0,
    sell_snapshot: overrides.sellSnapshot ?? overrides.sell_snapshot ?? 0,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run lab:test:unit`

Expected: order + orderLine tests pass. Total now 8.

- [ ] **Step 6: Write the failing test `lab/factories/delivery.test.js`**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeOrder } from './order.js';
import { makeDelivery } from './delivery.js';

describe('makeDelivery', () => {
  beforeEach(() => faker.seed(42));

  it('links to an order with default Pending status', () => {
    const order = makeOrder({ delivery_type: 'delivery' });
    const d = makeDelivery({ orderId: order.id });
    expect(d.order_id).toBe(order.id);
    expect(d.status).toBe('Pending');
    expect(d.recipient_name).toBeTruthy();
    expect(d.recipient_phone).toMatch(/^\+/);
    expect(d.address).toBeTruthy();
    expect(d.delivery_fee).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 7: Write `lab/factories/delivery.js`**

```javascript
// lab/factories/delivery.js
//
// Synthetic Delivery — matches `deliveries` in schema.
// Linked 1:1 to a delivery-type Order. Recipient ≠ Customer (often).

import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';

export function makeDelivery(overrides = {}) {
  return {
    id: randomUUID(),
    airtable_id: null,
    order_id: overrides.orderId ?? overrides.order_id ?? null,
    status: 'Pending',
    recipient_name: faker.person.fullName(),
    recipient_phone: '+48' + faker.string.numeric(9),
    address: faker.location.streetAddress({ useFullAddress: true }),
    driver: null,
    delivery_fee: faker.number.int({ min: 15, max: 40 }),
    delivery_result: null,
    delivery_notes: null,
    driver_note: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
    order_id: overrides.orderId ?? overrides.order_id ?? null,
  };
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm run lab:test:unit`

Expected: 9 tests pass.

- [ ] **Step 9: Update `lab/factories/index.js`**

```javascript
export { makeCustomer } from './customer.js';
export { makeStockItem } from './stockItem.js';
export { makeOrder, ORDER_STATUSES } from './order.js';
export { makeOrderLine } from './orderLine.js';
export { makeDelivery } from './delivery.js';
```

- [ ] **Step 10: Commit**

```bash
git add lab/factories/
git commit -m "feat(lab): add Order, OrderLine, Delivery factories"
```

---

## Task 5: Scenario composer + baseline scenario (TDD)

**Files:**
- Create: `lab/helpers/db.js`
- Create: `lab/helpers/seed.js`
- Create: `lab/scenarios/baseline.js`, `lab/scenarios/baseline.test.js`
- Create: `lab/scenarios/index.js`

- [ ] **Step 1: Write `lab/helpers/db.js`**

```javascript
// lab/helpers/db.js
//
// pg.Pool factories pointed at the lab DB or template DB.
// Tests connect, do their work, end the pool.

import pg from 'pg';

const HOST = 'localhost';
const PORT = 5433;
const USER = 'lab';
const PASSWORD = 'lab';

export function labPool(database = 'lab') {
  return new pg.Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database });
}

export function adminPool() {
  // Connects to `postgres` system DB so we can DROP/CREATE the lab DB.
  return new pg.Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
}
```

- [ ] **Step 2: Write `lab/helpers/seed.js`**

```javascript
// lab/helpers/seed.js
//
// Insert a fixture (returned by a scenario builder) into Postgres.
// Inserts in FK order: customers → stock → orders → order_lines → deliveries.
// Uses a single transaction so partial seeds don't leave the DB inconsistent.

export async function seedFixture(pool, fixture) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertMany(client, 'customers', fixture.customers ?? []);
    await insertMany(client, 'stock', fixture.stockItems ?? []);
    await insertMany(client, 'orders', fixture.orders ?? []);
    await insertMany(client, 'order_lines', fixture.orderLines ?? []);
    await insertMany(client, 'deliveries', fixture.deliveries ?? []);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertMany(client, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const colList = columns.map(quoteIdent).join(', ');
  const placeholders = rows.map((_, i) =>
    '(' + columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ') + ')'
  ).join(', ');
  const values = rows.flatMap(r => columns.map(c => r[c]));
  await client.query(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${placeholders}`, values);
}

function quoteIdent(s) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
}
```

- [ ] **Step 3: Write the failing test `lab/scenarios/baseline.test.js`**

```javascript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildBaseline } from './baseline.js';
import { seedFixture } from '../helpers/seed.js';
import { labPool, adminPool } from '../helpers/db.js';

const TEMPLATE = 'lab_template_test';
const TARGET = 'lab_test_baseline';

describe('baseline scenario', () => {
  it('produces 5 customers, 30 stock items, 12 orders with FK integrity', () => {
    const fx = buildBaseline();
    expect(fx.customers).toHaveLength(5);
    expect(fx.stockItems).toHaveLength(30);
    expect(fx.orders).toHaveLength(12);
    expect(fx.orderLines.length).toBeGreaterThan(0);
    // Every order_line.order_id matches an order id
    const orderIds = new Set(fx.orders.map(o => o.id));
    for (const ol of fx.orderLines) expect(orderIds.has(ol.order_id)).toBe(true);
    // Every order.customer_id matches a customer id
    const customerIds = new Set(fx.customers.map(c => c.id));
    for (const o of fx.orders) expect(customerIds.has(o.customer_id)).toBe(true);
  });

  it('is deterministic across two builds', () => {
    const a = buildBaseline();
    const b = buildBaseline();
    expect(a.customers[0]).toEqual(b.customers[0]);
    expect(a.orders[0]).toEqual(b.orders[0]);
  });
});
```

- [ ] **Step 4: Write `lab/scenarios/baseline.js`**

```javascript
// lab/scenarios/baseline.js
//
// Baseline fixture: minimal-but-realistic dataset every test starts from.
// Composition: 5 customers, 30 stock items (20 batches + 10 demand entries),
// 12 orders across statuses, ~25 order lines, 8 deliveries (one per
// delivery-type order).
//
// Determinism: faker.seed(1) + Math.seedrandom not needed because faker
// alone covers all our random calls. Same seed = same fixture.

import { faker } from '@faker-js/faker';
import { makeCustomer, makeStockItem, makeOrder, makeOrderLine, makeDelivery } from '../factories/index.js';

export function buildBaseline() {
  faker.seed(1);

  const customers = Array.from({ length: 5 }, () => makeCustomer());
  const batches  = Array.from({ length: 20 }, () => makeStockItem());
  const demands  = Array.from({ length: 10 }, () => makeStockItem({ type: 'demand' }));
  const stockItems = [...batches, ...demands];

  const orders = [];
  const orderLines = [];
  const deliveries = [];

  const statusMix = ['New', 'New', 'New', 'Ready', 'Ready', 'Out for Delivery',
                     'Delivered', 'Delivered', 'Picked Up', 'Cancelled', 'New', 'Ready'];

  for (let i = 0; i < 12; i++) {
    const customer = faker.helpers.arrayElement(customers);
    const deliveryType = i % 3 === 0 ? 'pickup' : 'delivery';
    const o = makeOrder({
      customerId: customer.id,
      status: statusMix[i],
      delivery_type: deliveryType,
    });
    orders.push(o);

    const lineCount = faker.number.int({ min: 1, max: 3 });
    for (let j = 0; j < lineCount; j++) {
      const stock = faker.helpers.arrayElement(stockItems);
      orderLines.push(makeOrderLine({
        orderId: o.id,
        stockItemId: stock.id,
        qty: faker.number.int({ min: 1, max: 5 }),
        costSnapshot: stock.cost_price,
        sellSnapshot: stock.sell_price,
      }));
    }

    if (deliveryType === 'delivery') {
      deliveries.push(makeDelivery({ orderId: o.id }));
    }
  }

  return { customers, stockItems, orders, orderLines, deliveries };
}
```

- [ ] **Step 5: Run unit test**

Run: `npm run lab:test:unit`

Expected: baseline tests pass. Total now 11.

- [ ] **Step 6: Manual end-to-end check — seed into real lab DB**

Pre-req: lab PG is up + migrated.

Create a one-off script `lab/scripts/seed-cli.js` (also used in Task 7):

```javascript
// lab/scripts/seed-cli.js — `npm run lab:seed -- --scenario=baseline`
import { labPool } from '../helpers/db.js';
import { seedFixture } from '../helpers/seed.js';
import { scenarios } from '../scenarios/index.js';

const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const name = scenarioArg ? scenarioArg.split('=')[1] : 'baseline';

const builder = scenarios[name];
if (!builder) {
  console.error(`Unknown scenario: ${name}. Known: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

const pool = labPool();
try {
  console.log(`[LAB] Seeding scenario "${name}"...`);
  const fx = builder();
  await seedFixture(pool, fx);
  console.log(`[LAB] Done. customers=${fx.customers.length} orders=${fx.orders.length} stock=${fx.stockItems.length}`);
} finally {
  await pool.end();
}
```

Create `lab/scenarios/index.js`:

```javascript
import { buildBaseline } from './baseline.js';

export const scenarios = {
  baseline: buildBaseline,
  // stock-overhaul added in Task 6.
};
```

Add to root `package.json`:

```json
"lab:seed": "node lab/scripts/seed-cli.js"
```

Run:
```
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "TRUNCATE order_lines, deliveries, orders, stock, customers RESTART IDENTITY CASCADE;"
npm run lab:seed -- --scenario=baseline
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "SELECT count(*) FROM customers; SELECT count(*) FROM orders; SELECT count(*) FROM stock;"
```

Expected: 5 customers, 12 orders, 30 stock items.

- [ ] **Step 7: Commit**

```bash
git add lab/helpers/ lab/scenarios/ lab/scripts/seed-cli.js package.json
git commit -m "feat(lab): add seed pipeline + baseline scenario"
```

---

## Task 6: stock-overhaul scenario

**Files:**
- Create: `lab/scenarios/stockOverhaul.js`
- Modify: `lab/scenarios/index.js`

- [ ] **Step 1: Write `lab/scenarios/stockOverhaul.js`**

```javascript
// lab/scenarios/stockOverhaul.js
//
// Fixture for Stock-tab redesign rehearsal. Extends baseline with:
//   - 200 stock items spanning realistic varieties + age (0-14 days old)
//   - Mix of batches (positive qty), demand entries (negative qty),
//     and zeroed-out batches (sold through)
//   - Orders that consumed some of the stock so the demand-entry math
//     (per ADR 0002) is exercisable
//
// Use cases this fixture is designed to support:
//   - Owner inspects new stock-tab UI with realistic volume
//   - Tests assert demand entry collapse / batch absorption
//   - Tests assert sort/filter/search behavior with non-trivial dataset

import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

export function buildStockOverhaul() {
  faker.seed(2);
  const base = buildBaseline();

  const extraBatches = Array.from({ length: 140 }, () => {
    const days = faker.number.int({ min: 0, max: 14 });
    const arrival = new Date(Date.now() - days * 86400_000);
    return makeStockItem({ arrivalDate: arrival });
  });

  const extraDemands = Array.from({ length: 30 }, () => makeStockItem({ type: 'demand' }));

  const zeroBatches = Array.from({ length: 30 }, () =>
    makeStockItem({ qty: 0 })
  );

  const newStock = [...extraBatches, ...extraDemands, ...zeroBatches];

  // Add 30 new orders that consume from the new stock so committed demand
  // is non-trivial. Reuse baseline customers to keep FK integrity.
  const extraOrders = [];
  const extraLines = [];
  for (let i = 0; i < 30; i++) {
    const customer = faker.helpers.arrayElement(base.customers);
    const o = makeOrder({ customerId: customer.id, status: 'New', delivery_type: 'pickup' });
    extraOrders.push(o);
    const lineCount = faker.number.int({ min: 2, max: 5 });
    for (let j = 0; j < lineCount; j++) {
      const stock = faker.helpers.arrayElement([...extraBatches, ...extraDemands]);
      extraLines.push(makeOrderLine({
        orderId: o.id,
        stockItemId: stock.id,
        qty: faker.number.int({ min: 1, max: 4 }),
        costSnapshot: stock.cost_price,
        sellSnapshot: stock.sell_price,
      }));
    }
  }

  return {
    customers: base.customers,
    stockItems: [...base.stockItems, ...newStock],
    orders: [...base.orders, ...extraOrders],
    orderLines: [...base.orderLines, ...extraLines],
    deliveries: base.deliveries,
  };
}
```

- [ ] **Step 2: Update `lab/scenarios/index.js`**

```javascript
import { buildBaseline } from './baseline.js';
import { buildStockOverhaul } from './stockOverhaul.js';

export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
};
```

- [ ] **Step 3: Verify scenario seeds without FK errors**

```
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "TRUNCATE order_lines, deliveries, orders, stock, customers RESTART IDENTITY CASCADE;"
npm run lab:seed -- --scenario=stock-overhaul
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "SELECT count(*) FROM stock; SELECT count(*) FROM orders; SELECT count(*) FROM order_lines;"
```

Expected: ~230 stock items, ~42 orders, ~100 order lines. No FK errors.

- [ ] **Step 4: Commit**

```bash
git add lab/scenarios/
git commit -m "feat(lab): add stock-overhaul scenario for Stock redesign rehearsal"
```

---

## Task 7: Template-DB clone reset mechanism

**Files:**
- Create: `lab/helpers/reset.js`
- Create: `lab/scripts/rebuild-template.js`
- Modify: `package.json` (add `lab:template:rebuild`, `lab:reset`)

- [ ] **Step 1: Write `lab/scripts/rebuild-template.js`**

```javascript
// lab/scripts/rebuild-template.js
//
// Rebuilds the `lab_template` Postgres database from a named scenario.
// Invoked when the schema changes or a scenario is updated.
// Idempotent — drops existing template first.
//
// Usage:
//   npm run lab:template:rebuild
//   npm run lab:template:rebuild -- --scenario=stock-overhaul

import { execSync } from 'child_process';
import { adminPool, labPool } from '../helpers/db.js';
import { seedFixture } from '../helpers/seed.js';
import { scenarios } from '../scenarios/index.js';

const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const name = scenarioArg ? scenarioArg.split('=')[1] : 'baseline';

const builder = scenarios[name];
if (!builder) {
  console.error(`Unknown scenario: ${name}`);
  process.exit(1);
}

const TEMPLATE_DB = 'lab_template';

const admin = adminPool();
try {
  // Disconnect anything using the template, then drop+create it.
  await admin.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname IN ('${TEMPLATE_DB}', 'lab') AND pid <> pg_backend_pid()
  `);
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB} OWNER lab`);
} finally {
  await admin.end();
}

console.log(`[LAB] Created empty ${TEMPLATE_DB}. Applying migrations...`);
execSync(`DATABASE_URL=postgres://lab:lab@localhost:5433/${TEMPLATE_DB} node backend/src/db/migrate.js`, {
  stdio: 'inherit',
});

console.log(`[LAB] Seeding "${name}" into template...`);
const pool = labPool(TEMPLATE_DB);
try {
  await seedFixture(pool, builder());
} finally {
  await pool.end();
}

// Mark template as a template (forbids ordinary connections; allows TEMPLATE clone).
const admin2 = adminPool();
try {
  await admin2.query(`UPDATE pg_database SET datistemplate = true WHERE datname = '${TEMPLATE_DB}'`);
} finally {
  await admin2.end();
}

console.log(`[LAB] Template "${TEMPLATE_DB}" rebuilt with scenario "${name}".`);
```

- [ ] **Step 2: Write `lab/helpers/reset.js`**

```javascript
// lab/helpers/reset.js
//
// Sub-second reset: drops the lab DB and clones it from lab_template.
// Pre-condition: lab_template exists (run rebuild-template.js once).
// Pre-condition: no open connections to `lab` (caller should pool.end()
// any active pool before calling resetLabDb).

import { adminPool } from './db.js';

const TEMPLATE_DB = 'lab_template';
const TARGET_DB = 'lab';

export async function resetLabDb() {
  const admin = adminPool();
  try {
    // Kick off any stale connections to the target DB.
    await admin.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid()
    `);
    await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`);
    await admin.query(`CREATE DATABASE ${TARGET_DB} TEMPLATE ${TEMPLATE_DB} OWNER lab`);
  } finally {
    await admin.end();
  }
}
```

- [ ] **Step 3: Add scripts to root `package.json`**

```json
"lab:template:rebuild": "node lab/scripts/rebuild-template.js",
"lab:reset": "node -e \"import('./lab/helpers/reset.js').then(m => m.resetLabDb()).then(() => console.log('[LAB] Reset complete.'))\""
```

- [ ] **Step 4: Verify rebuild + reset cycle works**

Pre-req: lab PG up, lab DB migrated.

```
npm run lab:template:rebuild -- --scenario=baseline
npm run lab:reset
docker compose -f docker-compose.lab.yml exec -T postgres psql -U lab -d lab -c "SELECT count(*) FROM customers;"
```

Expected: 5 customers (cloned from template).

Time the reset:
```
time npm run lab:reset
```

Expected: under 2 seconds (Docker exec overhead included).

- [ ] **Step 5: Commit**

```bash
git add lab/helpers/reset.js lab/scripts/rebuild-template.js package.json
git commit -m "feat(lab): add template-DB clone reset (sub-second per-test isolation)"
```

---

## Task 8: API test helpers + cancel-with-return test

**Files:**
- Create: `lab/helpers/api.js`
- Create: `lab/tests/api/cancel-with-return.test.js`
- Modify: `package.json` (add `lab:test:api`)

- [ ] **Step 1: Write `lab/helpers/api.js`**

```javascript
// lab/helpers/api.js
//
// Fetch wrapper for lab API tests. Sends the X-Auth-PIN header and base URL.
// Tests treat the lab backend like a black box — same wire format as prod.

const BASE = process.env.LAB_API_URL ?? 'http://localhost:3003';

export function api(role = 'owner') {
  const PINS = { owner: '1111', florist: '2222', driver_timur: '3333', driver_nikita: '4444' };
  const pin = PINS[role];

  async function request(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-PIN': pin,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }

  return {
    get:    (p)    => request('GET',    p),
    post:   (p, b) => request('POST',   p, b),
    patch:  (p, b) => request('PATCH',  p, b),
    delete: (p)    => request('DELETE', p),
  };
}
```

- [ ] **Step 2: Add helper for booting lab backend in tests**

Append to `lab/helpers/api.js`:

```javascript
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

let serverHandle = null;

export async function startLabBackend() {
  if (serverHandle) return;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const script = resolve(__dirname, '../scripts/start-lab-backend.js');
  serverHandle = spawn('node', [script], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Wait for /api/health to respond.
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Lab backend did not start within 30s');
}

export async function stopLabBackend() {
  if (!serverHandle) return;
  serverHandle.kill('SIGTERM');
  await new Promise(r => serverHandle.once('exit', r));
  serverHandle = null;
}
```

- [ ] **Step 3: Write `lab/tests/api/cancel-with-return.test.js`**

```javascript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, startLabBackend, stopLabBackend } from '../../helpers/api.js';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

describe('cancel-with-return returns stems to inventory', () => {
  beforeAll(async () => {
    await resetLabDb();             // template-cloned baseline
    await startLabBackend();
  });
  afterAll(stopLabBackend);

  beforeEach(async () => {
    await stopLabBackend();
    await resetLabDb();
    await startLabBackend();
  });

  it('increments stock.qty by exactly the line quantities', async () => {
    const owner = api('owner');
    const pool = labPool();

    // 1. Pick any New / non-cancelled order with at least one line.
    const ordersRes = await owner.get('/api/orders?status=New');
    expect(ordersRes.status).toBe(200);
    const order = ordersRes.body.find(o => o.lines && o.lines.length > 0);
    expect(order).toBeTruthy();

    // 2. Snapshot stock for every line.
    const before = new Map();
    for (const line of order.lines) {
      const s = await pool.query('SELECT qty FROM stock WHERE id=$1', [line.stockItemId]);
      before.set(line.stockItemId, { qty: Number(s.rows[0].qty), addBack: line.qty });
    }

    // 3. Cancel-with-return.
    const res = await owner.post(`/api/orders/${order.id}/cancel-with-return`);
    expect(res.status).toBe(200);

    // 4. Assert order is Cancelled.
    const after = await owner.get(`/api/orders/${order.id}`);
    expect(after.body.status).toBe('Cancelled');

    // 5. Assert each stock row's qty went up by the line qty.
    for (const [stockId, { qty: prev, addBack }] of before) {
      const s = await pool.query('SELECT qty FROM stock WHERE id=$1', [stockId]);
      expect(Number(s.rows[0].qty)).toBe(prev + addBack);
    }

    await pool.end();
  });
});
```

- [ ] **Step 4: Add `lab:test:api` to root `package.json`**

```json
"lab:test:api": "cd lab && npx vitest run --config vitest.config.js tests/api"
```

- [ ] **Step 5: Run the API test**

Pre-req: lab PG up, template built.
```
npm run lab:db:up
npm run lab:template:rebuild -- --scenario=baseline
npm run lab:test:api
```

Expected: 1 test passes. The test resets DB → boots backend → exercises real cancel-with-return path → asserts both order status + stock qty.

If the test fails because the baseline scenario doesn't produce a New order with lines, adjust `lab/scenarios/baseline.js` to guarantee at least 3 New orders with multiple lines, then `npm run lab:template:rebuild` and re-run.

- [ ] **Step 6: Commit**

```bash
git add lab/helpers/api.js lab/tests/api/ package.json
git commit -m "feat(lab): add API test scaffolding + cancel-with-return integration test"
```

---

## Task 9: Playwright config + first UI smoke test

**Files:**
- Create: `playwright.lab.config.js`
- Create: `lab/tests/ui/stock-tab-smoke.spec.js`
- Modify: `package.json` (add `lab:test:ui`)

NOTE: per CLAUDE.md cost discipline, UI/Playwright work doesn't need formal TDD red phase — it's UI wiring. We write the spec + verify it runs green against the baseline scenario.

- [ ] **Step 1: Write `playwright.lab.config.js`**

```javascript
// playwright.lab.config.js
//
// Lab-only Playwright config. Boots lab backend (3003) + dashboard (5177).
// Lab Vite dev servers run on different ports than the existing harness
// (5173–5175) to avoid collisions when both are running.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './lab/tests/ui',
  testMatch: '**/*.spec.js',

  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: [['list'], process.env.CI ? ['github'] : ['html', { open: 'never' }]].filter(Boolean),

  use: {
    baseURL: 'http://localhost:5177',  // dashboard
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      command: 'node lab/scripts/start-lab-backend.js',
      url: 'http://localhost:3003/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dashboard -- --port 5177',
      url: 'http://localhost:5177/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:3003' },
    },
  ],
});
```

- [ ] **Step 2: Write `lab/tests/ui/stock-tab-smoke.spec.js`**

```javascript
import { test, expect } from '@playwright/test';

// Smoke test: dashboard loads, owner authenticates, stock tab renders
// rows from the seeded baseline scenario. Catches Vite build errors,
// import collapses, white-screen-on-load. Doesn't assert specific rows
// (those are scenario-dependent and will drift).

test('dashboard stock tab renders seeded stock items', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/PIN|Пин/i).fill('1111');
  await page.getByRole('button', { name: /войти|enter|sign in/i }).click();

  // Click the Stock tab. Match on the Russian label per CLAUDE.md UI rules.
  await page.getByRole('tab', { name: /склад|stock/i }).click();

  // Expect at least 5 stock rows visible (baseline has 30).
  const rows = page.locator('[data-testid="stock-row"], .stock-row, tr.stock-row');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(5);
});
```

NOTE: the row selector list is a fallback set — if the dashboard's stock-row markup doesn't match any of these, the test fails fast. The dashboard maintainer should add `data-testid="stock-row"` if not present (small change in `apps/dashboard/src/components/StockTab.jsx`).

- [ ] **Step 3: Add `lab:test:ui` to root `package.json`**

```json
"lab:test:ui": "playwright test --config=playwright.lab.config.js"
```

- [ ] **Step 4: Run UI test**

Pre-req: lab PG up, template built, lab DB reset to baseline.
```
npm run lab:reset
npm run lab:test:ui
```

Expected: 1 test passes. Playwright boots backend + dashboard, drives Chromium, renders stock tab.

If the row selector doesn't match anything: open `apps/dashboard/src/components/StockTab.jsx`, add `data-testid="stock-row"` to the row element, retry.

- [ ] **Step 5: Commit**

```bash
git add playwright.lab.config.js lab/tests/ui/ package.json
git commit -m "feat(lab): add Playwright UI test scaffolding + stock-tab smoke test"
```

---

## Task 10: lab:dev orchestrator + agent README

**Files:**
- Create: `lab/scripts/start-lab-dev.js`
- Create: `lab/README.md`
- Create: `lab/tests/exploratory/README.md`
- Modify: `package.json` (add `lab:dev`)

- [ ] **Step 1: Add `concurrently` for orchestrating multi-process dev**

```
cd lab && npm install --save-dev concurrently@^9.0.0
```

- [ ] **Step 2: Write `lab/scripts/start-lab-dev.js`**

```javascript
// lab/scripts/start-lab-dev.js
//
// One-command boot of the lab dev environment:
//   - lab backend on :3003
//   - florist app  on :5176 (proxied to lab backend)
//   - dashboard    on :5177
//   - delivery app on :5178
//
// Pre-req: `npm run lab:db:up && npm run lab:reset` (template must already exist).

import concurrently from 'concurrently';

const proxy = 'http://localhost:3003';

const { result } = concurrently([
  {
    name: 'backend',
    command: 'node lab/scripts/start-lab-backend.js',
    prefixColor: 'magenta',
  },
  {
    name: 'florist',
    command: `cd apps/florist && VITE_API_PROXY_TARGET=${proxy} npx vite --port 5176 --strictPort`,
    prefixColor: 'cyan',
  },
  {
    name: 'dashboard',
    command: `cd apps/dashboard && VITE_API_PROXY_TARGET=${proxy} npx vite --port 5177 --strictPort`,
    prefixColor: 'green',
  },
  {
    name: 'delivery',
    command: `cd apps/delivery && VITE_API_PROXY_TARGET=${proxy} npx vite --port 5178 --strictPort`,
    prefixColor: 'yellow',
  },
], {
  killOthers: ['failure', 'success'],
  prefix: 'name',
});

result.catch(() => process.exit(1));
```

- [ ] **Step 3: Add `lab:dev` to root `package.json`**

```json
"lab:dev": "node lab/scripts/start-lab-dev.js"
```

- [ ] **Step 4: Write `lab/README.md`**

````markdown
# Lab Harness

Local Docker-Postgres rehearsal environment for major overhauls. See `docs/adr/0004-lab-harness-rehearsal-env.md` for the architecture decision.

## Quick start

```bash
# 1. Boot Postgres + apply migrations + build a seeded template
npm run lab:db:up
npm run lab:migrate
npm run lab:template:rebuild -- --scenario=baseline

# 2. Reset lab to seeded state and boot the dev stack
npm run lab:reset
npm run lab:dev
```

Open:
- Dashboard: http://localhost:5177
- Florist:   http://localhost:5176
- Delivery:  http://localhost:5178
- API:       http://localhost:3003

PINs: owner `1111`, florist `2222`, drivers `3333` / `4444`.

Connect with psql / TablePlus: `postgres://lab:lab@localhost:5433/lab`.

## Switching scenarios

```bash
npm run lab:template:rebuild -- --scenario=stock-overhaul
npm run lab:reset
```

Available scenarios: `baseline`, `stock-overhaul`. Add new ones in `lab/scenarios/` and register in `lab/scenarios/index.js`.

## Running tests

```bash
npm run lab:test:unit   # vitest: factories + scenarios + helpers
npm run lab:test:api    # vitest: API integration tests against lab backend
npm run lab:test:ui     # Playwright: UI smoke + flow tests
```

## Tearing down

```bash
npm run lab:db:down       # stop container, keep volume
docker volume rm flower-studio_lab-pg-data  # nuke data
```

## What this is NOT

- Not a replacement for the existing pglite harness (`npm run harness` / `npm run test:e2e`). That harness still gates CI and runs the 153-assertion suite.
- Not a deployed staging environment — runs only on the local Mac.
- Not a place for real prod data. Synthetic-only by design.

## When to use

Major overhauls where you want to walk every path against realistic data before merge: Stock redesign, new CRM flows, payment overhaul, etc. Routine PRs use CI as the safety net; lab is for rehearsal-grade validation.
````

- [ ] **Step 5: Write `lab/tests/exploratory/README.md`**

````markdown
# Exploratory mode

Owner / agent invokes the lab interactively. Workflow:

1. Reset to a chosen scenario:
   ```
   npm run lab:template:rebuild -- --scenario=stock-overhaul
   npm run lab:reset
   ```
2. Boot dev stack: `npm run lab:dev`
3. Drive the UI manually OR have an agent drive it via Playwright + direct DB queries.

For an agent: read `lab/README.md`, then use the `api()` helper from `lab/helpers/api.js` to hit endpoints, and `labPool()` to inspect rows. Reset between probes with `import { resetLabDb } from '../../helpers/reset.js'`.

Exploratory tests live here as named one-offs. They are NOT run in CI — exploratory mode is human-triggered. Stable findings should be promoted to `lab/tests/api/` or `lab/tests/ui/`.
````

- [ ] **Step 6: Manual smoke**

```
npm run lab:reset
npm run lab:dev
```

Open dashboard at localhost:5177. Sign in with PIN 1111. Verify orders + stock + customers visible. Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add lab/scripts/start-lab-dev.js lab/README.md lab/tests/exploratory/ \
        lab/package.json package.json
git commit -m "feat(lab): add lab:dev orchestrator + README + exploratory mode docs"
```

---

## Task 11: External integration stubs

**Files:**
- Modify: `lab/scripts/start-lab-backend.js` (add `HARNESS_MOCK_WIX=1`)
- Create: `lab/helpers/mocks.js`

NOTE: the existing harness already implements Wix `fetch` interception via `HARNESS_MOCK_WIX=1`. We inherit it by setting the same env var. Telegram + Claude AI are already stubbed by virtue of the dummy API keys in `start-lab-backend.js` — calls fail fast, which is fine for lab. The helpers below give tests a way to assert "would have notified" without mocking the network.

- [ ] **Step 1: Add `HARNESS_MOCK_WIX=1` to lab env**

In `lab/scripts/start-lab-backend.js`, append to the `LAB_ENV` block:

```javascript
  // Inherit the Wix fetch interceptor from the existing harness — same code
  // path, same fake responses. Lets tests exercise the Wix-bound flows
  // without real credentials. See backend/scripts/start-test-backend.js
  // for the implementation; the env-var flips it on for any process that
  // sources backend/src/index.js.
  HARNESS_MOCK_WIX:                  '1',
```

ALSO: the Wix interceptor in `start-test-backend.js` is set up BEFORE the backend's index.js is imported. Lab needs the same ordering. Look at the existing start-test-backend.js (the section after `for (const [k, v] of Object.entries(TEST_ENV))`) and copy the Wix `globalThis.fetch` interceptor block into start-lab-backend.js (before the `await import('../../backend/src/index.js')` line). It's roughly 80 lines of fetch-wrapping logic.

- [ ] **Step 2: Write `lab/helpers/mocks.js`**

```javascript
// lab/helpers/mocks.js
//
// Deterministic stubs for Telegram + Claude AI. Lab tests use these
// helpers to assert behaviour without firing real third-party calls.
//
// Why not stub them globally like Wix? Telegram + Claude integrations
// fail-fast when the dummy API keys are used, which is the right
// default for lab boots (no accidental noise). Tests that need to
// assert "the system tried to send a Telegram alert" override the
// relevant service module's exports per-test using vitest's `vi.mock`.

import { vi } from 'vitest';

export function stubTelegram() {
  const sent = [];
  vi.doMock('../../backend/src/services/telegram.js', () => ({
    sendTelegramMessage: async (chat, text) => { sent.push({ chat, text }); return { ok: true }; },
    notifyOwner: async (text) => { sent.push({ chat: 'owner', text }); return { ok: true }; },
  }));
  return { sent };
}

export function stubClaudeParser(canned = {}) {
  vi.doMock('../../backend/src/services/textImport.js', () => ({
    parseOrderText: async (text) => canned[text] ?? { customer: 'Stub', lines: [] },
  }));
}
```

NOTE: the exact exports of `telegram.js` and `textImport.js` may differ. Read the actual modules first and mirror their public API in the stub. If a module doesn't exist under that path, find the right one (`grep -r "sendTelegramMessage\|notifyOwner" backend/src/`).

- [ ] **Step 3: Verify lab boot still works**

```
npm run lab:reset
npm run lab:backend
```

Visit `http://localhost:3003/api/health`. Expected: 200.

Stop the backend.

- [ ] **Step 4: Commit**

```bash
git add lab/scripts/start-lab-backend.js lab/helpers/mocks.js
git commit -m "feat(lab): inherit Wix mock + add Telegram/Claude stub helpers"
```

---

## Task 12: CI integration for lab API tests

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add a `lab-api` job**

In `.github/workflows/test.yml`, after the existing `e2e` job, add:

```yaml
  lab-api:
    name: Lab harness — API integration tests
    runs-on: ubuntu-latest
    timeout-minutes: 12
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: lab
          POSTGRES_PASSWORD: lab
          POSTGRES_DB: lab
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U lab -d lab"
          --health-interval 2s
          --health-timeout 2s
          --health-retries 20
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install root deps
        run: npm ci

      - name: Install lab deps
        run: cd lab && npm install --no-audit --no-fund

      - name: Apply migrations to lab DB
        run: npm run lab:migrate

      - name: Run lab unit tests (factories + scenarios)
        run: npm run lab:test:unit

      - name: Build template DB with baseline
        run: npm run lab:template:rebuild -- --scenario=baseline

      - name: Run lab API integration tests
        run: npm run lab:test:api
        env:
          LAB_API_URL: http://localhost:3003
```

NOTE: GitHub Actions service containers expose ports on the runner host, so `localhost:5433` works the same way as on the Mac. No Docker Compose needed inside CI.

- [ ] **Step 2: Confirm CI runs locally with `act` (optional)**

If `act` is installed, run:
```
act -j lab-api
```

Otherwise commit + push and verify on GitHub.

- [ ] **Step 3: Commit + push**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add lab-api job (Postgres service + factory/API tests)"
git push -u origin <branch>
```

- [ ] **Step 4: Verify the lab-api job goes green on the PR**

Open the PR, watch the new `lab-api` check land. If red, debug from the workflow logs. Common failures:
- "Module not found `@faker-js/faker`": confirm `cd lab && npm install` step ran.
- "ECONNREFUSED 5433": Postgres service didn't come up; check the health-check timing.
- "permission denied to create database": GitHub's Postgres service container creates `lab` user as a non-superuser by default — `lab_template` rebuild may fail. If so, swap the service container env to `POSTGRES_HOST_AUTH_METHOD: trust` and grant `CREATEDB`:
  ```yaml
  options: >-
    --health-cmd "pg_isready -U lab -d lab"
    --health-interval 2s
  env:
    POSTGRES_USER: lab
    POSTGRES_PASSWORD: lab
    POSTGRES_DB: lab
    POSTGRES_HOST_AUTH_METHOD: trust
  ```
  Plus an early step:
  ```yaml
  - name: Grant CREATEDB to lab
    run: docker exec ${{ job.services.postgres.id }} psql -U postgres -c "ALTER USER lab CREATEDB;" || true
  ```

---

## Verification Checklist (run before opening PR)

Per CLAUDE.md "Pre-PR Verification (MANDATORY)":

- [ ] `npm run lab:db:up && npm run lab:migrate` — green
- [ ] `npm run lab:test:unit` — all factory + scenario tests pass
- [ ] `npm run lab:template:rebuild -- --scenario=baseline` — green
- [ ] `npm run lab:test:api` — cancel-with-return passes
- [ ] `npm run lab:test:ui` — stock-tab smoke passes
- [ ] `cd backend && npx vitest run` — existing backend tests still green (lab is additive)
- [ ] `npm run harness &` then `npm run test:e2e` — existing pglite E2E still green
- [ ] Build all three apps: `cd apps/florist && ./node_modules/.bin/vite build`, repeat for dashboard + delivery — none broken by lab additions
- [ ] CI on the PR: all four jobs green (`lint`, `unit`, `e2e`, `lab-api`)

## Out of scope for v1 (per ADR 0004)

- Anonymised prod-snapshot fixtures (Phase 2)
- Migration timing instrumentation (Phase 2)
- Deployed Railway staging env (revisit if a future overhaul needs deploy-time fidelity)
- PO + Premade Bouquet factories (add when first scenario needs them)
- Lab tests for Florist Hours, Marketing Spend, Feedback (add when first scenario needs them)
- Replacing pglite harness in CI (do once lab has 2 weeks of clean runs)
