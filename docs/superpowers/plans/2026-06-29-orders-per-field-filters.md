# Orders Per-Field Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner per-field filtering over the Orders tab — per-column `▾` popovers on the dashboard and an equivalent mobile filter drawer on the florist app — driven by one shared filter model.

**Architecture:** A pure, unit-tested `orderFilters` util in `packages/shared` splits filtering into a server-supported subset (mapped to existing `GET /orders` params) and a client-only subset (text contains + price range applied in memory). The dashboard `OrdersTab` migrates its scattered filter state to a single `filter` object and grows per-column popovers; the florist `OrderListPage` reuses the same model behind a `Sheet`-based drawer. No backend changes.

**Tech Stack:** React + hooks, Tailwind, Vitest (`@flower-studio/shared` workspace), existing custom `DatePicker` and shared `Sheet` component.

## Global Constraints

- UI language **Russian** — all visible strings via `t.xxx` from each app's `translations.js`. Comments in English.
- Statuses/payment values come from `backend/src/constants/statuses.js` — never raw strings in new constants; reuse the existing option lists already in each component.
- Tailwind utility classes only — no custom CSS.
- New shared util MUST ship a test file in `packages/shared/test/` (coverage thresholds enforced in CI for `packages/shared/utils/`).
- Prices in PLN, stored/compared as numbers.
- `GET /orders` already supports `status`, `source` (incl. `Other`), `deliveryType`, `paymentStatus`, `paymentMethod` (incl. `Not recorded`), `excludeCancelled`, `dateFrom`/`dateTo` (order date), `requiredByFrom`/`requiredByTo` (fulfilment date). Do **not** add backend params.
- Date display uses the app's existing custom `DatePicker` (day-month-year) — never native `<input type="date">`.
- Run shared tests with: `cd packages/shared && ../../backend/node_modules/.bin/vitest run`.

---

### Task 1: Shared `orderFilters` util + tests

**Files:**
- Create: `packages/shared/utils/orderFilters.js`
- Modify: `packages/shared/index.js` (add re-export block)
- Test: `packages/shared/test/orderFilters.test.js`

**Interfaces:**
- Produces:
  - `EMPTY_ORDER_FILTER` (object, every field present)
  - `clearOrderFilter() → filter`
  - `buildOrderQueryParams(filter) → object` (server params)
  - `orderMatchesClientFilter(order, filter) → boolean`
  - `activeOrderFilterCount(filter) → number`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/orderFilters.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  EMPTY_ORDER_FILTER,
  clearOrderFilter,
  buildOrderQueryParams,
  orderMatchesClientFilter,
  activeOrderFilterCount,
} from '../utils/orderFilters.js';

const order = {
  'App Order ID': 1042,
  'Customer Name': 'Anna Kowalska',
  'Customer Request': 'White peony bouquet',
  'Final Price': 250,
};

describe('buildOrderQueryParams', () => {
  it('returns {} for the empty filter', () => {
    expect(buildOrderQueryParams(EMPTY_ORDER_FILTER)).toEqual({});
  });
  it('maps server fields to GET /orders params', () => {
    const params = buildOrderQueryParams({
      ...EMPTY_ORDER_FILTER,
      status: 'New', source: 'Instagram', deliveryType: 'Delivery',
      paymentStatus: 'Unpaid', paymentMethod: 'Cash', excludeCancelled: true,
      orderDateFrom: '2026-06-01', orderDateTo: '2026-06-30',
      requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20',
    });
    expect(params).toEqual({
      status: 'New', source: 'Instagram', deliveryType: 'Delivery',
      paymentStatus: 'Unpaid', paymentMethod: 'Cash', excludeCancelled: '1',
      dateFrom: '2026-06-01', dateTo: '2026-06-30',
      requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20',
    });
  });
  it('omits client-only fields from query params', () => {
    const params = buildOrderQueryParams({
      ...EMPTY_ORDER_FILTER, customerQuery: 'anna', priceMin: 100,
    });
    expect(params).toEqual({});
  });
});

