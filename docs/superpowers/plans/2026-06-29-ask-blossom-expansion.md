# Ask Blossom — Expansion Slice (deliveries / purchasing / hours packs + florist mount)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend Ask Blossom's coverage with three new read-only tool packs (deliveries, purchasing/POs, hours/payroll) and mount the assistant in the florist app so the owner can use it on her phone.

**Architecture:** Each pack is a thin adapter over a canonical repo/service — never re-derives business logic, never touches `computeAnalytics`'s existing coverage. Packs register in `assistantTools/index.js` via the `TOOLS` array. The florist mount reuses the shared `AskBlossomPanel` behind an owner-only route (the feature is owner-only; the owner logs into the florist app with the Owner PIN).

**Tech Stack:** Express + Drizzle repos, Vitest (mock the canonical repo per pack — these packs' only logic is aggregation/shaping), React 18 + react-router + Tailwind (florist app), `@flower-studio/shared`.

## Global Constraints

- **Read-only + thin adapter.** Packs call canonical repos/services only — no SQL, no recomputed business logic. Mirror `customersPack.js` structure exactly (named handler exports, adaptive `CAP`, graceful degrade).
- **No duplication of `computeAnalytics`.** Confirmed gaps these packs fill: deliveries table (status/driver — `computeAnalytics.delivery` is order-derived pickup/delivery split only), PO workflow (not wired into analytics), hours/payroll (not wired). Do NOT re-expose revenue/margins/supplier-scorecard/customers — those are `financial_summary`/`customer_insights`.
- **Status enums** from `backend/src/constants/statuses.js`: `DELIVERY_STATUS`, `PO_STATUS`. Never raw strings.
- **Payroll math is canonical.** `hours_summary` MUST use `floristHoursService.buildPayroll(records, getConfig('floristRates'))` — the same call the owner payroll route (`routes/floristHours.js:64-65`) makes. The pack only groups buildPayroll's output per florist.
- **Money rounding:** round zł sums to 2 dp (`Math.round(n*100)/100`).
- **Florist mount is owner-only.** Route wrapped in `OwnerRoute`; nav entry only in the owner branch. The backend route is already owner-gated (`authorize('assistant')`) — no backend change for the mount.
- **Dependency safety (florist build):** `AskBlossomPanel` uses `prose` classes; add `@tailwindcss/typography` to the florist app (config + its OWN package.json) mirroring dashboard, or markdown renders unstyled. Build the florist app before committing Task 2 (Vercel builds each app in isolation).
- **Tests mandatory** for each new pack (`backend/src/__tests__/`).

---

### Task 1: Three backend tool packs + registration

**Files:**
- Create: `backend/src/services/assistantTools/deliveriesPack.js`
- Create: `backend/src/services/assistantTools/purchasingPack.js`
- Create: `backend/src/services/assistantTools/hoursPack.js`
- Modify: `backend/src/services/assistantTools/index.js`
- Test: `backend/src/__tests__/assistantTools.deliveriesPack.test.js`
- Test: `backend/src/__tests__/assistantTools.purchasingPack.test.js`
- Test: `backend/src/__tests__/assistantTools.hoursPack.test.js`

**Interfaces (verified signatures):**
- `orderRepo.listDeliveries({ pg: { from?, to?, status?, driver? } })` → array of delivery wire records with fields `id`, `Status`, `Assigned Driver`, `Delivery Date`, `Delivery Time`, `Recipient Name`, `Delivery Address`, `Delivery Fee`, `Delivered At`.
- `stockOrderRepo.list({ status? })` → PO wire records: `id`, `Status`, `Stock Order ID`, `Created Date`, `Planned Date`, `Assigned Driver`.
- `stockPurchasesRepo.list({ from?, to? })` → `[{ Supplier, 'Price Per Unit', 'Quantity Purchased', 'Purchase Date' }]`.
- `hoursRepo.list({ dateFrom?, dateTo?, name? })` → hours wire records; `floristHoursService.buildPayroll(records, rates)` → `{ days: [{ name, hours, earnings, deliveryCount, ... }], totals: { hours, earnings, deliveries, days } }`; `configService.getConfig('floristRates')`.
- Produces: 4 registered tools — `delivery_status`, `po_status`, `purchase_spend`, `hours_summary`.

- [ ] **Step 1: Write the failing tests for all three packs**

Create `backend/src/__tests__/assistantTools.deliveriesPack.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockListDeliveries } = vi.hoisted(() => ({ mockListDeliveries: vi.fn() }));
vi.mock('../repos/orderRepo.js', () => ({ listDeliveries: mockListDeliveries }));
import { deliveryStatusHandler } from '../services/assistantTools/deliveriesPack.js';
beforeEach(() => vi.clearAllMocks());

describe('deliveriesPack.delivery_status', () => {
  it('aggregates counts by status and driver', async () => {
    mockListDeliveries.mockResolvedValueOnce([
      { id: '1', Status: 'Delivered', 'Assigned Driver': 'Nikita', 'Delivery Date': '2026-05-02' },
      { id: '2', Status: 'Delivered', 'Assigned Driver': 'Timur', 'Delivery Date': '2026-05-03' },
      { id: '3', Status: 'Out for Delivery', 'Assigned Driver': 'Nikita', 'Delivery Date': '2026-05-04' },
    ]);
    const r = await deliveryStatusHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.matchedCount).toBe(3);
    expect(r.byStatus).toEqual({ Delivered: 2, 'Out for Delivery': 1 });
    expect(r.byDriver).toEqual({ Nikita: 2, Timur: 1 });
    expect(mockListDeliveries).toHaveBeenCalledWith({ pg: { from: '2026-05-01', to: '2026-05-31', status: undefined, driver: undefined } });
  });
  it('caps the data list and flags truncated', async () => {
    mockListDeliveries.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => ({ id: String(i), Status: 'Pending', 'Assigned Driver': 'X', 'Delivery Date': '2026-05-01' })));
    const r = await deliveryStatusHandler({});
    expect(r.matchedCount).toBe(30);
    expect(r.shown).toBe(25);
    expect(r.truncated).toBe(true);
  });
  it('counts null status/driver as Unknown/Unassigned', async () => {
    mockListDeliveries.mockResolvedValueOnce([{ id: '1', Status: null, 'Assigned Driver': null }]);
    const r = await deliveryStatusHandler({});
    expect(r.byStatus).toEqual({ Unknown: 1 });
    expect(r.byDriver).toEqual({ Unassigned: 1 });
  });
});
```

Create `backend/src/__tests__/assistantTools.purchasingPack.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockPoList, mockPurchList } = vi.hoisted(() => ({ mockPoList: vi.fn(), mockPurchList: vi.fn() }));
vi.mock('../repos/stockOrderRepo.js', () => ({ list: mockPoList }));
vi.mock('../repos/stockPurchasesRepo.js', () => ({ list: mockPurchList }));
import { poStatusHandler, purchaseSpendHandler } from '../services/assistantTools/purchasingPack.js';
beforeEach(() => vi.clearAllMocks());

describe('purchasingPack.po_status', () => {
  it('counts by status + open vs complete', async () => {
    mockPoList.mockResolvedValueOnce([
      { id: 'a', Status: 'Complete', 'Stock Order ID': 'PO-1', 'Created Date': '2026-05-01' },
      { id: 'b', Status: 'Sent', 'Stock Order ID': 'PO-2', 'Created Date': '2026-05-02' },
      { id: 'c', Status: 'Draft', 'Stock Order ID': 'PO-3', 'Created Date': '2026-05-03' },
    ]);
    const r = await poStatusHandler({});
    expect(r.matchedCount).toBe(3);
    expect(r.complete).toBe(1);
    expect(r.open).toBe(2);
    expect(r.byStatus).toEqual({ Complete: 1, Sent: 1, Draft: 1 });
    expect(mockPoList).toHaveBeenCalledWith({});
  });
  it('passes a status filter through', async () => {
    mockPoList.mockResolvedValueOnce([]);
    await poStatusHandler({ status: 'Complete' });
    expect(mockPoList).toHaveBeenCalledWith({ status: 'Complete' });
  });
});

describe('purchasingPack.purchase_spend', () => {
  it('sums total + by supplier (rounded)', async () => {
    mockPurchList.mockResolvedValueOnce([
      { Supplier: 'A', 'Price Per Unit': 2, 'Quantity Purchased': 10 },
      { Supplier: 'A', 'Price Per Unit': 1.5, 'Quantity Purchased': 4 },
      { Supplier: 'B', 'Price Per Unit': 3, 'Quantity Purchased': 5 },
    ]);
    const r = await purchaseSpendHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.purchaseCount).toBe(3);
    expect(r.totalSpend).toBe(41);
    expect(r.bySupplier).toEqual({ A: 26, B: 15 });
    expect(mockPurchList).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
  });
});
```

Create `backend/src/__tests__/assistantTools.hoursPack.test.js` (mock BOTH the repo and `buildPayroll` — the pack's only logic is per-florist grouping):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockHoursList, mockBuildPayroll, mockGetConfig } = vi.hoisted(() => ({
  mockHoursList: vi.fn(), mockBuildPayroll: vi.fn(), mockGetConfig: vi.fn(),
}));
vi.mock('../repos/hoursRepo.js', () => ({ list: mockHoursList }));
vi.mock('../services/floristHoursService.js', () => ({ buildPayroll: mockBuildPayroll }));
vi.mock('../services/configService.js', () => ({ getConfig: mockGetConfig }));
import { hoursSummaryHandler } from '../services/assistantTools/hoursPack.js';
beforeEach(() => vi.clearAllMocks());

