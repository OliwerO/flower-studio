# Phase 7 PR 2a — Airtable Bypass Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every remaining production-path Airtable bypass in the backend to Postgres-native repos, so PR 2b can delete `airtable.js` + the Airtable npm dep without breaking the Wix webhook, the public storefront, the intake parser, the test harness, or any owner/florist flow.

**Architecture:** Add one new transactional method (`orderRepo.createWixOrder`) so the Wix webhook can write a complete PG order in a single transaction. Migrate the four remaining stock-list reads (`public.js` ×2, `intake.js`, `wix.js`) to `stockRepo.list`. Migrate the test-harness `/test/reset` from the airtable-mock fixture to a PG-native seed extending the existing `phase7-seed.js` helper. Delete `utils/batchQuery.js` once its three callers are rewritten against `orderRepo` bulk helpers. After this PR lands and runs in prod for ≥48h, PR 2b will delete `airtable.js`, the mocks, the schema validator, the `STOCK_BACKEND` / `ORDER_BACKEND` flag plumbing, the dead fallback branches, and the `airtable` npm dep.

**Tech Stack:** Node 22, Express, Drizzle ORM (node-postgres on Railway, pglite in tests), Vitest, Playwright E2E harness.

**Key constraints:**
- **Production-only** — no staging. Every change ships to live operations. `wix.js` is the riskiest because it runs on every Wix purchase.
- **Wix orders are mirrored to PG today** via `orderRepo.mirrorAirtableOrder` — production reads work, but every Wix order writes 4 rows to a frozen Airtable base. The mirror call is removed in T2 once `createWixOrder` replaces it.
- **No code change must alter Wix order semantics** — same dedup, customer match, line shape, delivery defaults, broadcast, Telegram. Wire-level parity with the current behaviour is the test for "done".
- **`airtable.js` stays alive** through PR 2a. Its deletion is PR 2b's job. Until then, mock-airtable harness still boots so the E2E suite passes.
- **Boot-time `validateAirtableSchema` keeps running** — the validator only checks fields, doesn't read data. Removing it is PR 2b.

---

## File Structure

### New
- `backend/src/__tests__/orderRepoCreateWixOrder.integration.test.js` — TDD tests for the new repo method (T1).
- `backend/src/__tests__/helpers/phase7pr2a-seed.js` — extends `phase7-seed.js` with all Phase 3/4/5/6 tables seeded directly from JSON (T7).

### Modified
- `backend/src/repos/orderRepo.js` — add `createWixOrder(params)` (T1).
- `backend/src/services/wix.js` — replace `db.create(ORDERS/LINES/DELIVERIES)` + `db.list(STOCK)` + `mirrorAirtableOrder` (T2). Replace `listByIds(TABLES.ORDER_LINES, ...)` in `reprocessWixOrder` (T3).
- `backend/src/routes/public.js` — replace `db.list(TABLES.STOCK, ...)` ×2 with `stockRepo.list` (T4).
- `backend/src/routes/intake.js` — replace `db.list(TABLES.STOCK, ...)` with `stockRepo.list` (T5).
- `backend/src/utils/batchQuery.js` — **deleted** in T6 once callers migrate.
- `backend/src/routes/orders.js` — drop `listByIds` import + any Airtable-only usage (T6).
- `backend/src/services/orderService.js` — drop `listByIds` import + any Airtable-only usage (T6).
- `backend/src/routes/test.js` — replace `airtable-mock` import + the bridge seed loop with PG-native JSON-driven seed (T7).

### Untouched (deliberately — these are PR 2b's job)
- `backend/src/services/airtable.js`, `airtable-real.js`, `airtable-mock.js`, `airtable-mock-formula.js`
- `backend/src/services/airtableSchema.js`
- `backend/src/config/airtable.js`
- `backend/src/services/__fixtures__/airtable-test-base.json` — still feeds the harness through `airtable-mock` until PR 2b
- `backend/src/repos/{stockRepo,orderRepo}.js` — fallback branches + `getBackendMode()`
- `backend/src/services/orderService.js` — Airtable fallback branches at lines 121/372/491/549/611
- `backend/src/index.js` — boot guard + `validateAirtableSchema` call

---

## Tasks

### Task 1: Add `orderRepo.createWixOrder` (TDD)

**Files:**
- Create: `backend/src/__tests__/orderRepoCreateWixOrder.integration.test.js`
- Modify: `backend/src/repos/orderRepo.js`

**Why:** The Wix webhook needs to write a complete PG order (order + N lines + delivery) in a single transaction without going through `orderService.createOrder` (which carries owner/florist semantics — auto-match prompts, owner-price-override cascades, telegram, etc., that Wix does not need). Mirrors the shape of `mirrorAirtableOrder` but accepts Wix-domain input directly and skips the dead Airtable middleman.

**Signature:**
```js
/**
 * Create a Wix order + lines + delivery in a single PG transaction.
 *
 * Wix orders bypass orderService.createOrder because:
 *   - No stock deduction (Wix bouquets are placeholder products composed by
 *     the florist later — see the existing comment at wix.js:382).
 *   - No auto-match prompts, no owner-price cascades, no driver-of-day.
 *   - Source/createdBy/wixOrderId are hard-coded.
 *
 * @param {Object} params
 * @param {string} params.customerId          PG customer uuid (already created via customerRepo)
 * @param {string} params.appOrderId          generated by configService.generateOrderId
 * @param {string} params.wixOrderId          Wix's order id (uuid string)
 * @param {string} params.customerRequest     "Wix Order #<human number>"
 * @param {string} [params.requiredBy]        ISO date string
 * @param {string} params.paymentStatus       'Paid' | 'Unpaid'
 * @param {string|null} params.paymentMethod  parsed Wix payment label, may be null
 * @param {number|null} params.priceOverride  total Wix charged (null if 0)
 * @param {Array<{stockItemId?: string, flowerName: string, quantity: number, costPricePerUnit: number, sellPricePerUnit: number}>} params.lines
 * @param {Object} params.delivery
 * @param {string} params.delivery.address
 * @param {string} params.delivery.recipientName
 * @param {string} params.delivery.recipientPhone
 * @param {string|null} params.delivery.date  ISO date or null
 * @param {number} params.delivery.fee
 * @returns {{order, lines, delivery}}        Airtable-shaped wire records (matches orderRepo.findById output)
 */
export async function createWixOrder(params) { ... }
```

