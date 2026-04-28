# Phase 4 — Orders + Order Lines + Deliveries: design

_Drafted: 2026-04-28 · Branch: `feat/sql-migration-phase-4-prep`_

## What Phase 4 is, in one paragraph

Three Airtable tables — Orders, Order Lines, Deliveries — move to Postgres
together. The state machine, cascade rules, and `orderService.js` business
logic stay where they are; only the persistence backing changes. The
biggest visible win is collapsing the 538-line manual rollback in
`createOrder` into a single PG transaction. The biggest invisible win is
making the order ↔ delivery cascade single-transaction-atomic, removing
the entire class of "delivery status changed but order didn't" drift bugs.

## Why these three entities migrate together

Looking at the operations actually performed on Order data:

| Entry point | Touches Order | Touches Lines | Touches Delivery | Touches Stock |
|---|---|---|---|---|
| `createOrder()` | create | create N | create | adjust N |
| `cancelWithStockReturn()` | update Status | read | (cascade Status) | adjust N |
| `deleteOrder()` | delete | delete N | delete | adjust N |
| `editBouquetLines()` | (auto-revert Status) | create / update / delete | — | adjust N |
| `transitionStatus()` | update Status | — | (cascade Status) | — |

Every business operation touches at least two of {Order, Lines, Delivery}.
Three separate repos would force every operation to be a coordinator
above them, and the only thing they'd coordinate is the transaction
boundary. So **`orderRepo` owns all three tables**, with no separate
`orderLineRepo` or `deliveryRepo`.

Comparison to Phase 3 (Stock): Stock has no internal cousins it must
update atomically with — adjustments are independent. So `stockRepo`
matched `customerRepo`'s shape. Phase 4 doesn't.

## Schema additions

Three new Drizzle tables. All carry `airtable_id` (text, unique-indexed)
during the cutover window for traceability — same pattern as `stock`.
After Phase 7 retires Airtable, `airtable_id` stays nullable but
unreferenced.

### `orders`
```
id                    uuid pk default gen_random_uuid()
airtable_id           text unique nullable           -- recXXX during cutover
app_order_id          text unique not null           -- "BLO-20260428-1" — the human-facing id
customer_id           text not null                  -- AIRTABLE rec id; FK after Phase 5
status                text not null default 'New'    -- ORDER_STATUS enum (text not enum — easier evolution)
delivery_type         text not null                  -- 'Delivery' | 'Pickup'
order_date            date not null default now()
required_by           date nullable
delivery_time         text nullable                  -- free text, owner-entered "afternoon" etc.
customer_request      text nullable
notes_original        text nullable                  -- field name kept for AT parity
florist_note          text nullable
greeting_card_text    text nullable
source                text nullable                  -- Wix / In-store / Phone / etc.
communication_method  text nullable
payment_status        text not null default 'Unpaid'
payment_method        text nullable
price_override        numeric(10,2) nullable
delivery_fee          numeric(10,2) nullable
created_by            text nullable
payment_1_amount      numeric(10,2) nullable
payment_1_method      text nullable
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
deleted_at            timestamptz nullable

indexes:
  unique (airtable_id) where not null
  unique (app_order_id)
  (customer_id, order_date desc)        -- customer history queries
  (status, required_by) where status != 'Cancelled' and status != 'Delivered'  -- "today's work"
  (deleted_at)
```

### `order_lines`
```
id                    uuid pk
airtable_id           text unique nullable
order_id              uuid not null references orders(id) on delete cascade
stock_item_id         text nullable                  -- FK to stock.airtable_id during cutover; uuid after Phase 4 cutover; null = orphan
flower_name           text not null
quantity              integer not null default 0
cost_price_per_unit   numeric(10,2) nullable
sell_price_per_unit   numeric(10,2) nullable
stock_deferred        boolean not null default false
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
deleted_at            timestamptz nullable

indexes:
  unique (airtable_id) where not null
  (order_id)                  -- "load all lines for this order"
  (stock_item_id)             -- "which orders consume this stock?"
```

### `deliveries`
```
id                    uuid pk
airtable_id           text unique nullable
order_id              uuid not null references orders(id) on delete cascade
delivery_address      text nullable
recipient_name        text nullable
recipient_phone       text nullable
delivery_date         date nullable
delivery_time         text nullable
assigned_driver       text nullable
delivery_fee          numeric(10,2) nullable
driver_instructions   text nullable
delivery_method       text nullable                  -- 'Driver' | 'Self'
driver_payout         numeric(10,2) nullable
status                text not null default 'Pending'
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
deleted_at            timestamptz nullable

indexes:
  unique (airtable_id) where not null
  unique (order_id)            -- one-to-one constraint enforced at DB level
  (assigned_driver, delivery_date)   -- driver's daily route
  (status, delivery_date)            -- "today's pending deliveries"
```

