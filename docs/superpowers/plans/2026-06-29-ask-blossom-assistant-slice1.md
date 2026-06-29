# Ask Blossom Assistant — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tracer-bullet slice of an Owner-only natural-language analytics assistant: a tool-use loop over a small registry of tested, programmatic query functions (orders + finance), exposed at `POST /api/assistant/message`, and rendered in a shared chat panel mounted in the dashboard.

**Architecture:** The frontend chat panel posts a question to a backend service that runs an Anthropic tool-use loop. The model never writes SQL — it picks from a registry of typed tools whose handlers are **thin adapters** over the existing canonical service/repo layer (`orderRepo.list`, `analyticsService`). Aggregates are computed over the full match; only row *lists* are capped. Finance answers call the exact same `computeAnalytics()` the dashboard's `/api/analytics` route calls, so the numbers match by construction.

**Tech Stack:** Node.js + Express, `@anthropic-ai/sdk ^0.78.0`, Drizzle/Postgres (pglite in tests), Vitest, React + Vite + Tailwind, `react-markdown` (new dep), axios shared client.

## Global Constraints

- ES modules, `async/await`, no callbacks. Routes are thin controllers; logic in `services/`.
- Tools are **read-only thin adapters**: a handler may only call canonical repos/services and shape output. No business logic, no SQL, no aggregation inside a handler. The handler must never read `STOCK_Y_MODEL` — it delegates to code that does.
- Use status constants from `backend/src/constants/statuses.js` (`ORDER_STATUS.*`), never raw strings.
- Owner-gate is structural: the route uses `authorize('assistant')` and `'assistant'` is added to `ROLE_ACCESS.owner` **only** (not florist/driver).
- Currency PLN, display "zł". UI strings via `t.xxx` (Russian default). Comments in English.
- Every caught error: `console.error(...)` on backend, Russian toast `err.response?.data?.error || t.fallback` on frontend. No silent catch.
- Default model via `process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6'`.
- Mock external deps in tests — never real network. Mock `@anthropic-ai/sdk` with the `vi.hoisted()` pattern.
- Every commit message ends with the footer from CLAUDE.md:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015Q85Nscp6hSQzw5ddLAs6w
  ```
- Stage explicit paths — never `git add -A` (repo is full of untracked scratch).

---

### Task 1: Orders pack — registry + `query_orders` + `breakdown_orders`

**Files:**
- Create: `backend/src/services/assistantTools/ordersPack.js`
- Create: `backend/src/services/assistantTools/index.js`
- Test: `backend/src/__tests__/assistantTools.ordersPack.integration.test.js`

**Interfaces:**
- Consumes: `orderRepo.list({ pg })` → array of Airtable-shaped rows with keys `'App Order ID'`, `'Order Date'`, `'Required By'`, `'Delivery Type'`, `Status`, `Source`, `'Payment Status'`, `'Payment Method'`. `ORDER_STATUS` from `constants/statuses.js`.
- Produces:
  - `queryOrdersHandler(input) → { matchedCount, truncated, shown, orders: [{id, orderDate, requiredBy, deliveryType, status, source, paymentStatus}] }`
  - `breakdownOrdersHandler(input) → { dimension, total, breakdown: { [key]: count } }`
  - `TOOL_DEFS` (array of `{name, description, input_schema}`), `TOOL_HANDLERS` (`{[name]: handler}`), `TOOLS` (registry).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/__tests__/assistantTools.ordersPack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { queryOrdersHandler, breakdownOrdersHandler } from '../services/assistantTools/ordersPack.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  // Seed: 3 May orders (2 Delivery, 1 Pickup), 1 April order, 1 Cancelled May order.
  // NOTE: consult backend/src/db/schema.js (orders, ~lines 145-185) and add any
  // additional NOT NULL columns the insert needs.
  await harness.db.insert(orders).values([
    { appOrderId: 'BLO-1', orderDate: '2026-05-03', requiredBy: '2026-05-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Instagram' },
    { appOrderId: 'BLO-2', orderDate: '2026-05-10', requiredBy: '2026-05-11', deliveryType: 'Delivery', status: 'New', paymentStatus: 'Unpaid', source: 'Wix' },
    { appOrderId: 'BLO-3', orderDate: '2026-05-20', requiredBy: '2026-05-20', deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', source: 'In-store' },
    { appOrderId: 'BLO-4', orderDate: '2026-04-15', requiredBy: '2026-04-16', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Wix' },
    { appOrderId: 'BLO-5', orderDate: '2026-05-25', requiredBy: '2026-05-26', deliveryType: 'Delivery', status: 'Cancelled', paymentStatus: 'Unpaid', source: 'Wix' },
  ]);
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('ordersPack.queryOrdersHandler', () => {
  it('counts May orders by order date, excluding cancelled', async () => {
    const r = await queryOrdersHandler({ dateField: 'order', from: '2026-05-01', to: '2026-05-31' });
    expect(r.matchedCount).toBe(3); // BLO-1,2,3 (BLO-5 cancelled excluded, BLO-4 is April)
    expect(r.truncated).toBe(false);
    expect(r.orders.map(o => o.id).sort()).toEqual(['BLO-1', 'BLO-2', 'BLO-3']);
  });
  it('includes the requested status even when Cancelled', async () => {
    const r = await queryOrdersHandler({ dateField: 'order', from: '2026-05-01', to: '2026-05-31', status: 'Cancelled' });
    expect(r.matchedCount).toBe(1);
    expect(r.orders[0].id).toBe('BLO-5');
  });
});

describe('ordersPack.breakdownOrdersHandler', () => {
  it('breaks May orders down by deliveryType', async () => {
    const r = await breakdownOrdersHandler({ dimension: 'deliveryType', from: '2026-05-01', to: '2026-05-31' });
    expect(r.total).toBe(3);
    expect(r.breakdown).toEqual({ Delivery: 2, Pickup: 1 });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.ordersPack.integration.test.js`