describe('orderMatchesClientFilter', () => {
  it('passes everything for the empty filter', () => {
    expect(orderMatchesClientFilter(order, EMPTY_ORDER_FILTER)).toBe(true);
  });
  it('matches customer/bouquet/id case-insensitively (contains)', () => {
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, customerQuery: 'KOWAL' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, bouquetQuery: 'peony' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, orderIdQuery: '104' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, customerQuery: 'zzz' })).toBe(false);
  });
  it('applies price min/max inclusively', () => {
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMin: 250 })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMin: 251 })).toBe(false);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMax: 250 })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMax: 249 })).toBe(false);
  });
  it('resolves total from Price Override / Sell Total fallbacks', () => {
    expect(orderMatchesClientFilter({ 'Sell Total': 80 }, { ...EMPTY_ORDER_FILTER, priceMax: 100 })).toBe(true);
    expect(orderMatchesClientFilter({ 'Price Override': 120 }, { ...EMPTY_ORDER_FILTER, priceMin: 100 })).toBe(true);
  });
});

describe('activeOrderFilterCount', () => {
  it('is 0 for the empty filter', () => {
    expect(activeOrderFilterCount(EMPTY_ORDER_FILTER)).toBe(0);
  });
  it('counts each active dimension; a date pair counts once', () => {
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, status: 'New' })).toBe(1);
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20' })).toBe(1);
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, priceMin: 100, priceMax: 200 })).toBe(1);
  });
});