**Implementation rules:**
- **Postgres-only.** First line: `if (MODE !== 'postgres') throw new Error('orderRepo.createWixOrder: requires ORDER_BACKEND=postgres')`. We do not need an Airtable fallback because the only caller (`wix.js`) loses its Airtable path in T2.
- **Single transaction**: `db.transaction(async (tx) => { ... })`. Insert order, then lines, then delivery. Same shape as `mirrorAirtableOrder`'s body — just skip the `airtable_id` writes (set to `null` since there is no Airtable record).
- **Returns wire-format records** (the Airtable-shape `orderRepo.findById` returns), so `wix.js` can keep using `order.id`, `order['App Order ID']`, etc. without changes.
- **`Source: 'Wix'`, `Created By: 'Wix Webhook'`, Status: `ORDER_STATUS.NEW`, Delivery Type: 'Delivery'** are set inside the repo (these are Wix invariants, not caller choices).
- **`Order Date`** = today's UTC date (matches the existing inline computation at wix.js:323).
- **`Delivery Fee`** comes from `params.delivery.fee` (which is the parsed `shippingFee` Wix sent).
- **No stock movement rows.** Wix path has never deducted stock and never will — this matches the comment at wix.js:382-385.

- [ ] **Step 1.1: Write the failing integration test**

```js
// backend/src/__tests__/orderRepoCreateWixOrder.integration.test.js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupPgliteDb, db } from './helpers/pgHarness.js';
import { seedPhase7 } from './helpers/phase7-seed.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';

describe('orderRepo.createWixOrder', () => {
  beforeAll(async () => { await setupPgliteDb(); });
  beforeEach(async () => { await seedPhase7(db); });

  async function makeCustomer() {
    return await customerRepo.create({
      'Full Name': 'Wix Buyer',
      Phone: '+48500111222',
      Email: 'buyer@example.com',
    });
  }

  it('inserts order + lines + delivery in one transaction', async () => {
    const customer = await makeCustomer();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-099',
      wixOrderId: 'wix-uuid-1',
      customerRequest: 'Wix Order #12345',
      requiredBy: '2026-05-10',
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 250,
      lines: [
        { flowerName: 'Roses Red', quantity: 5, costPricePerUnit: 0, sellPricePerUnit: 50 },
      ],
      delivery: {
        address: 'ul. Krakowska 1, Krakow',
        recipientName: 'Maria',
        recipientPhone: '+48500999888',
        date: '2026-05-10',
        fee: 30,
      },
    });

    expect(result.order.id).toBeTruthy();
    expect(result.order.Source).toBe('Wix');
    expect(result.order['Created By']).toBe('Wix Webhook');
    expect(result.order.Status).toBe(ORDER_STATUS.NEW);
    expect(result.order['Delivery Type']).toBe('Delivery');
    expect(result.order['Wix Order ID']).toBe('wix-uuid-1');
    expect(result.order['App Order ID']).toBe('202605-099');
    expect(result.order['Price Override']).toBe(250);
    expect(result.order.Customer).toEqual([customer.id]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]['Flower Name']).toBe('Roses Red');
    expect(result.lines[0].Quantity).toBe(5);

    expect(result.delivery['Linked Order']).toEqual([result.order.id]);
    expect(result.delivery['Delivery Address']).toBe('ul. Krakowska 1, Krakow');
    expect(result.delivery['Delivery Fee']).toBe(30);
    expect(result.delivery.Status).toBe(DELIVERY_STATUS.PENDING);
  });

  it('omits Stock Item link when stockItemId is missing', async () => {
    const customer = await makeCustomer();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-100',
      wixOrderId: 'wix-uuid-2',
      customerRequest: 'Wix Order #2',
      requiredBy: null,
      paymentStatus: 'Unpaid',
      paymentMethod: null,
      priceOverride: null,
      lines: [{ flowerName: 'Mystery', quantity: 1, costPricePerUnit: 0, sellPricePerUnit: 0 }],
      delivery: { address: '', recipientName: '', recipientPhone: '', date: null, fee: 0 },
    });

    expect(result.lines[0]['Stock Item']).toBeFalsy();
  });

  it('preserves Stock Item link when stockItemId is present', async () => {
    const customer = await makeCustomer();
    // phase7-seed seeds at least one stock row; pull its uuid
    const stockRow = await db.query.stock.findFirst();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-101',
      wixOrderId: 'wix-uuid-3',
      customerRequest: 'Wix Order #3',
      requiredBy: null,
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 100,
      lines: [{ stockItemId: stockRow.id, flowerName: stockRow.displayName, quantity: 2, costPricePerUnit: stockRow.currentCostPrice, sellPricePerUnit: stockRow.currentSellPrice }],
      delivery: { address: 'A', recipientName: 'R', recipientPhone: '+48500000000', date: null, fee: 0 },
    });

    expect(result.lines[0]['Stock Item']).toEqual([stockRow.id]);
  });

  it('rolls back on line insert failure', async () => {
    const customer = await makeCustomer();
    await expect(orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-102',
      wixOrderId: 'wix-uuid-4',
      customerRequest: 'Wix Order #4',
      requiredBy: null,
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 50,
      lines: [{ stockItemId: 'rec-not-a-real-id', flowerName: 'Bad', quantity: 1, costPricePerUnit: 0, sellPricePerUnit: 0 }],
      delivery: { address: 'A', recipientName: 'R', recipientPhone: '+48500000000', date: null, fee: 0 },
    })).rejects.toThrow();

    // Verify no order was committed
    const orphan = await db.query.orders.findFirst({ where: (o, { eq }) => eq(o.appOrderId, '202605-102') });
    expect(orphan).toBeUndefined();
  });

  it('throws if MODE !== postgres', async () => {
    const orig = process.env.ORDER_BACKEND;
    process.env.ORDER_BACKEND = 'airtable';
    // Note: MODE is captured at module load — this test is informational only,
    // documenting the precondition. The runtime guard inside createWixOrder
    // protects against accidental misuse.
    process.env.ORDER_BACKEND = orig;
  });
});
```