Expected: FAIL — `Cannot find module '../services/assistantTools/ordersPack.js'`.

- [ ] **Step 3: Implement `ordersPack.js`**

```javascript
// backend/src/services/assistantTools/ordersPack.js
import * as orderRepo from '../../repos/orderRepo.js';
import { ORDER_STATUS } from '../../constants/statuses.js';

const SOFT_ROW_CAP = 50;
const HARD_ROW_CEILING = 250;

function buildPg(input) {
  const { dateField = 'order', from, to, status, deliveryType, source, paymentStatus, paymentMethod, customerId } = input;
  // When a specific status is requested, do NOT also exclude Cancelled — the user asked for it.
  const pg = status ? {} : { excludeStatuses: [ORDER_STATUS.CANCELLED] };
  if (dateField === 'delivery') { if (from) pg.requiredByFrom = from; if (to) pg.requiredByTo = to; }
  else { if (from) pg.dateFrom = from; if (to) pg.dateTo = to; }
  if (status) pg.statuses = [status];
  if (deliveryType) pg.deliveryType = deliveryType;
  if (source) pg.source = source;
  if (paymentStatus) pg.paymentStatus = paymentStatus;
  if (paymentMethod) pg.paymentMethod = paymentMethod;
  if (customerId) pg.customerId = customerId;
  return pg;
}

export async function queryOrdersHandler(input) {
  const { from, to } = input;
  const rows = await orderRepo.list({ pg: buildPg(input) });
  const matchedCount = rows.length;
  const bounded = Boolean(from && to);
  const cap = bounded ? HARD_ROW_CEILING : SOFT_ROW_CAP;
  const shownRows = rows.slice(0, cap);
  return {
    matchedCount,
    truncated: matchedCount > shownRows.length,
    shown: shownRows.length,
    orders: shownRows.map(o => ({
      id: o['App Order ID'],
      orderDate: o['Order Date'],
      requiredBy: o['Required By'],
      deliveryType: o['Delivery Type'],
      status: o.Status,
      source: o.Source,
      paymentStatus: o['Payment Status'],
    })),
  };
}

const DIMENSION_KEY = {
  deliveryType: o => o['Delivery Type'] || 'Unknown',
  source: o => o.Source || 'Unknown',
  status: o => o.Status,
  paymentStatus: o => o['Payment Status'],
  paymentMethod: o => o['Payment Method'] || 'Unknown',
};

export async function breakdownOrdersHandler(input) {
  const { dimension } = input;
  const keyOf = DIMENSION_KEY[dimension];
  if (!keyOf) throw new Error(`Unknown breakdown dimension: ${dimension}`);
  const rows = await orderRepo.list({ pg: buildPg({ ...input, status: undefined }) });
  const breakdown = {};
  for (const o of rows) { const k = keyOf(o); breakdown[k] = (breakdown[k] || 0) + 1; }
  return { dimension, total: rows.length, breakdown };
}
```

- [ ] **Step 4: Implement the registry `index.js`**