describe('hoursPack.hours_summary', () => {
  it('groups buildPayroll days per florist + passes totals through', async () => {
    mockGetConfig.mockReturnValue({ Anna: 30 });
    mockHoursList.mockResolvedValueOnce([{ Name: 'Anna' }, { Name: 'Bob' }]); // opaque — buildPayroll is mocked
    mockBuildPayroll.mockReturnValue({
      days: [
        { name: 'Anna', hours: 8, earnings: 240, deliveryCount: 2 },
        { name: 'Anna', hours: 4, earnings: 130, deliveryCount: 0 },
        { name: 'Bob', hours: 6, earnings: 145, deliveryCount: 1 },
      ],
      totals: { hours: 18, earnings: 515, deliveries: 3, days: 3 },
    });
    const r = await hoursSummaryHandler({ from: '2026-05-01', to: '2026-05-31' });
    const anna = r.florists.find(f => f.name === 'Anna');
    const bob = r.florists.find(f => f.name === 'Bob');
    expect(anna).toMatchObject({ hours: 12, earnings: 370, deliveries: 2, days: 2 });
    expect(bob).toMatchObject({ hours: 6, earnings: 145, deliveries: 1, days: 1 });
    expect(r.totals).toMatchObject({ hours: 18, earnings: 515 });
    expect(mockHoursList).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31', name: undefined });
    expect(mockBuildPayroll).toHaveBeenCalledWith([{ Name: 'Anna' }, { Name: 'Bob' }], { Anna: 30 });
  });
});
```

- [ ] **Step 2: Run the three test files — expect FAIL (packs not created)**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.deliveriesPack.test.js src/__tests__/assistantTools.purchasingPack.test.js src/__tests__/assistantTools.hoursPack.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create `deliveriesPack.js`**

```js
// Ask Blossom — deliveries tool pack.
// delivery_status: operational view over the deliveries TABLE (orderRepo.listDeliveries) —
// counts by status + by driver over a date range, plus a capped sample. Distinct from
// computeAnalytics.delivery (order-derived pickup/delivery split). Thin adapter, no logic
// beyond aggregation/shaping.
import * as orderRepo from '../../repos/orderRepo.js';