describe('clearOrderFilter', () => {
  it('returns a fresh empty filter copy', () => {
    const c = clearOrderFilter();
    expect(c).toEqual(EMPTY_ORDER_FILTER);
    expect(c).not.toBe(EMPTY_ORDER_FILTER);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/orderFilters.test.js`
Expected: FAIL — `Failed to resolve import "../utils/orderFilters.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/utils/orderFilters.js`:

```js
// Pure functions for filtering the Orders list. Consumed by the dashboard
// OrdersTab (per-column popovers) and the florist OrderListPage (filter
// drawer) — one model, two presentations.
// See docs/superpowers/specs/2026-06-29-orders-per-field-filters-design.md.
//
// Responsibility split:
//   buildOrderQueryParams     → server-supported fields → GET /orders params
//   orderMatchesClientFilter  → client-only fields (text contains, price range)

// Canonical empty filter. Every field present so callers can spread + set one.
export const EMPTY_ORDER_FILTER = {
  // server-side (mapped to GET /orders params)
  status: '',            // single ORDER_STATUS value, or ''
  source: '',            // source name, 'Other', or ''
  deliveryType: '',      // 'Delivery' | 'Pickup' | ''
  paymentStatus: '',     // 'Paid' | 'Unpaid' | 'Partial' | ''
  paymentMethod: '',     // method name, 'Not recorded', or ''
  excludeCancelled: false,
  orderDateFrom: '',     // YYYY-MM-DD (order/submission date)
  orderDateTo: '',
  requiredByFrom: '',    // YYYY-MM-DD (fulfilment date)
  requiredByTo: '',
  // client-side (applied in memory on the fetched set)
  orderIdQuery: '',      // App Order ID — contains
  customerQuery: '',     // Customer Name — contains
  bouquetQuery: '',      // Customer Request — contains
  priceMin: null,        // number | null
  priceMax: null,        // number | null
};

export function clearOrderFilter() {
  return { ...EMPTY_ORDER_FILTER };
}

// Map the server-supported subset to GET /orders query params. Only non-empty
// values are included so the backend's "absent = no constraint" semantics hold.
export function buildOrderQueryParams(filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  const params = {};
  if (f.status) params.status = f.status;
  if (f.source) params.source = f.source;
  if (f.deliveryType) params.deliveryType = f.deliveryType;
  if (f.paymentStatus) params.paymentStatus = f.paymentStatus;
  if (f.paymentMethod) params.paymentMethod = f.paymentMethod;
  if (f.excludeCancelled) params.excludeCancelled = '1';
  if (f.orderDateFrom) params.dateFrom = f.orderDateFrom;
  if (f.orderDateTo) params.dateTo = f.orderDateTo;
  if (f.requiredByFrom) params.requiredByFrom = f.requiredByFrom;
  if (f.requiredByTo) params.requiredByTo = f.requiredByTo;
  return params;
}

// Order total — mirrors the row price resolution in OrdersTab.jsx:
// Final Price ‖ Price Override ‖ Sell Total.
function orderTotal(order) {
  return Number(order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0);
}

function contains(haystack, needle) {
  if (!needle) return true;
  const h = haystack == null ? '' : String(haystack);
  return h.toLowerCase().includes(String(needle).toLowerCase());
}

// Predicate for the CLIENT-only fields. Server fields are already applied by
// the fetch query, so this only checks columns the backend can't filter.
export function orderMatchesClientFilter(order, filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  if (!contains(order['App Order ID'], f.orderIdQuery)) return false;
  if (!contains(order['Customer Name'], f.customerQuery)) return false;
  if (!contains(order['Customer Request'], f.bouquetQuery)) return false;
  if (f.priceMin != null || f.priceMax != null) {
    const total = orderTotal(order);
    if (f.priceMin != null && total < f.priceMin) return false;
    if (f.priceMax != null && total > f.priceMax) return false;
  }
  return true;
}

// Count active (non-default) filter dimensions — drives the "Фильтры (n)"
// badge and whether the reset-all affordance shows. A from/to date pair or a
// min/max price pair each count as one dimension.
export function activeOrderFilterCount(filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  let n = 0;
  if (f.status) n++;
  if (f.source) n++;
  if (f.deliveryType) n++;
  if (f.paymentStatus) n++;
  if (f.paymentMethod) n++;
  if (f.excludeCancelled) n++;
  if (f.orderDateFrom || f.orderDateTo) n++;
  if (f.requiredByFrom || f.requiredByTo) n++;
  if (f.orderIdQuery) n++;
  if (f.customerQuery) n++;
  if (f.bouquetQuery) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  return n;
}
```

- [ ] **Step 4: Add the re-export**

In `packages/shared/index.js`, after the `customerFilters` export block, add:

```js
export {
  EMPTY_ORDER_FILTER,
  clearOrderFilter,
  buildOrderQueryParams,
  orderMatchesClientFilter,
  activeOrderFilterCount,
} from './utils/orderFilters.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/orderFilters.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/utils/orderFilters.js packages/shared/test/orderFilters.test.js packages/shared/index.js
git commit -m "feat(shared): orderFilters util — server param mapping + client predicate + active count"
```

---

### Task 2: Dashboard — migrate OrdersTab to a single filter object (behaviour-preserving)

Refactor only: replace the scattered filter `useState`s with one `filter` object and route the fetch through `buildOrderQueryParams` + `orderMatchesClientFilter`. No new UI yet. Every filter reachable today (status pills, date range, unpaid/paid toggles, cross-tab source/deliveryType/paymentMethod/excludeCancelled, search) must keep working.

**Files:**
- Modify: `apps/dashboard/src/components/OrdersTab.jsx`

**Interfaces:**
- Consumes (Task 1): `EMPTY_ORDER_FILTER`, `buildOrderQueryParams`, `orderMatchesClientFilter`, `activeOrderFilterCount`, `clearOrderFilter`.
- Produces: a `filter` state object + `setFilterField(key, value)` helper used by Task 4.

- [ ] **Step 1: Import the shared util**

At the top of `OrdersTab.jsx` add:

```js
import {
  EMPTY_ORDER_FILTER, buildOrderQueryParams, orderMatchesClientFilter,
  activeOrderFilterCount, clearOrderFilter,
} from '@flower-studio/shared';
```

- [ ] **Step 2: Seed the filter from `initialFilter`**

Replace the individual filter `useState` declarations (`statusFilter`, `dateFrom`, `dateTo`, `unpaidOnly`, `paidOnly`, `deliveryTypeFilter`, `sourceFilter`, `paymentMethodFilter`, `excludeCancelled`) with one object seeded from the incoming cross-tab `initialFilter` (`f`). Keep `search`, `upcomingMode`, `noDateOnly`, `focusOrderId`, `expandedId`, `selected`, `sortBy`, `sortDir`, `showPremade` exactly as they are.

```js
const [filter, setFilter] = useState(() => ({
  ...EMPTY_ORDER_FILTER,
  status: f.status || '',
  source: f.source || '',
  deliveryType: f.deliveryType || '',
  paymentStatus: f.payment || '',            // legacy cross-tab key was `payment`
  paymentMethod: f.paymentMethod || '',
  excludeCancelled: !!f.excludeCancelled,
  requiredByFrom: f.dateFrom || monthStart(), // current default range = fulfilment date
  requiredByTo: f.dateTo || todayStr(),
}));
const setFilterField = (key, value) => setFilter(prev => ({ ...prev, [key]: value }));
```

Note: the pre-refactor code defaulted the date range to `monthStart()`–`todayStr()` and sent it as `requiredByFrom/To`. Preserve that by seeding `requiredByFrom/requiredByTo`. The old `unpaidOnly`/`paidOnly` booleans collapse into `filter.paymentStatus` (`'Unpaid'`/`'Paid'`).

- [ ] **Step 3: Route the fetch through the shared param builder**

In `fetchOrders`, replace the hand-built `params` block with:

```js
const params = upcomingMode ? { upcoming: '1' } : buildOrderQueryParams(filter);
```

Remove the now-dead per-field `if (statusFilter) ...` lines. Update the `useCallback` dependency array to `[filter, upcomingMode, showToast]`.

- [ ] **Step 4: Recompute `fetchKey` from the filter**

Replace the `fetchKey` object with:

```js
const fetchKey = JSON.stringify({ filter, upcomingMode });
```

- [ ] **Step 5: Apply the client predicate + replace the inline search**

Replace the `let filtered = search ? orders.filter(...) : orders;` block with a single pass that applies both the client predicate and the (still client-side) free-text search box:

```js
let filtered = orders.filter(o => orderMatchesClientFilter(o, filter));
if (search) {
  const q = search.toLowerCase();
  filtered = filtered.filter(o =>
    (o['Customer Name'] || '').toLowerCase().includes(q) ||
    (o['Customer Request'] || '').toLowerCase().includes(q));
}
```

Keep the `noDateOnly` and `focusOrderId` filters that follow, unchanged. Update the `unpaidOnly`-dependent sort/age UI to read `filter.paymentStatus === 'Unpaid'` (define `const unpaidOnly = filter.paymentStatus === 'Unpaid';` near the top of the render so the existing JSX referencing `unpaidOnly` keeps working).

- [ ] **Step 6: Point the existing controls at the filter object**

- Status pills `onClick`: `setFilterField('status', opt.value)`, active check `filter.status === opt.value`.
- The two date inputs (still native for now): `value={filter.requiredByFrom}` / `onChange={e => setFilterField('requiredByFrom', e.target.value)}` and the `...To` equivalent.
- Unpaid toggle: `onClick={() => setFilterField('paymentStatus', filter.paymentStatus === 'Unpaid' ? '' : 'Unpaid')}`.
- Active-filter chips + reset: drive the chip row off `filter` fields and make Reset call `setFilter(clearOrderFilter())` (preserve `search`/`noDateOnly` reset as today by also clearing those states).

- [ ] **Step 7: Build to verify no breakage**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds, no unresolved imports or undefined identifiers.

- [ ] **Step 8: Manual smoke (describe in commit, run with `npm run dashboard` + `npm run backend`)**

Verify: status pills filter; date range filters by fulfilment date; unpaid toggle works; cross-tab navigation from Today/Financial still pre-filters; reset clears. No console errors.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/OrdersTab.jsx
git commit -m "refactor(dashboard): OrdersTab filter state → shared orderFilters model (no behaviour change)"
```

---

### Task 3: Dashboard — reusable `ColumnFilterPopover` component

A generic header-anchored popover: a `▾` trigger that highlights when active, opening a small click-outside-dismiss panel hosting arbitrary control content.

**Files:**
- Create: `apps/dashboard/src/components/order/ColumnFilterPopover.jsx`

**Interfaces:**
- Produces: `<ColumnFilterPopover active title>{children}</ColumnFilterPopover>` — `active` (bool) tints the trigger; `title` (string) labels the panel header; `children` are the control(s).

- [ ] **Step 1: Implement the component**

Mirror the click-outside pattern already used in `DatePicker.jsx` (mousedown listener on `document`, ref guard).

```jsx
import { useState, useRef, useEffect } from 'react';

// Header-anchored filter popover. The column passes its own control(s) as
// children; this shell owns only open/close + the active-state affordance.
export default function ColumnFilterPopover({ active, title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`ml-0.5 text-[10px] leading-none px-0.5 rounded transition-colors ${
          active ? 'text-brand-600' : 'text-ios-tertiary hover:text-ios-secondary'
        }`}
        title={title}
      >
        ▾{active ? <span className="ml-0.5 inline-block w-1 h-1 rounded-full bg-brand-600 align-middle" /> : null}
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-30 min-w-[180px] bg-white rounded-xl shadow-2xl border border-gray-200 p-3 space-y-2">
          {title && <p className="text-[11px] font-semibold text-ios-tertiary uppercase tracking-wide">{title}</p>}
          {children}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds (component unused so far — no behaviour change).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/order/ColumnFilterPopover.jsx
git commit -m "feat(dashboard): ColumnFilterPopover — generic header filter popover shell"
```

---

### Task 4: Dashboard — per-column filters + split Fulfilment into Type | Date

Wire `ColumnFilterPopover` into each column header, split the Fulfilment cell into a **Type** column and a **Fulfilment date** column (header + body row), and swap the native date inputs for the custom `DatePicker` (day-month-year). Bundle Payment status / Payment method / Source into the Status column popover.

**Files:**
- Modify: `apps/dashboard/src/components/OrdersTab.jsx`
- Modify: `apps/dashboard/src/components/DatePicker.jsx` usage (import only)
- Modify: `apps/dashboard/CLAUDE.md` (note the new filter system)

**Interfaces:**
- Consumes (Task 2): `filter`, `setFilterField`, `activeOrderFilterCount`. (Task 3): `ColumnFilterPopover`. Existing `getStatusOptions()`, source/payment option lists used by cross-tab filters.

- [ ] **Step 1: Import the pieces**

```js
import DatePicker from './DatePicker.jsx';
import ColumnFilterPopover from './order/ColumnFilterPopover.jsx';
```

- [ ] **Step 2: Replace the inline date inputs with a labelled DatePicker range**

In the filters bar, replace the two native `<input type="date">` (the `!upcomingMode && (...)` block) with two `DatePicker`s bound to `filter.requiredByFrom`/`requiredByTo`, e.g.:

```jsx
{!upcomingMode && (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] text-ios-tertiary">{t.byFulfilmentDate}</span>
    <DatePicker value={filter.requiredByFrom} onChange={v => setFilterField('requiredByFrom', v)} placeholder={t.dateFrom} />
    <span className="text-xs text-ios-tertiary">—</span>
    <DatePicker value={filter.requiredByTo} onChange={v => setFilterField('requiredByTo', v)} placeholder={t.dateTo} />
  </div>
)}
```

Add to `apps/dashboard/src/translations.js` (Russian section): `byFulfilmentDate: 'Дата выдачи'`, `byOrderDate: 'Дата заказа'`, `dateFrom: 'С'`, `dateTo: 'По'`, `filterPrice: 'Сумма'`, `filterMin: 'мин'`, `filterMax: 'макс'`, `colType: 'Тип'`, plus any new column-popover labels referenced below (`filterPaymentMethod`, `filterSource`, `filterDeliveryType`). Reuse existing keys where present (`t.source`, `t.paymentStatus`, `t.paymentMethod`, `t.labelStatus`, `t.deliveryType`).

- [ ] **Step 3: Add the column-header filter affordances**

In the column-header row (the `flex items-center gap-4 ... uppercase` block), append a `ColumnFilterPopover` after each relevant label. Examples:

```jsx
<span className="w-10 shrink-0 flex items-center">
  {t.colOrderId || '#'}
  <ColumnFilterPopover active={!!filter.orderIdQuery} title={t.colOrderId || '#'}>
    <input className="field-input w-full text-xs" value={filter.orderIdQuery}
      onChange={e => setFilterField('orderIdQuery', e.target.value)} placeholder="#" />
  </ColumnFilterPopover>
</span>
```

Repeat the pattern per column:
- **Order date** → two `DatePicker`s bound to `filter.orderDateFrom`/`orderDateTo` (active when either set).
- **Customer** → text → `filter.customerQuery`.
- **Bouquet** → text → `filter.bouquetQuery`.
- **Status** (bundled) → Status `<select>` (from `getStatusOptions()`) bound to `filter.status`; Payment-status segmented buttons (`''`/`Paid`/`Unpaid`/`Partial`) bound to `filter.paymentStatus`; Payment-method `<select>` → `filter.paymentMethod`; Source `<select>` → `filter.source`. Active when any of those four are set.
- **Type** (new column) → segmented `''`/`Delivery`/`Pickup` → `filter.deliveryType`.
- **Fulfilment date** (new column) → two `DatePicker`s → `filter.requiredByFrom`/`requiredByTo`.
- **Total** → two number inputs → `filter.priceMin`/`priceMax` (parse with `Number(e.target.value) || null`).

For Status' payment-method and source option lists, reuse whatever option source the existing cross-tab filters already rely on; if none is loaded in this component, render the value as a free-text `<select>` seeded from the distinct values present in `orders` (`[...new Set(orders.map(o => o['Payment Method']).filter(Boolean))]`).

- [ ] **Step 4: Split the Fulfilment column in the header AND the body row**

Header: replace the single `{t.colFulfillment ...}` span with two spans — `{t.colType || 'Тип'}` (width `w-12`) and `{t.colFulfillment || 'Выдача'}` (width `w-24`), each with its `ColumnFilterPopover`.

Body row (the `Fulfilment — icon + due date` block, ~lines 576–592): split into two aligned cells:

```jsx
{/* Type */}
<span className="text-xs shrink-0 w-12">{order['Delivery Type'] === 'Delivery' ? '🚗' : '🏪'}</span>
{/* Fulfilment date */}
<span className="text-xs shrink-0 w-24 text-ios-tertiary">
  {(() => {
    const dueDate = order['Delivery Date'] || order['Required By'];
    const dueTime = order['Delivery Time'];
    if (!dueDate && !dueTime) return '—';
    return `${fmtDate(dueDate) || ''}${dueTime ? ` · ${dueTime}` : ''}`;
  })()}
</span>
```

Keep the margin dot, price, age, and chevron cells unchanged. Verify the header widths still line up with the body cells (adjust the `w-*` classes together if needed — header and body must use matching widths).

- [ ] **Step 5: Extend the active-filter chip row + reset to all fields**

Drive the existing chip row off `filter` (one chip per active dimension, each `×` calls `setFilterField(key, defaultValue)`), and gate the whole row on `activeOrderFilterCount(filter) > 0 || search || noDateOnly`. Reset-all calls `setFilter(clearOrderFilter())` and also clears `search`/`noDateOnly`.

- [ ] **Step 6: Build**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds.

- [ ] **Step 7: Manual smoke (`npm run dashboard` + `npm run backend`)**

Verify each column `▾` opens, filters, and highlights when active; Type/Date columns align with rows; dates show day-month-year; Status popover filters by status + payment status + method + source; reset clears everything.

- [ ] **Step 8: Update dashboard CLAUDE.md**

In `apps/dashboard/CLAUDE.md`, under Key Components add `ColumnFilterPopover.jsx` and note OrdersTab now has per-column filters driven by shared `orderFilters`.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/OrdersTab.jsx apps/dashboard/src/components/order/ColumnFilterPopover.jsx apps/dashboard/src/translations.js apps/dashboard/CLAUDE.md
git commit -m "feat(dashboard): per-column Orders filters + split Type/Fulfilment columns + day-month-year dates"
```

---

### Task 5: Florist — `OrderFilterDrawer` + integrate into OrderListPage

Add a mobile filter drawer (shared `Sheet`) exposing the same filter model, and apply it to the florist order list. Keep the active/completed view tabs and status sub-filters working; fold them into the shared `filter` object.

**Files:**
- Create: `apps/florist/src/components/OrderFilterDrawer.jsx`
- Modify: `apps/florist/src/pages/OrderListPage.jsx`
- Modify: `apps/florist/src/translations.js`
- Modify: `apps/florist/CLAUDE.md`
- Modify: root `CLAUDE.md` (parity table)

**Interfaces:**
- Consumes (Task 1): `EMPTY_ORDER_FILTER`, `buildOrderQueryParams`, `orderMatchesClientFilter`, `activeOrderFilterCount`, `clearOrderFilter`; shared `Sheet`; florist `DatePicker`.

- [ ] **Step 1: Build the drawer component**

```jsx
import { Sheet } from '@flower-studio/shared';   // re-exported at packages/shared/index.js
import DatePicker from './DatePicker.jsx';
import t from '../translations.js';

// Mobile filter drawer for the order list. Edits a draft copy of the shared
// order-filter object and applies it on "Apply". Mirrors the dashboard
// OrdersTab per-column filters in a single stacked sheet.
export default function OrderFilterDrawer({ open, onClose, filter, onApply, onReset }) {
  // Local draft so cancelling discards edits.
  const set = (key, value) => onApply({ ...filter, [key]: value }, { keepOpen: true });
  return (
    <Sheet open={open} onClose={onClose} title={t.filters} t={t}>
      <div className="px-4 pb-4 space-y-3">
        <input className="field-input w-full" placeholder={t.customer}
          value={filter.customerQuery} onChange={e => set('customerQuery', e.target.value)} />
        <input className="field-input w-full" placeholder={t.bouquetComposition || 'Букет'}
          value={filter.bouquetQuery} onChange={e => set('bouquetQuery', e.target.value)} />
        {/* Delivery type segmented */}
        <div className="flex gap-1.5">
          {['', 'Delivery', 'Pickup'].map(v => (
            <button key={v || 'all'} onClick={() => set('deliveryType', v)}
              className={`px-3 h-8 rounded-full text-xs font-medium ${filter.deliveryType === v ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary'}`}>
              {v === '' ? t.all : v === 'Delivery' ? t.deliveryType : t.pickup}
            </button>
          ))}
        </div>
        {/* Fulfilment date range */}
        <div className="flex items-center gap-1.5">
          <DatePicker value={filter.requiredByFrom} onChange={v => set('requiredByFrom', v)} placeholder={t.dateFrom} />
          <span className="text-xs text-ios-tertiary">—</span>
          <DatePicker value={filter.requiredByTo} onChange={v => set('requiredByTo', v)} placeholder={t.dateTo} />
        </div>
        {/* Price range */}
        <div className="flex items-center gap-1.5">
          <input type="number" className="field-input w-24" placeholder={t.filterMin}
            value={filter.priceMin ?? ''} onChange={e => set('priceMin', Number(e.target.value) || null)} />
          <span className="text-xs text-ios-tertiary">—</span>
          <input type="number" className="field-input w-24" placeholder={t.filterMax}
            value={filter.priceMax ?? ''} onChange={e => set('priceMax', Number(e.target.value) || null)} />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onReset} className="flex-1 h-10 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium">{t.resetFilters || t.clearAll}</button>
          <button onClick={onClose} className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-medium">{t.apply || 'OK'}</button>
        </div>
      </div>
    </Sheet>
  );
}
```

Add the referenced keys to `apps/florist/src/translations.js` if missing: `filters: 'Фильтры'`, `dateFrom: 'С'`, `dateTo: 'По'`, `filterMin: 'мин'`, `filterMax: 'макс'`, `pickup: 'Самовывоз'`, `apply: 'Применить'`, `all: 'Все'`. Reuse existing `t.customer`, `t.deliveryType`, `t.resetFilters`/`t.clearAll`, `t.bouquetComposition`.

- [ ] **Step 2: Wire the drawer into OrderListPage**

Add `import OrderFilterDrawer from '../components/OrderFilterDrawer.jsx';` and the shared util import. Introduce:

```js
const [filter, setFilter] = useState(() => ({ ...EMPTY_ORDER_FILTER, status }));
const [filterOpen, setFilterOpen] = useState(false);
```

Keep `viewMode` and the existing status tabs. When a status tab is clicked, also mirror it into the filter: `setFilter(prev => ({ ...prev, status: s }))` (and keep `setStatus(s)` so existing logic is untouched, OR replace `status` reads with `filter.status`). In `fetchOrders`, merge the server params:

```js
const params = { ...buildOrderQueryParams(filter) };
if (viewMode === VIEW_MODES.ACTIVE) params.activeOnly = true;
else { params.completedOnly = true; }
```

(`activeOnly`/`completedOnly` still bound the set; `buildOrderQueryParams` adds status/type/date/etc.) Update the `useCallback` deps to include `filter`.

- [ ] **Step 3: Apply the client predicate to the rendered list**

Where the florist list maps orders to `OrderCard`s, filter first: `orders.filter(o => orderMatchesClientFilter(o, filter))` (apply alongside the existing `noDateOnly` logic).

- [ ] **Step 4: Add the Filters button with active-count badge**

Near the status sub-filter row, add:

```jsx
<button onClick={() => setFilterOpen(true)}
  className="px-3 h-9 rounded-full bg-white border border-ios-separator shadow-sm text-xs font-medium text-ios-secondary flex items-center gap-1">
  {t.filters}{activeOrderFilterCount(filter) > 0 ? ` (${activeOrderFilterCount(filter)})` : ''}