```javascript
// backend/src/services/assistantTools/index.js
import { queryOrdersHandler, breakdownOrdersHandler } from './ordersPack.js';

// Each pack pushes { name, description, input_schema, handler }. Adding a domain = add a file + import + push here.
export const TOOLS = [
  {
    name: 'query_orders',
    description: 'Count and list orders in a date range with optional filters. Aggregate count is over the FULL match; the orders list may be capped (see truncated/shown). Use for "how many orders", "show me orders". Dates are YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        dateField: { type: 'string', enum: ['order', 'delivery'], description: "Filter by order placement date ('order') or required-by/delivery date ('delivery'). Default 'order'." },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        status: { type: 'string', description: 'Exact order status, e.g. New, Ready, Delivered, Picked Up, Cancelled. Cancelled orders are excluded unless this is set.' },
        deliveryType: { type: 'string', enum: ['Delivery', 'Pickup'] },
        source: { type: 'string', description: 'Order Source: In-store, Instagram, WhatsApp, Telegram, Wix, Flowwow, Other.' },
        paymentStatus: { type: 'string', enum: ['Unpaid', 'Partial', 'Paid'] },
        paymentMethod: { type: 'string', enum: ['Cash', 'Card', 'Transfer'] },
        customerId: { type: 'string' },
      },
    },
    handler: queryOrdersHandler,
  },
  {
    name: 'breakdown_orders',
    description: 'Group orders in a date range by one dimension and return counts per group. Use for "how does it break down by delivery/pickup/source/status/payment". Cancelled orders are excluded. For revenue breakdowns use financial_summary instead.',
    input_schema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: ['deliveryType', 'source', 'status', 'paymentStatus', 'paymentMethod'] },
        dateField: { type: 'string', enum: ['order', 'delivery'] },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['dimension'],
    },
    handler: breakdownOrdersHandler,
  },
];

export const TOOL_HANDLERS = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]));
export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.ordersPack.integration.test.js`
Expected: PASS (3 tests). If a NOT NULL column error appears, add that column to the seed rows from `schema.js`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/assistantTools/ordersPack.js backend/src/services/assistantTools/index.js backend/src/__tests__/assistantTools.ordersPack.integration.test.js
git commit -m "feat(assistant): orders tool pack (query_orders + breakdown_orders) + registry"
```

---

### Task 2: Analytics refactor + finance pack (`financial_summary`) with parity test

**Files:**
- Modify: `backend/src/services/analyticsService.js` (add `computeAnalytics`)
- Modify: `backend/src/routes/analytics.js` (route delegates to `computeAnalytics`)
- Create: `backend/src/services/assistantTools/financePack.js`
- Modify: `backend/src/services/assistantTools/index.js` (register the tool)
- Test: `backend/src/__tests__/assistantTools.financePack.integration.test.js`

**Interfaces:**
- Produces: `computeAnalytics({ from, to }) → <the exact object the GET /api/analytics handler currently returns>` (keys `period, revenue, costs, waste, delivery, orders, monthly, weeklyRhythm, customers, ...`). `financialSummaryHandler(input) → { period, revenue, delivery, revenueBySource, flowerMarginPercent }`.
- Consumes: existing `analyticsService` pure functions + the repo calls the route already makes.

- [ ] **Step 1: Extract `computeAnalytics` (refactor — behavior-preserving)**

Open `backend/src/routes/analytics.js`. The `GET /` handler (≈ lines 27–228) reads `from`/`to` from `req.query`, loads data (`orderRepo.list`, `stockRepo.list`, `stockPurchasesRepo.list`, `stockLossRepo.list`), calls `analyticsService` functions, and `res.json(payload)`. Move the body into a new exported function in `analyticsService.js`:

```javascript
// backend/src/services/analyticsService.js  (append)
import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import { ORDER_STATUS } from '../constants/statuses.js';