const CAP = 25;

export async function deliveryStatusHandler(input = {}) {
  const { from, to, status, driver, limit } = input;
  const rows = await orderRepo.listDeliveries({ pg: { from, to, status, driver } });
  const byStatus = {};
  const byDriver = {};
  for (const d of rows) {
    const s = d.Status || 'Unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
    const drv = d['Assigned Driver'] || 'Unassigned';
    byDriver[drv] = (byDriver[drv] || 0) + 1;
  }
  const cap = Math.min(limit || CAP, CAP);
  const shown = rows.slice(0, cap).map(d => ({
    id: d.id,
    date: d['Delivery Date'],
    time: d['Delivery Time'],
    status: d.Status,
    driver: d['Assigned Driver'],
    recipient: d['Recipient Name'],
    address: d['Delivery Address'],
    fee: d['Delivery Fee'],
    deliveredAt: d['Delivered At'],
  }));
  return {
    period: { from: from || null, to: to || null },
    matchedCount: rows.length,
    byStatus,
    byDriver,
    truncated: rows.length > shown.length,
    shown: shown.length,
    data: shown,
  };
}
```

- [ ] **Step 4: Create `purchasingPack.js`**

```js
// Ask Blossom — purchasing tool pack.
// po_status: PO workflow (stockOrderRepo) — counts by status, open vs complete, sample list.
// purchase_spend: actual flower spend over a range (stockPurchasesRepo) — total zł + by supplier.
// computeAnalytics covers neither the PO workflow nor a plain purchase-spend total.
import * as stockOrderRepo from '../../repos/stockOrderRepo.js';
import * as stockPurchasesRepo from '../../repos/stockPurchasesRepo.js';
import { PO_STATUS } from '../../constants/statuses.js';