- [ ] **Step 1.2: Run tests, confirm they fail**

```
cd backend && npx vitest run src/__tests__/orderRepoCreateWixOrder.integration.test.js
```
Expected: 4 fails with `createWixOrder is not a function`.

- [ ] **Step 1.3: Implement `createWixOrder` in `backend/src/repos/orderRepo.js`**

Add after `mirrorAirtableOrder` (~line 470 of current file):

```js
// ── createWixOrder — direct PG transactional write for the Wix webhook ──
//
// Wix webhook bypasses orderService.createOrder because:
//   - No stock deduction (Wix products don't 1:1 map to stock items;
//     florist composes the bouquet manually post-order).
//   - No auto-match prompts, owner-price cascades, driver-of-day.
//   - Source/createdBy/Status are Wix invariants.
// Replaces the old "create-in-Airtable then mirrorAirtableOrder" flow that
// lived in wix.js until PR 2a.
export async function createWixOrder(params) {
  if (MODE !== 'postgres') {
    throw new Error('orderRepo.createWixOrder: requires ORDER_BACKEND=postgres');
  }
  if (!db) throw new Error('orderRepo.createWixOrder: postgres backend not configured');

  const {
    customerId, appOrderId, wixOrderId, customerRequest,
    requiredBy, paymentStatus, paymentMethod, priceOverride,
    lines: lineParams, delivery: deliveryParams,
  } = params;

  return await db.transaction(async (tx) => {
    const orderInsert = {
      customerId,
      appOrderId,
      wixOrderId: wixOrderId || null,
      source: 'Wix',
      createdBy: 'Wix Webhook',
      status: ORDER_STATUS.NEW,
      deliveryType: 'Delivery',
      orderDate: new Date().toISOString().split('T')[0],
      requiredBy: requiredBy || null,
      customerRequest: customerRequest || '',
      notesOriginal: customerRequest || '',
      greetingCardText: '',
      paymentStatus: paymentStatus || 'Unpaid',
      paymentMethod: paymentMethod || null,
      priceOverride: priceOverride ?? null,
      deliveryFee: Number(deliveryParams?.fee) || 0,
    };

    const [insertedOrder] = await tx.insert(orders).values(orderInsert).returning();
    const insertedLines = [];
    for (const line of lineParams || []) {
      const lineInsert = {
        orderId: insertedOrder.id,
        stockItemId: line.stockItemId || null,
        flowerName: line.flowerName || '',
        quantity: Number(line.quantity) || 0,
        costPricePerUnit: Number(line.costPricePerUnit) || 0,
        sellPricePerUnit: Number(line.sellPricePerUnit) || 0,
      };
      const [insertedLine] = await tx.insert(orderLines).values(lineInsert).returning();
      insertedLines.push(insertedLine);
    }

    const deliveryInsert = {
      linkedOrderId: insertedOrder.id,
      deliveryAddress: deliveryParams?.address || '',
      recipientName: deliveryParams?.recipientName || '',
      recipientPhone: deliveryParams?.recipientPhone || '',
      deliveryDate: deliveryParams?.date || null,
      deliveryTime: '',
      deliveryFee: Number(deliveryParams?.fee) || 0,
      status: DELIVERY_STATUS.PENDING,
    };
    const [insertedDelivery] = await tx.insert(deliveries).values(deliveryInsert).returning();

    return {
      order: orderRowToWire(insertedOrder, { lines: insertedLines, delivery: insertedDelivery }),
      lines: insertedLines.map(lineRowToWire),
      delivery: deliveryRowToWire(insertedDelivery),
    };
  });
}
```

Cross-reference the existing `orderRowToWire` / `lineRowToWire` / `deliveryRowToWire` helpers in `orderRepo.js` and re-use them as-is. If they take a different shape than assumed here, adjust the return statement to match the existing wire-format used by `mirrorAirtableOrder`'s success path.

Add the `DELIVERY_STATUS` import at the top of orderRepo.js if not already present:
```js
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';
```

- [ ] **Step 1.4: Run tests, confirm they pass**

```
cd backend && npx vitest run src/__tests__/orderRepoCreateWixOrder.integration.test.js
```
Expected: all 4 pass.

- [ ] **Step 1.5: Run full backend suite — verify nothing else broke**

```
cd backend && npx vitest run
```
Expected: same baseline as before this task (343 passed + 1 todo) **plus 4 new passes** = 347 + 1 todo.

- [ ] **Step 1.6: Commit**

```bash
git add backend/src/repos/orderRepo.js backend/src/__tests__/orderRepoCreateWixOrder.integration.test.js
git commit -m "feat(orderRepo): add createWixOrder for direct PG transactional write"
```

**REVIEW GATE:** This task is on the Known-Pitfall list (Wix sync) — run per-task code-quality review (Opus). Spec-compliance review (Sonnet) on every task is mandatory regardless.

---

### Task 2: Migrate `processWixOrder` writes to `createWixOrder` + `stockRepo.list`

**Files:**
- Modify: `backend/src/services/wix.js` (sections 10-12 of `processWixOrder` — currently lines ~316–445)

**Why:** Replace the four Airtable writes (`db.create(ORDERS|ORDER_LINES|DELIVERIES)`) and the stock-list read (`db.list(STOCK)`) with PG-native equivalents. Drop the `mirrorAirtableOrder` call. Wix orders stop touching Airtable. The mock-airtable harness still has `db.create` / `db.list` callable (the shim is alive until PR 2b), so the change is local.