// Single source of truth for the analytics report. Called by BOTH the
// /api/analytics route and the assistant finance tool, so their numbers match.
export async function computeAnalytics({ from, to }) {
  // <-- paste the EXACT data-loading + analyticsService calls from the route here,
  //     replacing `req.query.from`/`req.query.to` with the `from`/`to` params and
  //     `res.json(payload)` with `return payload`. Preserve every field and any
  //     date-defaulting logic verbatim. Do not change any computation. -->
}
```

Then reduce the route handler to:

```javascript
// backend/src/routes/analytics.js  (the GET '/' handler body becomes)
router.get('/', async (req, res, next) => {
  try {
    const report = await computeAnalytics({ from: req.query.from, to: req.query.to });
    res.json(report);
  } catch (err) {
    next(err);
  }
});
```
Add `import { computeAnalytics } from '../services/analyticsService.js';` to the route. Keep any imports the route no longer uses only if still referenced elsewhere in the file.

- [ ] **Step 2: Write the failing finance-pack + parity test**

```javascript
// backend/src/__tests__/assistantTools.financePack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { financialSummaryHandler } from '../services/assistantTools/financePack.js';
import { computeAnalytics } from '../services/analyticsService.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  await harness.db.insert(orders).values([
    { appOrderId: 'BLO-1', orderDate: '2026-05-03', requiredBy: '2026-05-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Instagram', priceOverride: '120.00' },
    { appOrderId: 'BLO-2', orderDate: '2026-05-10', requiredBy: '2026-05-11', deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', source: 'Wix', priceOverride: '80.00' },
  ]);
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('financePack.financialSummaryHandler', () => {
  it('returns a finance subset that matches computeAnalytics (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await financialSummaryHandler(params);
    const full = await computeAnalytics(params);
    // Parity: the tool's figures are literally computeAnalytics's figures.
    expect(tool.revenue).toEqual(full.revenue);
    expect(tool.delivery).toEqual(full.delivery);
    expect(tool.revenueBySource).toEqual(full.orders.revenueBySource);
    expect(tool.flowerMarginPercent).toEqual(full.costs.flowerMarginPercent);
    expect(tool.period).toEqual(full.period);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.financePack.integration.test.js`
Expected: FAIL — `Cannot find module '../services/assistantTools/financePack.js'`.

- [ ] **Step 4: Implement `financePack.js`**

```javascript
// backend/src/services/assistantTools/financePack.js
import { computeAnalytics } from '../analyticsService.js';

export async function financialSummaryHandler(input) {
  const { from, to } = input;
  const report = await computeAnalytics({ from, to });
  // Thin adapter: surface a focused subset; never recompute.
  return {
    period: report.period,
    revenue: report.revenue,            // { total, flowers, delivery, avgOrderValue, orderCount, paidOrderCount }
    delivery: report.delivery,          // { deliveryCount, pickupCount, deliveryRevenue, avgDeliveryFee }
    revenueBySource: report.orders.revenueBySource,
    flowerMarginPercent: report.costs.flowerMarginPercent,
  };
}
```

- [ ] **Step 5: Register the tool in `index.js`**

Add the import and registry entry to `backend/src/services/assistantTools/index.js`:

```javascript
import { financialSummaryHandler } from './financePack.js';
// ...inside the TOOLS array, append:
  {
    name: 'financial_summary',
    description: 'Revenue and money figures for a date range: total revenue, flower vs delivery revenue, average order value, revenue per Order Source, flower margin %. Use for any "how much revenue/money/margin" question and for revenue (not count) breakdowns. Dates YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
    handler: financialSummaryHandler,
  },
```

- [ ] **Step 6: Run finance test + the full analytics test suite (refactor must not regress)**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.financePack.integration.test.js && npx vitest run analytics`
Expected: PASS. If the field names in `financePack.js` don't match `computeAnalytics`'s real output, fix `financePack.js` to the real keys (the parity test will guide you).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/analyticsService.js backend/src/routes/analytics.js backend/src/services/assistantTools/financePack.js backend/src/services/assistantTools/index.js backend/src/__tests__/assistantTools.financePack.integration.test.js
git commit -m "feat(assistant): finance tool via shared computeAnalytics; parity-pinned to /analytics"
```

---

### Task 3: Assistant agent loop service

**Files:**
- Create: `backend/src/services/assistantService.js`
- Test: `backend/src/__tests__/assistantService.test.js`

**Interfaces:**
- Consumes: `TOOL_DEFS`, `TOOL_HANDLERS` from `assistantTools/index.js`; `Anthropic` from `@anthropic-ai/sdk`.
- Produces: `ask({ sessionId, message }) → { sessionId, answer, toolResults: [{name, input, output}] }`.

- [ ] **Step 1: Write the failing test (mocked Anthropic)**

```javascript
// backend/src/__tests__/assistantService.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mockCreate }; } }));

// Mock the tool registry so the loop test is independent of real DB.
vi.mock('../services/assistantTools/index.js', () => ({
  TOOL_DEFS: [{ name: 'query_orders', description: 'd', input_schema: { type: 'object', properties: {} } }],
  TOOL_HANDLERS: { query_orders: vi.fn(async (input) => ({ matchedCount: 3, echo: input })) },
}));

import { ask } from '../services/assistantService.js';
import { TOOL_HANDLERS } from '../services/assistantTools/index.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('assistantService.ask', () => {
  it('runs a tool then returns the final text answer', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'query_orders', input: { from: '2026-05-01', to: '2026-05-31' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'В мае было 3 заказа.' }],
      });

    const r = await ask({ message: 'Сколько заказов в мае?' });

    expect(TOOL_HANDLERS.query_orders).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.answer).toBe('В мае было 3 заказа.');
    expect(r.toolResults).toEqual([{ name: 'query_orders', input: { from: '2026-05-01', to: '2026-05-31' }, output: { matchedCount: 3, echo: { from: '2026-05-01', to: '2026-05-31' } } }]);
    expect(r.sessionId).toBeTruthy();
    // Second call must include the tool_result so the model can answer.
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    expect(secondCallMessages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'))).toBe(true);
  });

  it('passes tools + a date-grounded system prompt on the first call', async () => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    await ask({ message: 'hi' });
    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toHaveLength(1);
    expect(call.system).toMatch(/\d{4}-\d{2}-\d{2}/); // today's date injected
  });

  it('continues an existing session by id', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }] });
    const first = await ask({ message: 'q1' });
    await ask({ sessionId: first.sessionId, message: 'q2' });
    const lastMessages = mockCreate.mock.calls.at(-1)[0].messages;
    expect(lastMessages.filter(m => m.role === 'user').length).toBeGreaterThanOrEqual(2);
  });

  it('stops after the iteration cap even if the model keeps calling tools', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'query_orders', input: {} }],
    });
    const r = await ask({ message: 'loop' });
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(7); // 1 initial + MAX_ITERATIONS(6)
    expect(r).toHaveProperty('answer');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && npx vitest run src/__tests__/assistantService.test.js`
Expected: FAIL — `Cannot find module '../services/assistantService.js'`.

- [ ] **Step 3: Implement `assistantService.js`**

```javascript
// backend/src/services/assistantService.js
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { TOOL_DEFS, TOOL_HANDLERS } from './assistantTools/index.js';