const CAP = 25;
const round = (n) => Math.round(n * 100) / 100;

export async function poStatusHandler(input = {}) {
  const { status, limit } = input;
  const pos = await stockOrderRepo.list(status ? { status } : {});
  const byStatus = {};
  let open = 0, complete = 0;
  for (const po of pos) {
    const s = po.Status || 'Unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (s === PO_STATUS.COMPLETE) complete++; else open++;
  }
  const cap = Math.min(limit || CAP, CAP);
  const shown = pos.slice(0, cap).map(po => ({
    id: po['Stock Order ID'] || po.id,
    status: po.Status,
    createdDate: po['Created Date'],
    plannedDate: po['Planned Date'],
    driver: po['Assigned Driver'],
  }));
  return { matchedCount: pos.length, byStatus, open, complete, truncated: pos.length > shown.length, shown: shown.length, data: shown };
}

export async function purchaseSpendHandler(input = {}) {
  const { from, to } = input;
  const rows = await stockPurchasesRepo.list({ from, to });
  let total = 0;
  const bySupplier = {};
  for (const r of rows) {
    const cost = (Number(r['Price Per Unit']) || 0) * (Number(r['Quantity Purchased']) || 0);
    total += cost;
    const sup = r.Supplier || 'Unknown';
    bySupplier[sup] = (bySupplier[sup] || 0) + cost;
  }
  return {
    period: { from: from || null, to: to || null },
    purchaseCount: rows.length,
    totalSpend: round(total),
    bySupplier: Object.fromEntries(Object.entries(bySupplier).map(([k, v]) => [k, round(v)])),
  };
}
```

- [ ] **Step 5: Create `hoursPack.js`**

```js
// Ask Blossom — hours/payroll tool pack.
// hours_summary: hours + earnings per florist over a date range. Thin adapter over
// hoursRepo.list + floristHoursService.buildPayroll (the SAME payroll math the owner
// payroll route uses — never re-derived). computeAnalytics does not cover hours.
import * as hoursRepo from '../../repos/hoursRepo.js';
import { buildPayroll } from '../../services/floristHoursService.js';
import { getConfig } from '../../services/configService.js';

const round = (n) => Math.round(n * 100) / 100;

export async function hoursSummaryHandler(input = {}) {
  const { from, to, name } = input;
  const records = await hoursRepo.list({ dateFrom: from, dateTo: to, name });
  const rates = getConfig('floristRates') || {};
  const { days, totals } = buildPayroll(records, rates);
  const byFlorist = {};
  for (const d of days) {
    const f = byFlorist[d.name] || (byFlorist[d.name] = { name: d.name, hours: 0, earnings: 0, deliveries: 0, days: 0 });
    f.hours += d.hours || 0;
    f.earnings += d.earnings || 0;
    f.deliveries += d.deliveryCount || 0;
    f.days += 1;
  }
  const florists = Object.values(byFlorist).map(f => ({ ...f, hours: round(f.hours), earnings: round(f.earnings) }));
  return {
    period: { from: from || null, to: to || null },
    florists,
    totals: {
      hours: round(totals?.hours || 0),
      earnings: round(totals?.earnings || 0),
      deliveries: totals?.deliveries || 0,
      days: totals?.days || 0,
    },
  };
}
```

- [ ] **Step 6: Register the four tools in `index.js`**

Add imports at the top (alongside the existing pack imports):
```js
import { deliveryStatusHandler } from './deliveriesPack.js';
import { poStatusHandler, purchaseSpendHandler } from './purchasingPack.js';
import { hoursSummaryHandler } from './hoursPack.js';
```

Add these four entries to the `TOOLS` array (after the existing entries, before the derived `TOOL_HANDLERS`/`TOOL_DEFS`):
```js
  {
    name: 'delivery_status',
    description: 'Operational delivery view from the deliveries table: counts by status (Pending / Out for Delivery / Delivered / Cancelled) and by driver over an optional date range, plus a sample list. Use for "how many deliveries", "deliveries by driver", delivery completion. NOT for delivery-vs-pickup revenue (use financial_summary).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
        status: { type: 'string', description: 'Filter to one delivery status (optional)' },
        driver: { type: 'string', description: 'Filter to one driver name (optional)' },
        limit: { type: 'number', description: 'Max sample rows (optional, capped at 25)' },
      },
    },
    handler: deliveryStatusHandler,
  },
  {
    name: 'po_status',
    description: 'Purchase-order workflow status: counts of POs by status (Draft / Sent / Shopping / Reviewing / Evaluating / Complete), open vs complete totals, and a sample list. Use for "how many open purchase orders", PO pipeline questions.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter to one PO status (optional)' },
        limit: { type: 'number', description: 'Max sample rows (optional, capped at 25)' },
      },
    },
    handler: poStatusHandler,
  },
  {
    name: 'purchase_spend',
    description: 'Actual flower purchase spend over a date range (recorded supplier purchases): total in złoty and a by-supplier breakdown. Use for "how much did I spend on flowers in May", supplier spend.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
    handler: purchaseSpendHandler,
  },
  {
    name: 'hours_summary',
    description: 'Florist hours + payroll over a date range: hours, earnings (złoty), and delivery counts per florist plus grand totals. Use for "how many hours did each florist work", payroll / labor-cost questions.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
        name: { type: 'string', description: 'Filter to one florist name (optional)' },
      },
      required: ['from', 'to'],
    },
    handler: hoursSummaryHandler,
  },