### Foreign-key choice: `on delete cascade`

When the owner hard-deletes an order via `deleteOrder()`, the matching
lines and delivery should disappear with it. Today this is enforced by
JS code (`orderService.deleteOrder` walks the children). PG `ON DELETE
CASCADE` makes it a schema-level guarantee — the JS code stops being
the lone enforcer.

Soft-delete (`deleted_at`) is a separate concern; it doesn't trigger
cascade because the row is logically still there.

### Why `customer_id` is text, not a FK to a not-yet-existing customers table

Phase 5 migrates Customers. Until then, orders reference
`Customer.airtable_id` (recXXX text). Adding the FK constraint in
Phase 5 is one ALTER TABLE statement once the customers table exists.

## The transactional rewrite of `createOrder`

This is the headline win. Today's flow (paraphrased):

```js
let order, createdLines = [], createdDelivery, stockAdjustments = [];
try {
  order = await db.create(TABLES.ORDERS, {...});             // Airtable call 1
  for (const line of orderLines) {
    const created = await db.create(TABLES.ORDER_LINES, {...}); // Airtable calls 2..N+1
    createdLines.push(created);
  }
  for (const line of orderLines) {
    await stockRepo.adjustQuantity(line.stockItemId, -line.quantity);  // Airtable calls N+2..2N+1
    stockAdjustments.push({...});
  }
  if (deliveryType === 'Delivery') {
    createdDelivery = await db.create(TABLES.DELIVERIES, {...});       // Airtable call 2N+2
    await db.update(TABLES.ORDERS, order.id, { Deliveries: [createdDelivery.id] });  // 2N+3
  }
} catch (err) {
  // 80 lines of unwinding: reverse stock, delete lines, delete order, delete delivery
  // — each step itself fallible, with its own try/catch and console.error
}
```

After Phase 4:

```js
return await db.transaction(async (tx) => {
  const order = await orderRepo._insertOrder(tx, {...});
  const createdLines = await orderRepo._insertLines(tx, order.id, orderLines);
  for (const line of orderLines) {
    if (line.stockItemId && !line.stockDeferred) {
      await stockRepo.adjustQuantity(line.stockItemId, -line.quantity, { tx, actor });
    }
  }
  let delivery = null;
  if (deliveryType === 'Delivery') {
    delivery = await orderRepo._insertDelivery(tx, order.id, {...});
  }
  return { order, orderLines: createdLines, delivery };
});
// Any throw from any line above → PG rolls back ALL writes. No manual unwinding.
```

This is the architectural payoff of the entire migration in one example.

## The mandatory stockRepo refactor

Currently `stockRepo.adjustQuantity` (and `update`, `create`, etc.) start
their own transaction unconditionally:

```js
return await db.transaction(async (tx) => { /* ... */ });
```

If `createOrder` calls `adjustQuantity` from inside its own outer
transaction, we get a NESTED transaction. PG supports nested
transactions only via SAVEPOINTs, and Drizzle's `tx.transaction()`
does turn into a SAVEPOINT — so it works in principle. BUT: the
audit-log row would commit at the inner SAVEPOINT, not the outer
COMMIT, so a rollback of the OUTER transaction would still leave audit
rows behind. That's wrong: the audit log must reflect what actually
committed.

Fix: every stockRepo write method accepts an optional `opts.tx`. When
present, run on the parent transaction (no nesting). When absent,
start its own. Pattern:

```js
async function adjustQuantity(id, delta, opts = {}) {
  const runOnTx = async (tx) => { /* same logic */ };
  return opts.tx
    ? runOnTx(opts.tx)               // participate in outer tx
    : db.transaction(runOnTx);       // start our own
}
```

Same change for `create`, `update`, `softDelete`, `restore`, `purge`.
This is **a foundational refactor that ships in this PR** because Phase
4's `createOrder` rewrite depends on it.

## Wire format for `orderRepo`

Same principle as `stockRepo`: methods return Airtable-shaped records
so routes don't change. An order looks like:

```js
{
  id: 'recABC' | 'uuid-...',     // recXXX during cutover, then uuid
  _pgId: 'uuid-...',
  Customer: ['recCust123'],       // Airtable's array-link convention
  'Order Lines': ['recL1', 'recL2'],
  Deliveries: ['recDelivery1'],
  'App Order ID': 'BLO-20260428-1',
  Status: 'New',
  'Required By': '2026-05-01',
  // ... all the other Airtable field-name keys
}
```

The route layer (`routes/orders.js`) doesn't change at all on the
read side. The backend swap is invisible.

## Cascade rules that stay in JS

Both directions of the order ↔ delivery cascade live in routes today
(see CLAUDE.md "Cascade Rules"):

- Order status → Delivery status (`routes/orders.js`)
- Delivery status → Order status (`routes/deliveries.js`)
- Order date/time → Delivery date/time (`routes/orders.js`)

After Phase 4, those route handlers stay where they are but execute
inside a transaction, so the Order and Delivery updates commit
together. No more "Airtable said the delivery updated but the order
field didn't catch up" drift (CLAUDE.md known pitfall #1).

## Cutover sequencing — single mode flag for all three entities

Phase 3 used `STOCK_BACKEND={airtable|shadow|postgres}`. Phase 4 uses
`ORDER_BACKEND={airtable|shadow|postgres}` — one flag covers all three
tables because they ALWAYS migrate together.

Order of operations (mirrors Phase 3):

1. Apply migration: `npm run db:migrate` creates the three tables.
2. Run backfill: `node scripts/backfill-orders.js` (TODO — copies all
   active orders + their lines + their deliveries from Airtable to PG).
3. Set `ORDER_BACKEND=shadow`, redeploy.
4. Watch parity dashboard for ~1 week. Order writes are lower-frequency
   than stock writes; need to validate at least: a Wix-webhook order, an
   in-store order with delivery, a pickup order, a cancellation, a
   bouquet edit, and a status transition through to Delivered.
5. When parity is clean: set `ORDER_BACKEND=postgres`, redeploy.
6. Airtable Orders / Order Lines / Deliveries become a frozen legacy
   snapshot.

## Wix webhook is the riskiest consumer

`services/wix.js`'s order-creation flow is webhook-triggered with no
replay safety net (CLAUDE.md `WIX-BACKLINK` BACKLOG entry). If the new
transactional `createOrder` throws on a Wix webhook payload, we lose
the order — and Wix won't redeliver.

Mitigation:
- Before flipping `ORDER_BACKEND=shadow`: capture three or four real
  Wix webhook payloads from the prod Webhook Log table and replay them
  against a local backend in the E2E test harness (3b in a separate
  chat). Validate the order lands in PG correctly.
- Shadow mode itself is a safety net: writes go to BOTH stores, so if
  PG fails the Airtable write still succeeded. The webhook responds 200,
  the order exists in Airtable, the parity dashboard shows the divergence
  for us to investigate.

## Out of scope for the Phase 4 design (intentional)

- **Customer cleanup / dedup.** Stays in Phase 5. Phase 4's `customer_id`
  text column is a bridge.
- **Legacy Orders table** (`tblLegacyOrders`, ~2k records).
  Read-only reference data after Phase 5; remains in Airtable through
  Phase 4 because order history rendering (Customer Tab v2.0) joins
  legacy + app orders. After Phase 5 it migrates as a one-shot import.
- **Stock Loss Log writes from `editBouquetLines`'s write-off path.**
  Phase 6 entity.
- **PO records** (`stock_orders`, `stock_order_lines`). Touch stock but
  not orders. Migrate independently as part of Phase 4 if write volume
  warrants, otherwise Phase 6.

## What this design PR ships

This branch (`feat/sql-migration-phase-4-prep`) does NOT cutover. It
ships:

1. This design doc.
2. Schema additions (`orders`, `order_lines`, `deliveries`) + migration.
3. Schema smoke tests.
4. **stockRepo refactor for tx-passthrough** (the gating change).
5. `orderRepo.js` skeleton — method signatures + JSDoc, stubs that
   throw `Phase 4 — not yet implemented`. The skeleton's job is to
   lock in the public API so the orderService rewrite can begin once
   we're confident in the shape.
6. BACKLOG + memory updates.

A separate PR will replace the stubs with implementations and rewire
`orderService.js` to use `orderRepo`. That PR is bigger and benefits
from this one being already-merged so the diff stays focused.