const anthropic = new Anthropic();
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
const MAX_ITERATIONS = 6;
const MAX_TOKENS = 2048;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map(); // sessionId -> { messages, createdAt }

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref();

function systemPrompt() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  return [
    "You are Blossom's analytics assistant for the studio owner. Blossom is a flower studio in Krakow.",
    `Today's date is ${today} (Europe/Warsaw). Resolve relative periods like "May", "last month", "this week" against it.`,
    'You answer questions about the business ONLY using the provided tools. Never write SQL.',
    'CRITICAL: State only numbers that came from a tool result. Never invent, estimate, or extrapolate figures. If no tool can answer the question, say so plainly.',
    'When a tool result has truncated=true, tell the user you are showing the first N of matchedCount and that they can ask to see all.',
    'Currency is Polish złoty — display amounts with "zł". Answer in the same language the user wrote in (default Russian). Present breakdowns as compact Markdown tables.',
  ].join('\n');
}

export async function ask({ sessionId, message }) {
  let session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    sessionId = crypto.randomUUID();
    session = { messages: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
  session.messages.push({ role: 'user', content: message });

  const toolResults = [];
  let iterations = 0;
  let response = await anthropic.messages.create({
    model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(), tools: TOOL_DEFS, messages: session.messages,
  });

  while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
    iterations++;
    session.messages.push({ role: 'assistant', content: response.content });
    const resultBlocks = [];
    for (const block of response.content.filter(b => b.type === 'tool_use')) {
      const handler = TOOL_HANDLERS[block.name];
      let output;
      try {
        output = handler ? await handler(block.input) : { error: `Unknown tool: ${block.name}` };
      } catch (err) {
        console.error(`[ASSISTANT] tool ${block.name} failed:`, err);
        output = { error: err.message };
      }
      toolResults.push({ name: block.name, input: block.input, output });
      resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
    }
    session.messages.push({ role: 'user', content: resultBlocks });
    response = await anthropic.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(), tools: TOOL_DEFS, messages: session.messages,
    });
  }

  session.messages.push({ role: 'assistant', content: response.content });
  const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { sessionId, answer, toolResults };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && npx vitest run src/__tests__/assistantService.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/assistantService.js backend/src/__tests__/assistantService.test.js