```

- [ ] **Step 7: Run the three test files — expect PASS**

Run: `cd backend && npx vitest run src/__tests__/assistantTools.deliveriesPack.test.js src/__tests__/assistantTools.purchasingPack.test.js src/__tests__/assistantTools.hoursPack.test.js`
Expected: PASS (3 + 2 + 1 = 6 tests).

- [ ] **Step 8: Sanity-run the full assistant test set (registration didn't break the loop)**

Run: `cd backend && npx vitest run src/__tests__/assistantService.test.js src/__tests__/assistant.route.test.js`
Expected: PASS (the agent loop + routes still green with 4 more registered tools).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/assistantTools/deliveriesPack.js backend/src/services/assistantTools/purchasingPack.js backend/src/services/assistantTools/hoursPack.js backend/src/services/assistantTools/index.js backend/src/__tests__/assistantTools.deliveriesPack.test.js backend/src/__tests__/assistantTools.purchasingPack.test.js backend/src/__tests__/assistantTools.hoursPack.test.js
git commit -m "feat(assistant): deliveries, purchasing, and hours tool packs"
```

---

### Task 2: Florist-app mount

**Files:**
- Create: `apps/florist/src/pages/AssistantPage.jsx`
- Modify: `apps/florist/src/App.jsx` (lazy import + owner-only route)
- Modify: `apps/florist/src/components/BottomNav.jsx` (owner-only More-menu entry)
- Modify: `apps/florist/src/translations.js` (add `tabAssistant` + assistant* keys to EN and RU blocks)
- Modify: `apps/florist/tailwind.config.js` + `apps/florist/package.json` (add `@tailwindcss/typography` if absent)

**Interfaces:**
- Consumes: `AskBlossomPanel` from `@flower-studio/shared`; florist `OwnerRoute`, `Layout`, `BottomNav` patterns.
- Produces: `/assistant` owner-only route + a More-menu nav entry in the florist app.

- [ ] **Step 1: Create `AssistantPage.jsx`**

```jsx
import { AskBlossomPanel } from '@flower-studio/shared';
import t from '../translations.js';

// Owner-only assistant page (the owner uses the florist app on her phone). Route
// gating lives in App.jsx (OwnerRoute); this page just hosts the shared panel.
export default function AssistantPage() {
  return (
    <div className="min-h-screen pb-24 px-3 pt-4 dark:bg-dark-bg">
      <div className="max-w-2xl mx-auto h-[calc(100vh-8rem)]">
        <AskBlossomPanel t={t} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in `App.jsx`**

Add a lazy import beside the other page imports:
```js
const AssistantPage = lazy(() => import('./pages/AssistantPage.jsx'));
```
Add a route beside the other `OwnerRoute` pages (e.g. after the `/day-summary` route):
```jsx
        <Route path="/assistant" element={
          <OwnerRoute><Layout><AssistantPage /></Layout></OwnerRoute>
        } />
```

- [ ] **Step 3: Add the owner-only nav entry in `BottomNav.jsx`**

Add `Sparkles` to the existing lucide-react import. Add an entry at the TOP of `ownerOnlyItems`:
```js
  const ownerOnlyItems = [
    { Icon: Sparkles, label: t.tabAssistant, action: () => navigate('/assistant') },
    { Icon: Clock, label: t.floristHours, action: () => navigate('/hours') },
  ];