</button>
<OrderFilterDrawer open={filterOpen} onClose={() => setFilterOpen(false)}
  filter={filter}
  onApply={(next) => setFilter(next)}
  onReset={() => setFilter({ ...clearOrderFilter(), status: filter.status })} />
```

- [ ] **Step 5: Build the florist app**

Run: `cd apps/florist && ./node_modules/.bin/vite build`
Expected: build succeeds.

- [ ] **Step 6: Update parity docs**

- Root `CLAUDE.md` parity table: add a row — **Order filtering**: `OrdersTab.jsx` (dashboard, per-column popovers) ↔ `OrderListPage.jsx` + `OrderFilterDrawer.jsx` (florist, drawer); shared `orderFilters` util.
- `apps/florist/CLAUDE.md`: add `OrderFilterDrawer.jsx` to Key Components and note the shared model.

- [ ] **Step 7: Commit**

```bash
git add apps/florist/src/components/OrderFilterDrawer.jsx apps/florist/src/pages/OrderListPage.jsx apps/florist/src/translations.js apps/florist/CLAUDE.md CLAUDE.md
git commit -m "feat(florist): order filter drawer mirroring dashboard per-field filters (parity)"
```

---

## Final Verification (pre-PR matrix)

Run all that apply to the diff (per root CLAUDE.md "Pre-PR Verification"):

- [ ] Shared tests: `cd packages/shared && ../../backend/node_modules/.bin/vitest run` — all green (incl. new `orderFilters.test.js`).
- [ ] Build **all three** apps (shared `index.js` changed → reaches every app):
  - `cd apps/dashboard && ./node_modules/.bin/vite build`
  - `cd apps/florist && ./node_modules/.bin/vite build`
  - `cd apps/delivery && ./node_modules/.bin/vite build`
- [ ] No backend change → backend vitest / E2E not required; state this in the PR body (verification gate).
- [ ] Mark the spec done: in `docs/superpowers/specs/2026-06-29-orders-per-field-filters-design.md` change Status to "Implemented".
- [ ] Open PR titled `feat(orders): per-field filtering — dashboard per-column popovers + florist drawer`. Body notes: no backend change, shared-util unit tests + 3 app builds as the verification path.

## Spec Coverage Self-Check

- Ambiguous/mis-formatted date filter → Task 4 (labelled `Дата выдачи` + DatePicker day-month-year). ✓
- Per-column `▾` popovers → Tasks 3 + 4. ✓
- Fulfilment split into Type + Date → Task 4 Step 4. ✓
- Status popover bundles payment status/method/source → Task 4 Step 3. ✓
- No margin filter → not built (out of scope). ✓
- Florist mirror as drawer → Task 5. ✓
- Shared model + tests → Task 1. ✓
- Hybrid server/client filtering → Tasks 1 (split) + 2/5 (fetch wiring). ✓
- Parity docs → Tasks 4 + 5. ✓
- No backend change → honored throughout. ✓