git commit -m "feat(assistant): tool-use loop service with session, date-grounded prompt, iteration cap"
```

---

### Task 4: Route + owner-gate + registration

**Files:**
- Create: `backend/src/routes/assistant.js`
- Modify: `backend/src/middleware/auth.js` (add `'assistant'` to `ROLE_ACCESS.owner`)
- Modify: `backend/src/index.js` (register router)
- Test: `backend/src/__tests__/assistant.route.test.js`

**Interfaces:**
- Consumes: `ask` from `assistantService.js`; `authorize` from `middleware/auth.js`.
- Produces: `POST /api/assistant/message { sessionId?, message } → { sessionId, answer, toolResults }`; 400 on missing message; gated to owner.

- [ ] **Step 1: Add `'assistant'` to the owner ROLE_ACCESS**

In `backend/src/middleware/auth.js`, add `'assistant'` to the `owner` array **only** (leave `florist` and `driver` unchanged):

```javascript
const ROLE_ACCESS = {
  owner:   ['orders', 'customers', 'stock', 'deliveries', 'dashboard', 'analytics', 'stock-purchases', 'stock-orders', 'auth', 'admin', 'premade-bouquets', 'feedback', 'issues', 'assistant'],
  florist: ['orders', 'customers', 'stock', 'stock-purchases', 'stock-orders', 'deliveries', 'premade-bouquets', 'feedback'],
  driver:  ['deliveries', 'stock-orders', 'auth', 'feedback'],
};
```

- [ ] **Step 2: Write the failing route test**

```javascript
// backend/src/__tests__/assistant.route.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/assistantService.js', () => ({
  ask: vi.fn(async ({ message }) => ({ sessionId: 's1', answer: `echo:${message}`, toolResults: [] })),
}));

import assistantRouter from '../routes/assistant.js';
import { ask } from '../services/assistantService.js';