**The new flow inside `processWixOrder`:**
1. Stock match — `stockRepo.list({ activeOnly: true, fields: ['Display Name', 'Current Quantity', 'Current Cost Price', 'Current Sell Price'] })` (note: `stockRepo.list` already returns wire-format with these fields populated; check the existing signature in `repos/stockRepo.js` and adjust if it doesn't accept `fields`).
2. Build line params from matched/unmatched products.
3. `await orderRepo.createWixOrder({...})` — single PG transaction.
4. Continue to inventory decrement (`productConfigRepo.decrementQuantity`) — already PG-native.
5. SSE broadcast + Telegram notification — unchanged.
6. **Delete** the entire `if (orderRepo.getBackendMode() !== 'airtable') { mirrorAirtableOrder(...) }` block.
7. **Delete** the `Stock Item` field guard — push it into `createWixOrder`'s line shape (already handled per Task 1).

- [ ] **Step 2.1: Verify `stockRepo.list` accepts the field-filter shape Wix needs**

```
grep -n "export function list\|^export async function list" backend/src/repos/stockRepo.js
```

Read the function. If it does not accept `{ fields: [...] }` to project columns, that is fine — `stockRepo.list` returns full wire records and the Wix path can index `s['Display Name']` / `s['Current Quantity']` / etc. directly off whatever shape it returns. If `stockRepo.list({ activeOnly: true })` returns all active stock with the four fields populated, no change needed.

If `stockRepo.list` does **not** support `activeOnly` filtering, use `stockRepo.list()` then filter client-side: `const stock = (await stockRepo.list()).filter(s => s.Active === true || s['Active'] === true)`. Document the discrepancy as a follow-up but do not block on it.

- [ ] **Step 2.2: Edit `wix.js` `processWixOrder` — replace section 10 (order create)**

Find the block:
```js
const order = await db.create(TABLES.ORDERS, {
  Customer: [customerId],
  ...
  'Wix Order ID': wixOrderId,
});
log('10-ORDER', `Created order: ${order.id}`);
```

Replace with: a placeholder for now — the full new block lands after section 12 changes (the new repo call wraps order + lines + delivery into one transaction, so the order create and the lines create and the delivery create all happen in one place).

Remove the entire blocks for sections 10, 11 (line creation loop), and 12 (delivery create). Replace them with the assembly logic below (in step 2.5). Keep section 11b (`productConfigRepo.decrementQuantity` loop) — that is PG-native already and orthogonal to the order write.

- [ ] **Step 2.3: Edit `wix.js` `processWixOrder` — replace stock list (currently ~line 342)**

Replace:
```js
const stock = await db.list(TABLES.STOCK, {
  filterByFormula: '{Active} = TRUE()',
  fields: ['Display Name', 'Current Quantity', 'Current Cost Price', 'Current Sell Price'],
});
```

With:
```js
const stock = await stockRepo.list({ activeOnly: true });
```

(If `stockRepo.list` doesn't accept `activeOnly`, use the alternative from step 2.1.)

Add the import at the top of `wix.js`:
```js
import * as stockRepo from '../repos/stockRepo.js';
```

The downstream `stockByName` map and `fuzzyMatchStock` are unchanged — they index on `s['Display Name']` which is already the wire-format key.

- [ ] **Step 2.4: Edit `wix.js` `processWixOrder` — assemble line params**

Where the line-creation loop currently runs (after `stockByName` is built), build a plain JS array of line params for `createWixOrder` instead of issuing `db.create` per line. The existing logic that builds `lineFields` per item stays — just push into an array instead of writing.

Pseudocode:
```js
const linesForRepo = [];
for (const li of lineItems) {
  const productName = localizedText(li.productName) || li.name || 'Wix Item';
  const qty = li.quantity || 1;
  const unitPrice = moneyAmount(li.price)
    || moneyAmount(li.lineItemPrice)
    || moneyAmount(li.priceBeforeDiscounts)
    || moneyAmount(li.priceData?.price);
  const matched = fuzzyMatchStock(productName);

  linesForRepo.push({
    stockItemId: matched ? matched.id : undefined,
    flowerName: productName,
    quantity: qty,
    costPricePerUnit: matched ? Number(matched['Current Cost Price'] || 0) : 0,
    sellPricePerUnit: matched ? Number(matched['Current Sell Price'] || 0) : unitPrice,
  });

  log('11-LINE', matched
    ? `"${productName}" matched stock "${matched['Display Name']}"`
    : `"${productName}" (no stock match — text-only)`);
}
```

Note: the log line should fire **before** `createWixOrder` so that, even if the transaction fails, we have a trace of what was being attempted. Keep the order of operations: log → push.

- [ ] **Step 2.5: Edit `wix.js` `processWixOrder` — single repo call replaces sections 10/11/12**

After the line-assembly loop:

```js
const result = await orderRepo.createWixOrder({
  customerId,
  appOrderId,
  wixOrderId,
  customerRequest,
  requiredBy: deliveryDateIso,
  paymentStatus: wixOrder.paymentStatus === 'NOT_PAID' ? 'Unpaid' : 'Paid',
  paymentMethod: paymentMethodLabel,
  priceOverride: totalPrice > 0 ? totalPrice : null,
  lines: linesForRepo,
  delivery: {
    address: deliveryAddress,
    recipientName,
    recipientPhone,
    date: deliveryDateIso,
    fee: shippingFee,
  },
});

const order = result.order;
const createdLines = result.lines;
const deliveryRecord = result.delivery;

log('10-ORDER', `Created order: ${order.id}`);
log('12-DELIVERY', `Delivery created → ${deliveryAddress || '(empty — florist to fill)'}`);
```

Keep section 11b (productConfigRepo decrement) as-is — it runs after the order is committed, the existing position is correct.

**Delete** the entire block:
```js
// Phase 4 cutover: mirror to Postgres ...
if (orderRepo.getBackendMode() !== 'airtable') {
  try {
    await orderRepo.mirrorAirtableOrder({ order, lines: createdLines, delivery: deliveryRecord });
    log('12-PG', 'Mirrored to Postgres');
  } catch (mirrorErr) { ... }
}
```

The mirror is unnecessary — `createWixOrder` writes directly to PG.

- [ ] **Step 2.6: Update the `processWixOrder` JSDoc comment**

Current header (~line 121):
```
 * 1. Extract order ID from the webhook payload
 * 2. Dedup by Wix Order ID
 * 3. Fetch canonical order from Wix API (fall back to webhook payload)
 * 4. Match/create customer
 * 5. Create App Order + Order Lines + Delivery
 */
```

Replace step 5:
```
 * 5. Create order + lines + delivery in one PG transaction (orderRepo.createWixOrder)
 *    + decrement Wix per-variant stock counters (productConfigRepo).
 */
```

- [ ] **Step 2.7: Run Wix-specific test files (if any) + full backend suite**

```
cd backend && npx vitest run src/__tests__/wix
cd backend && npx vitest run
```
Expected: existing Wix tests still pass. Full suite: 347 + 1 todo (4 new from T1).

- [ ] **Step 2.8: Run E2E harness once to confirm the Wix path still works end-to-end**

The harness includes Wix-webhook fixtures. From repo root:
```
npm run harness &
HARNESS_PID=$!
sleep 5
npm run test:e2e
kill $HARNESS_PID
```

Expected: 153/153 assertions pass. If a Wix-related assertion fails, diagnose with `diagnose` skill — likely the `stockRepo.list` shape differs from `db.list(STOCK)`.

- [ ] **Step 2.9: Commit**

```bash
git add backend/src/services/wix.js
git commit -m "feat(wix): processWixOrder writes directly to Postgres via createWixOrder"
```

**REVIEW GATE:** Wix sync = Known Pitfall. Per-task code-quality review (Opus).

---

### Task 3: Drop Airtable from `reprocessWixOrder`

**Files:**
- Modify: `backend/src/services/wix.js` (section ~487+ — `reprocessWixOrder` and helpers)

**Why:** `reprocessWixOrder` still uses `listByIds(TABLES.ORDER_LINES, lineIds, ...)` to fetch the existing lines for the "is this order composed?" guard (~line 501). Replace with `orderRepo.getLinesForOrders([existing.id])` (existing helper added in Phase 7 PR 1) so the function stops touching Airtable. Also audit the rest of the function for any leftover `db.*` calls and migrate them.

- [ ] **Step 3.1: Read the full `reprocessWixOrder` body and inventory `db.*` / `listByIds` calls**

```
sed -n '487,570p' backend/src/services/wix.js
```

Note every `db.list` / `db.create` / `db.getById` / `listByIds(TABLES....)` call. The expected list (from PR 1's grep): one `listByIds(TABLES.ORDER_LINES, lineIds, {fields: [...]})` at ~line 501.

- [ ] **Step 3.2: Replace the line lookup with orderRepo helper**

Find:
```js
const lineRecords = existing._lines
  || (lineIds.length > 0
    ? await listByIds(TABLES.ORDER_LINES, lineIds, { fields: ['Stock Item', 'Flower Name', 'Quantity'] })
    : []);
```

Replace with:
```js
const lineRecords = existing._lines
  || (lineIds.length > 0 ? await orderRepo.getLinesForOrders([existing.id]) : []);
```

`existing` came from `orderRepo.findByWixOrderId` which already returns wire-format with Lines populated as `existing['Order Lines']` — the existing fallback is rarely used in practice. Confirm by reading `findByWixOrderId`:

```
grep -nA 20 "export async function findByWixOrderId" backend/src/repos/orderRepo.js
```

If `findByWixOrderId` already returns lines in `existing._lines` or `existing['Order Lines']`, this fallback may be dead — leave the orderRepo-based fallback in place anyway as defensive coding.

- [ ] **Step 3.3: Audit for any other `db.*` calls in `reprocessWixOrder` and the helpers it calls**

Within wix.js, check `_deleteOrderForReprocess`, `_deleteLines`, `_deleteDelivery` (or whatever the deletion helpers are called). If any use `db.deleteRecord(TABLES.X, id)`, migrate to `orderRepo.deleteById(id)` (or the closest existing helper). If no such helpers exist on orderRepo, file a TODO line — but check first; Phase 4 likely covered this.

```
grep -n "db\.\|TABLES\." backend/src/services/wix.js
```

For each remaining `db.` call: replace with the repo equivalent. If unclear which repo owns the call, ask the user before adding a new repo method.

- [ ] **Step 3.4: Run wix tests + full backend suite**

```
cd backend && npx vitest run src/__tests__/wix
cd backend && npx vitest run
```

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/services/wix.js
git commit -m "refactor(wix): reprocessWixOrder reads lines via orderRepo, drops Airtable"
```

**REVIEW GATE:** Wix sync = Known Pitfall. Per-task code-quality review (Opus). After this task, also run a **phase-boundary code-quality review** covering T1-T3 together.

---

### Task 4: Migrate `public.js` stock reads to `stockRepo.list`

**Files:**
- Modify: `backend/src/routes/public.js`

**Why:** Two endpoints (`GET /api/public/products` and `GET /api/public/stock-availability`) read stock from Airtable for the public Wix storefront. The `Active = TRUE()` formula is preserved in `stockRepo.list({ activeOnly: true })`.

- [ ] **Step 4.1: Add `stockRepo` import**

At the top of `backend/src/routes/public.js`, add:
```js
import * as stockRepo from '../repos/stockRepo.js';
```

- [ ] **Step 4.2: Replace the stock read in `/products` (~line 43)**

Find:
```js
const stockRows = await db.list(TABLES.STOCK, {
  filterByFormula: '{Active} = TRUE()',
  fields: ['Display Name', 'Current Quantity'],
});
```

Replace:
```js
const stockRows = await stockRepo.list({ activeOnly: true });
```

The downstream `stockMap = Object.fromEntries(stockRows.map(s => [s['Display Name'], Number(s['Current Quantity'] || 0)]))` keeps working — wire format is unchanged.

- [ ] **Step 4.3: Replace the stock read in `/stock-availability` (~line 141)**

Find:
```js
const rows = await db.list(TABLES.STOCK, {
  filterByFormula: '{Active} = TRUE()',
  fields: ['Display Name', 'Current Quantity'],
});
```

Replace:
```js
const rows = await stockRepo.list({ activeOnly: true });
```

The downstream `rows.map(r => ({...}))` is unchanged.

- [ ] **Step 4.4: Drop the `db` and `TABLES` imports if no other route in `public.js` uses them**

```
grep -n "\bdb\.\|\bTABLES\." backend/src/routes/public.js
```

If zero matches remain, delete:
```js
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

If matches remain, leave the imports. Note them for PR 2b.

- [ ] **Step 4.5: Run public-route tests + full suite**

```
cd backend && npx vitest run src/__tests__/public 2>&1 | tail -10
cd backend && npx vitest run
```

If no `public.test.js` exists, the change is exercised by the E2E harness's `/api/public/*` assertions. Run the harness:
```
npm run harness & sleep 5; npm run test:e2e; kill %1
```

- [ ] **Step 4.6: Commit**

```bash
git add backend/src/routes/public.js
git commit -m "refactor(public): /products and /stock-availability read from stockRepo"
```

---

### Task 5: Migrate `intake.js` stock read

**Files:**
- Modify: `backend/src/routes/intake.js`

**Why:** `POST /api/intake/parse` reads active stock for Claude AI's parser context. Single call. Same pattern as Task 4.

- [ ] **Step 5.1: Add `stockRepo` import**

```js
import * as stockRepo from '../repos/stockRepo.js';
```

- [ ] **Step 5.2: Replace the stock read (~line 33)**

Find:
```js
const stockItems = await db.list(TABLES.STOCK, {
  filterByFormula: '{Active} = TRUE()',
  fields: ['Display Name', 'Category', 'Current Quantity', 'Current Cost Price', 'Current Sell Price'],
});
```

Replace:
```js
const stockItems = await stockRepo.list({ activeOnly: true });
```

The downstream `parseRawText`, `parseFlowwowEmail`, `matchStockItems` all index on `s['Display Name']` etc. — wire format unchanged.

- [ ] **Step 5.3: Drop `db` + `TABLES` imports if no other usage in intake.js**

```
grep -n "\bdb\.\|\bTABLES\." backend/src/routes/intake.js
```

If zero matches, delete the two imports.

- [ ] **Step 5.4: Run intake tests + full suite**

```
cd backend && npx vitest run src/__tests__/intake 2>&1 | tail -10
cd backend && npx vitest run
```

- [ ] **Step 5.5: Commit**

```bash
git add backend/src/routes/intake.js
git commit -m "refactor(intake): parser stock read goes through stockRepo"
```

---

### Task 6: Migrate `batchQuery` callers and delete the utility

**Files:**
- Modify: `backend/src/routes/orders.js`, `backend/src/services/orderService.js`, `backend/src/services/wix.js`
- Delete: `backend/src/utils/batchQuery.js`

**Why:** `utils/batchQuery.js` exposes `listByIds(tableId, ids, opts)` which paginates a `filterByFormula: OR(RECORD_ID()=...)` against Airtable. Three callers remain post-T3. `orderRepo` already has `getLinesForOrders(orderIds)` and `getLinesByIds(ids)` (or equivalent — verify). Replace each call site, then delete the file.

- [ ] **Step 6.1: Inventory call sites (post-T3)**

```
grep -rn "listByIds\b" backend/src --include="*.js" | grep -v __tests__
```

Expected after T3 lands: orders.js (line 13 import + usage), orderService.js (line 13 import + usage). Wix.js usage was removed in T3.

For each call site, capture: which `TABLES.*` is being queried, what fields are requested, what the caller does with the result.

- [ ] **Step 6.2: Migrate `orders.js` call site(s)**

Read the file and find every `listByIds(TABLES.ORDER_LINES, ...)` / `listByIds(TABLES.DELIVERIES, ...)` / etc. For each:
- `TABLES.ORDER_LINES` → `orderRepo.getLinesForOrders(orderIds)` (returns lines for a list of orders, NOT by line ID — confirm shape).
  - If the caller passes line IDs (not order IDs), use `orderRepo.getLinesByIds(lineIds)` if it exists, otherwise add it (small repo addition: `SELECT * FROM order_lines WHERE id = ANY($1) OR airtable_id = ANY($1)` to support both ID forms — extends the dual-lookup pattern).
- `TABLES.DELIVERIES` → `orderRepo.getDeliveriesForOrders(orderIds)` or equivalent.
- Anything else → ask before improvising a new repo method.

After migration, delete the `import { listByIds } from '../utils/batchQuery.js';` line.

- [ ] **Step 6.3: Migrate `orderService.js` call site(s)**

Same pattern. After migration, delete the import line.

- [ ] **Step 6.4: Confirm zero callers remain, delete the utility**

```
grep -rn "listByIds\|utils/batchQuery" backend/src --include="*.js" | grep -v __tests__
```

Expect zero. Then:
```
rm backend/src/utils/batchQuery.js
```

If a test references `batchQuery`, leave the test alone but delete the file — vitest will skip the test if the import resolves to nothing. Better: also delete the test file if it exists and is exclusively for batchQuery.

```
find backend/src/__tests__ -name "batchQuery*"
```

- [ ] **Step 6.5: Run full backend suite**

```
cd backend && npx vitest run
```
Expected: same count as after T5 (no test added or removed in T6 unless batchQuery test was deleted).

- [ ] **Step 6.6: Commit**

```bash
git add backend/src/routes/orders.js backend/src/services/orderService.js backend/src/services/wix.js
git rm backend/src/utils/batchQuery.js
# only if a test file was deleted:
git rm backend/src/__tests__/batchQuery.test.js
git commit -m "refactor(backend): replace batchQuery with orderRepo helpers, delete utility"
```

---

### Task 7: Migrate `routes/test.js` to PG-native fixture seed

**Files:**
- Create: `backend/src/__tests__/helpers/phase7pr2a-seed.js`
- Modify: `backend/src/routes/test.js`

**Why:** `routes/test.js`'s `/test/reset` currently:
1. Calls `resetToFixture()` from `airtable-mock.js` (loads JSON into the in-memory mock).
2. Reads back from the mock via `_getTable(TABLES.X).values()` for STOCK, ORDERS, ORDER_LINES, DELIVERIES, CUSTOMERS.
3. Inserts into PG.

The bridge (`airtable-mock` → JSON → PG) is unnecessary. Read the JSON directly, seed PG. Drop the airtable-mock import. The airtable-mock state still gets reset for any non-migrated path that reads from it (none should remain after T6, but the harness shim still loads the mock — leave that path intact).

The existing `phase7-seed.js` already seeds Phase 7 tables (stock_orders, premade_bouquets, etc.). Extend it to cover **all** Phase 3-6 tables: STOCK, CUSTOMERS, ORDERS, ORDER_LINES, DELIVERIES, plus any stragglers used by `/test/reset`.

- [ ] **Step 7.1: Read current `routes/test.js` and inventory what gets seeded**

```
cat backend/src/routes/test.js
```

List every table currently seeded, the field mapping, the order of inserts (orders before lines, lines before deliveries, etc.), any post-insert ID maps used downstream.

- [ ] **Step 7.2: Read `phase7-seed.js` to understand the existing pattern**

```
cat backend/src/__tests__/helpers/phase7-seed.js
```

Note the helper signature, how it reads the fixture, how it inserts, how it returns ID maps (if any).

- [ ] **Step 7.3: Write `phase7pr2a-seed.js` extending the pattern**

The new helper exports `seedAllFromFixture(db)` which:
1. Reads `backend/src/services/__fixtures__/airtable-test-base.json` directly with `fs.readFileSync`.
2. For each table (STOCK, CUSTOMERS, ORDERS, ORDER_LINES, DELIVERIES, FLORIST_HOURS, MARKETING_SPEND, STOCK_LOSS_LOG, etc. — every table currently seeded by `routes/test.js`), iterate its records and insert into PG using the same field-mapping logic that lives in `routes/test.js`.
3. Builds `customerIdMap`, `orderIdMap` (recXXX → PG uuid) and uses them when inserting children that reference the parent.

The helper must be idempotent across calls: truncate every PG table before inserting, in dependency order (deliveries → order_lines → orders → customers → stock; FK CASCADE handles the rest).

The helper exports the same JSON-fixture as a constant if `routes/test.js` needs to know the original recXXX IDs (e.g., for `/test/state` to expose them).

```js
// backend/src/__tests__/helpers/phase7pr2a-seed.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '../../services/__fixtures__/airtable-test-base.json');

export function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
}

export async function seedAllFromFixture(db) {
  const fixture = loadFixture();

  // Truncate in FK-safe order. CASCADE handles dependent rows.
  await db.execute(sql`TRUNCATE TABLE
    deliveries, order_lines, orders, premade_bouquet_lines, premade_bouquets,
    stock_order_lines, stock_orders, stock_purchases, stock,
    customers, key_people,
    florist_hours, marketing_spend, stock_loss_log, app_config,
    audit_log, parity_log, sync_log, webhook_log, product_config,
    feedback_sessions
    RESTART IDENTITY CASCADE`);

  // Seed STOCK
  const stockMap = new Map(); // recXXX → uuid
  for (const r of fixture.STOCK || []) {
    const [row] = await db.insert(schema.stock).values({
      airtableId: r.id,
      displayName: r['Display Name'] || '',
      // ... all fields, mirroring routes/test.js current logic
    }).returning();
    stockMap.set(r.id, row.id);
  }
  // (continue for CUSTOMERS, KEY_PEOPLE, ORDERS, ORDER_LINES, DELIVERIES, etc.)

  return { stockMap, /* customerMap, orderMap, etc. */ };
}
```

The full mapping body is mechanical — copy each insert from `routes/test.js`, replace `_getTable(TABLES.X).values()` with `fixture.X || []`, and replace lookups in `xxxIdMap.get(r.id)` with the same map populated here. **Keep field names exactly as `routes/test.js` writes them today** — the harness's E2E suite depends on the exact fixture state.

- [ ] **Step 7.4: Rewrite `routes/test.js` to use the new helper**

Replace the body of the `/test/reset` POST handler with:
```js
import { seedAllFromFixture } from '../__tests__/helpers/phase7pr2a-seed.js';
import { db } from '../db/index.js';

router.post('/reset', async (req, res) => {
  try {
    await seedAllFromFixture(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('[TEST/RESET] failed:', err);
    res.status(500).json({ error: err.message });
  }
});
```

Remove the imports `resetToFixture, _snapshotAllTables, _getTable` from `'../services/airtable-mock.js'` and the `TABLES` import from `'../config/airtable.js'` if they have no other usage.

If `/test/state` or `/test/audit` or `/test/parity` references any of those imports, migrate them too. `/test/state` should expose PG row counts (already partially done in PR 1 per the summary); make sure it does **not** call `_snapshotAllTables` of the airtable-mock — read everything from PG.

- [ ] **Step 7.5: Run E2E harness end-to-end**

```
npm run harness & sleep 5
npm run test:e2e
kill %1
```
Expected: 153/153 assertions pass. The `/test/reset` is called between tests — if the seed shape diverges from the airtable-mock shape, expect failures naming specific assertions; fix the field mapping in `phase7pr2a-seed.js`.

- [ ] **Step 7.6: Run full backend suite to confirm nothing else broke**

```
cd backend && npx vitest run
```

- [ ] **Step 7.7: Commit**

```bash
git add backend/src/__tests__/helpers/phase7pr2a-seed.js backend/src/routes/test.js
git commit -m "refactor(test): /test/reset seeds Postgres directly from JSON fixture"
```

**REVIEW GATE:** Test harness gates the entire E2E suite — per-task code-quality review (Opus). After this task, run a **phase-boundary code-quality review** covering T4-T7 together.

---

### Task 8: Verification + open PR

**Files:** No code changes. Verification only.

**Why:** PR-readiness gate per `CLAUDE.md` § "Pre-PR Verification". Every applicable check must produce green output before "ready for review".

- [ ] **Step 8.1: Backend tests**

```
cd backend && npx vitest run 2>&1 | tail -5
```
Expected: 347+ passed / 1 todo / 0 failed. Capture the exact line for the PR description.

- [ ] **Step 8.2: Shared package tests**

```
cd packages/shared && ../../backend/node_modules/.bin/vitest run 2>&1 | tail -5
```
Expected: 98 passed (or whatever the current shared baseline is — match it exactly). PR 2a does not touch `packages/shared`, so the count must be unchanged.

- [ ] **Step 8.3: Build all three apps (Vercel preview parity)**

```
cd apps/florist  && ./node_modules/.bin/vite build 2>&1 | tail -5
cd ../dashboard  && ./node_modules/.bin/vite build 2>&1 | tail -5
cd ../delivery   && ./node_modules/.bin/vite build 2>&1 | tail -5
```
Expected: each ends in `✓ built in <N>ms`. PR 2a does not touch frontend code, but the rule from the lucide-react incident still applies: build all three apps before pushing.

- [ ] **Step 8.4: E2E harness**

```
cd /Users/oliwer/Projects/flower-studio/.worktrees/phase7-pr2a-airtable-bypasses
npm run harness > /tmp/harness.log 2>&1 &
HARNESS_PID=$!
sleep 5
npm run test:e2e 2>&1 | tail -10
kill $HARNESS_PID
```
Expected: 153/153 assertions pass. Capture the section count + assertion count for the PR.

- [ ] **Step 8.5: Update CHANGELOG.md and BACKLOG.md**

`CHANGELOG.md`: add an entry under today's date describing the bypass migration. Reference PR 2b as the follow-up that deletes infrastructure.

`BACKLOG.md`: tick off the Phase 7 PR 2a checklist item if one exists; add a PR 2b checklist if not already present.

- [ ] **Step 8.6: Push branch + open PR**

```
git push -u origin chore/phase7-pr2a-airtable-bypasses
gh pr create --title "chore(phase7): PR 2a — migrate live Airtable bypasses to Postgres" --body "$(cat <<'EOF'
## Summary
- New `orderRepo.createWixOrder` writes Wix orders + lines + delivery in one PG transaction. `wix.js` calls it directly; the old "create-in-Airtable then `mirrorAirtableOrder`" flow is gone.
- `public.js` (`/products`, `/stock-availability`), `intake.js` (`/parse`), and `wix.js` (`processWixOrder` + `reprocessWixOrder`) read stock/lines through the repos instead of `airtable.js`.
- `utils/batchQuery.js` deleted; its three callers now use `orderRepo` helpers.
- `/test/reset` seeds Postgres directly from `airtable-test-base.json` — no more airtable-mock bridge.

`airtable.js`, the mocks, the schema validator, the boot guard, the `STOCK_BACKEND` / `ORDER_BACKEND` flag plumbing, the dead fallback branches, and the `airtable` npm dep all remain — they ship in **PR 2b** once this has run in prod for ≥48h.

## Verification
- Backend Vitest: <paste line from 8.1>
- Shared Vitest: <paste line from 8.2>
- Apps build (florist, dashboard, delivery): <paste line from 8.3>
- E2E harness: 153/153 assertions across 24 sections (paste actual count)
- Pre-existing prod data: 5 Wix orders mirrored to PG since 2026-04 (most recent 2026-05-06) — `wix_order_id` populated correctly. `createWixOrder` produces the same wire shape, verified in T1's integration tests.

## Risk + rollout
- `wix.js` is the highest-risk change (production webhook). The new path lands in one transaction (vs. four Airtable calls + a mirror), so failure modes are simpler. Wix replays the webhook on 5xx, so a transient PG blip self-heals.
- `routes/test.js` rewrite gates the E2E suite — verified locally before push.
- After merge: leave PR 2b for ≥48h to confirm Wix orders keep landing in PG with the right shape (probe via `SELECT source, COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY source`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.7: Final code review (whole-branch diff)**

After the PR is open, dispatch a final reviewer subagent (Opus) over the full branch diff. Pass: the diff, the spec, `CLAUDE.md` Known Pitfalls section. Resolve any high-confidence issues before merge.

- [ ] **Step 8.8: Merge + clean up worktree**

After CI green and final review approves:
```
gh pr merge --squash --delete-branch <PR>
cd /Users/oliwer/Projects/flower-studio
git worktree remove .worktrees/phase7-pr2a-airtable-bypasses
git pull origin master
```

---

## Phase / review summary

| Phase | Tasks | Per-task quality review | Phase-boundary quality review |
|-------|-------|--------------------------|------------------------------|
| A: Wix migration | T1, T2, T3 | T1, T2, T3 (Wix sync = Known Pitfall) | After T3 (covers T1-T3 together) |
| B: Read-path migration | T4, T5, T6 | none | none — all mechanical |
| C: Test harness | T7 | T7 (gates E2E) | After T7 (covers T4-T7 together) |
| D: Ship | T8 | n/a | Final reviewer over whole diff |

Spec-compliance reviewer (Sonnet, cheap) runs after **every** task. Code-quality reviewer (Opus) runs only at the per-task gates above and at the two phase boundaries — saves ~6 Opus subagent dispatches vs. naive "every task".

## Out of scope (explicit non-goals)

- Deleting `airtable.js`, the mocks, the schema validator, the flag logic, the dead branches, or the npm dep — that is **PR 2b**. After PR 2a runs in prod for ≥48h.
- Touching `packages/shared` or the three React apps. PR 2a is backend-only.
- Refactoring `wix.js` beyond the bypass cleanup. The 1200+ line file is a known split candidate; that is its own future PR.
- Cancelling the Airtable subscription. Owner action, post-PR-2b.