```
(Keep it in the More menu — the 4-tab primary bar is full. Owner-only because `ownerOnlyItems` is already spread only `...(isOwner ? ownerOnlyItems : [])`.)

- [ ] **Step 4: Add translation keys (EN + RU blocks)**

In `apps/florist/src/translations.js`, in the `en` object near `tabMore` (~line 537) add:
```js
  tabAssistant:           'Assistant',
  assistantPlaceholder:   'Ask about your data…',
  assistantSend:          'Ask',
  assistantThinking:      'Thinking…',
  assistantError:         'Something went wrong. Please try again.',
  assistantEmpty:         'Ask a question about your business data',
  assistantHistory:       'Chats',
  assistantNewChat:       '+ New chat',
  assistantNoHistory:     'No saved chats yet',
  assistantUntitled:      'Untitled',
  assistantRename:        'Rename',
  assistantDelete:        'Delete',
  assistantDeleteConfirm: 'Delete?',
```
In the RU object near `tabMore` (~line 1396) add (mirror dashboard's RU assistant values where they exist):
```js
  tabAssistant:           'Помощник',
  assistantPlaceholder:   'Спросите о ваших данных…',
  assistantSend:          'Спросить',
  assistantThinking:      'Думаю…',
  assistantError:         'Что-то пошло не так. Попробуйте снова.',
  assistantEmpty:         'Задайте вопрос о ваших данных',
  assistantHistory:       'Чаты',
  assistantNewChat:       '+ Новый чат',
  assistantNoHistory:     'Пока нет сохранённых чатов',
  assistantUntitled:      'Без названия',
  assistantRename:        'Переименовать',
  assistantDelete:        'Удалить',
  assistantDeleteConfirm: 'Удалить?',
```

- [ ] **Step 5: Ensure `@tailwindcss/typography` for the florist app**

Check `apps/florist/tailwind.config.js` — if `require('@tailwindcss/typography')` is NOT in `plugins`, add it (mirror `apps/dashboard/tailwind.config.js`). Check `apps/florist/package.json` — if `@tailwindcss/typography` is not in `devDependencies`, add it with the SAME version dashboard uses (read `apps/dashboard/package.json`), then run `npm install` from the repo root. (Markdown renders unstyled without it; Vercel builds florist in isolation so it needs its own declaration.)

- [ ] **Step 6: Build the florist app — expect success**

Run: `cd apps/florist && ./node_modules/.bin/vite build`
Expected: succeeds (resolves `AskBlossomPanel`, `Sparkles`, the typography plugin).

- [ ] **Step 7: Build dashboard + delivery too (shared/florist deps unaffected, but confirm no regression)**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build` then `cd ../delivery && ./node_modules/.bin/vite build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add apps/florist/src/pages/AssistantPage.jsx apps/florist/src/App.jsx apps/florist/src/components/BottomNav.jsx apps/florist/src/translations.js apps/florist/tailwind.config.js apps/florist/package.json package-lock.json
git commit -m "feat(assistant): mount Ask Blossom in the florist app (owner-only)"
```

---

## Self-Review (plan author)

- **Coverage:** deliveries (status/driver) ✓, purchasing (PO workflow + purchase spend) ✓, hours (per-florist payroll) ✓, florist mount (owner-only route + nav + i18n) ✓.
- **No-duplication:** each pack's domain confirmed absent from `computeAnalytics` (deliveries table vs order-derived split; POs/hours not wired). ✓
- **Type consistency:** handler names (`deliveryStatusHandler`/`poStatusHandler`/`purchaseSpendHandler`/`hoursSummaryHandler`) match imports in index.js and test imports. Return shapes (`matchedCount`/`byStatus`/`truncated`/`shown`/`data`) mirror existing packs. `buildPayroll`/`getConfig` calls match `routes/floristHours.js`. ✓
- **Dependency trap:** Task 2 Step 5 explicitly guards the florist `@tailwindcss/typography` declaration + the 3-app build (the exact lucide-style trap from CLAUDE.md). ✓
- **Risk note for reviewers:** the hours test mocks `buildPayroll` (the pack's only logic is grouping) — this is intentional, not under-testing; payroll math is canonically tested in `floristHoursService` tests. The florist panel may feel cramped on a phone (shared 2-column rail, w-48) — acceptable for this slice; responsive rail is a follow-up.