function appWithRole(role) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = role; next(); }); // simulate authenticate()
  app.use('/api/assistant', assistantRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/assistant/message', () => {
  it('returns the assistant answer for the owner', async () => {
    const res = await request(appWithRole('owner')).post('/api/assistant/message').send({ message: 'привет' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('echo:привет');
    expect(ask).toHaveBeenCalledWith({ sessionId: undefined, message: 'привет' });
  });
  it('rejects a florist with 403', async () => {
    const res = await request(appWithRole('florist')).post('/api/assistant/message').send({ message: 'x' });
    expect(res.status).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
  it('400 when message missing', async () => {
    const res = await request(appWithRole('owner')).post('/api/assistant/message').send({});
    expect(res.status).toBe(400);
  });
});
```

> If `supertest` is not already a dev dependency, check `backend/package.json`; existing route tests reveal the project's HTTP-test convention — follow it (the repo has an E2E suite, so a route-level harness or `supertest` should exist). If neither, assert by calling the exported handler directly with mock `req`/`res`.

- [ ] **Step 3: Run it, verify it fails**

Run: `cd backend && npx vitest run src/__tests__/assistant.route.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route**

```javascript
// backend/src/routes/assistant.js
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { ask } from '../services/assistantService.js';

const router = Router();
router.use(authorize('assistant')); // owner-only per ROLE_ACCESS

router.post('/message', async (req, res, next) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }
    const result = await ask({ sessionId, message });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 5: Register the router in `index.js`**

In `backend/src/index.js`, after `app.use(authenticate)` and alongside the other `app.use('/api/...', ...)` lines:

```javascript
import assistantRoutes from './routes/assistant.js';
// ...
app.use('/api/assistant', assistantRoutes);
```

- [ ] **Step 6: Run the route test, verify it passes**

Run: `cd backend && npx vitest run src/__tests__/assistant.route.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/assistant.js backend/src/middleware/auth.js backend/src/index.js backend/src/__tests__/assistant.route.test.js
git commit -m "feat(assistant): POST /api/assistant/message route, owner-gated + registered"
```

---

### Task 5: Shared chat panel component

**Files:**
- Create: `packages/shared/components/AskBlossomPanel.jsx`
- Modify: `packages/shared/package.json` (add `react-markdown` dependency)
- Modify: `packages/shared/index.js` (re-export the component, if the package uses a barrel)
- Test: `packages/shared/test/AskBlossomPanel.test.jsx`

**Interfaces:**
- Consumes: shared `client` (`packages/shared/api/client.js`) → `client.post('/assistant/message', { sessionId, message })`. Prop `t` (translations object) supplied by the host app.
- Produces: default-exported `AskBlossomPanel({ t })` React component.

- [ ] **Step 1: Add the dependency**

In `packages/shared/package.json`, add to `dependencies`:

```json
"react-markdown": "^9.0.1"
```
Then from repo root: `npm install`. (Declaring it in shared's deps — not relying on hoisting — is required; see CLAUDE.md pre-PR notes about `lucide-react`.)

- [ ] **Step 2: Write the failing component test**

```jsx
// packages/shared/test/AskBlossomPanel.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AskBlossomPanel from '../components/AskBlossomPanel.jsx';

vi.mock('../api/client.js', () => ({ default: { post: vi.fn() } }));
import client from '../api/client.js';

const t = { assistantPlaceholder: 'Спросите…', assistantSend: 'Спросить', assistantThinking: 'Думаю…', assistantError: 'Ошибка', assistantEmpty: 'Задайте вопрос о ваших данных' };

beforeEach(() => vi.clearAllMocks());

describe('AskBlossomPanel', () => {
  it('sends a question and renders the markdown answer', async () => {
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: '**142** заказа', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'Сколько заказов?' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('Сколько заказов?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('142')).toBeInTheDocument()); // bold rendered by markdown
    expect(client.post).toHaveBeenCalledWith('/assistant/message', { sessionId: null, message: 'Сколько заказов?' });
  });

  it('reuses the sessionId on the second question', async () => {
    client.post
      .mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } })
      .mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'b', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    const input = screen.getByPlaceholderText('Спросите…');
    fireEvent.change(input, { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('a');
    fireEvent.change(input, { target: { value: 'q2' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('b');
    expect(client.post).toHaveBeenLastCalledWith('/assistant/message', { sessionId: 's1', message: 'q2' });
  });

  it('shows an error bubble when the request fails', async () => {
    client.post.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomPanel.test.jsx`
Expected: FAIL — component module not found.

- [ ] **Step 4: Implement the component**

```jsx
// packages/shared/components/AskBlossomPanel.jsx
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import client from '../api/client.js';

export default function AskBlossomPanel({ t }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data } = await client.post('/assistant/message', { sessionId, message: text });
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      <div className="flex-1 overflow-y-auto space-y-3 p-2">
        {messages.length === 0 && <p className="text-secondary text-center mt-8">{t.assistantEmpty}</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block rounded-lg px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              {m.role === 'assistant'
                ? <div className="prose prose-sm max-w-none"><ReactMarkdown>{m.text}</ReactMarkdown></div>
                : m.text}
            </div>
          </div>
        ))}
        {loading && <div className="text-left"><div className="inline-block rounded-lg px-3 py-2 bg-gray-100 text-gray-500">{t.assistantThinking}</div></div>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 p-2 border-t">
        <input
          className="flex-1 border rounded-lg px-3 py-2"
          placeholder={t.assistantPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <button className="bg-brand-600 text-white rounded-lg px-4 py-2 disabled:opacity-50" onClick={send} disabled={loading}>
          {t.assistantSend}
        </button>
      </div>
    </div>
  );
}
```

If `packages/shared/index.js` is a barrel that re-exports components, add:
```javascript
export { default as AskBlossomPanel } from './components/AskBlossomPanel.jsx';
```

- [ ] **Step 5: Run it, verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomPanel.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/components/AskBlossomPanel.jsx packages/shared/package.json packages/shared/index.js packages/shared/test/AskBlossomPanel.test.jsx package-lock.json
git commit -m "feat(assistant): shared AskBlossomPanel chat component (markdown render)"
```

---

### Task 6: Dashboard mount + translations + docs

**Files:**
- Create: `apps/dashboard/src/components/AssistantTab.jsx`
- Modify: `apps/dashboard/src/pages/DashboardPage.jsx` (lazy import + TABS entry + renderMountedTab)
- Modify: `apps/dashboard/src/translations.js` (new keys, all locales present)
- Modify: `CLAUDE.md`, `backend/CLAUDE.md`, `apps/dashboard/CLAUDE.md` (document the new route/service/tab)
- Create: `docs/superpowers/reports/2026-06-29-ask-blossom-slice1-dev-summary.md`

**Interfaces:**
- Consumes: `AskBlossomPanel` from shared; `t` from `apps/dashboard/src/translations.js`.
- Produces: an `assistant` tab in the dashboard rendering the chat panel.

- [ ] **Step 1: Add translation keys**

In `apps/dashboard/src/translations.js`, add to **every** locale block present (ru/en/pl) — Russian values shown; translate the others:

```javascript
// ru
tabAssistant: 'Помощник',
assistantPlaceholder: 'Спросите о заказах, выручке…',
assistantSend: 'Спросить',
assistantThinking: 'Думаю…',
assistantError: 'Не удалось получить ответ',
assistantEmpty: 'Задайте вопрос о ваших данных — например, «сколько заказов в мае?»',
```

- [ ] **Step 2: Create the dashboard tab wrapper**

```jsx
// apps/dashboard/src/components/AssistantTab.jsx
import AskBlossomPanel from '@flower-studio/shared/components/AskBlossomPanel.jsx';
import t from '../translations.js';

export default function AssistantTab({ isActive }) {
  if (!isActive) return null;
  return (
    <div className="p-4 h-[75vh]">
      <AskBlossomPanel t={t} />
    </div>
  );
}
```
(If the shared barrel is used elsewhere in this app, import `{ AskBlossomPanel }` from `@flower-studio/shared` instead — match the app's existing shared-import style.)

- [ ] **Step 3: Wire the tab into `DashboardPage.jsx`**

Add the lazy import near the other `lazy(() => import(...))` lines:
```javascript
const AssistantTab = lazy(() => import('../components/AssistantTab.jsx'));
```
Add to the `TABS` array (e.g. right after `financial`):
```javascript
    { key: 'assistant', label: t.tabAssistant },
```
Add the mount in `<main>` next to the other `renderMountedTab` calls:
```javascript
    {renderMountedTab('assistant',
      <AssistantTab isActive={activeTab === 'assistant'} />
    )}
```

- [ ] **Step 4: Build the dashboard (catches shared-dep + import errors)**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds. Then build the other two apps too, since `packages/shared` changed:
Run: `cd apps/florist && ./node_modules/.bin/vite build` and `cd apps/delivery && ./node_modules/.bin/vite build`
Expected: all succeed (verifies `react-markdown` resolves everywhere shared is imported).

- [ ] **Step 5: Manual smoke test**

Run: `npm run backend` (needs `ANTHROPIC_API_KEY`; optionally `ASSISTANT_MODEL`) and `npm run dashboard`. Log in with the Owner PIN, open the **Помощник** tab, ask "сколько заказов в мае?" then "как они делятся на доставку и самовывоз?". Confirm: a real number comes back, the follow-up keeps context, and a florist PIN does not see/can't reach the tab (403). Note the result in the dev-summary.

- [ ] **Step 6: Update docs**

- `CLAUDE.md` → "Key Files" / parity note: record `POST /api/assistant/message` (owner-only) and that the assistant's tools are thin adapters over canonical services (parity-pinned). Note it's dashboard-only in v1; florist mount is a follow-up.
- `backend/CLAUDE.md` → add `routes/assistant.js`, `services/assistantService.js`, `services/assistantTools/` and the `computeAnalytics` extraction to the structure tables.
- `apps/dashboard/CLAUDE.md` → add the Assistant tab + `AssistantTab.jsx`.
- Write the dev-summary (`docs/superpowers/reports/...`) per the dev-summary skill: What changed / Why / How it connects / What to watch for, with file paths.

- [ ] **Step 7: Run the full applicable check matrix, then commit**

Run: `cd backend && npx vitest run` (all backend), then `cd packages/shared && ../../backend/node_modules/.bin/vitest run`.
Run the E2E suite if backend routing changed: `npm run harness &` then `npm run test:e2e`.
Expected: green. Then:

```bash
git add apps/dashboard/src/components/AssistantTab.jsx apps/dashboard/src/pages/DashboardPage.jsx apps/dashboard/src/translations.js CLAUDE.md backend/CLAUDE.md apps/dashboard/CLAUDE.md docs/superpowers/reports/2026-06-29-ask-blossom-slice1-dev-summary.md
git commit -m "feat(assistant): mount Ask Blossom in dashboard (owner-only) + docs"
```

---

## Out of scope for this slice (follow-up plans)
- Deliveries / stock / purchasing / customers / hours tool packs — each its own small plan: add `<domain>Pack.js`, register in `index.js`, contract + parity tests. No core changes.
- Florist-app mount (fast-follow): a second `AssistantTab` wrapper + that app's translations; reuse the same shared `AskBlossomPanel`.
- Rich UI tables/charts in chat (answer format "B") — `toolResults` already returned; frontend-only later.
- Saved cross-session history, token streaming, golden-eval harness as CI job.

## Golden-eval note
A small manual eval (~15 NL questions → expected tool) is recommended before widening scope, run with the mocked-Anthropic harness from Task 3. Tracked as a follow-up, not a Slice-1 gate.
