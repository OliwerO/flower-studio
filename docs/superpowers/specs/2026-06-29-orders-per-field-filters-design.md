# Orders tab — per-field filtering (dashboard + florist)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation plan
**Origin:** Owner found the dashboard Orders date-range filter ambiguous (no label saying it
filters by fulfilment date — the #337 change) and wrongly formatted (native `<input type="date">`
renders in browser-locale month-first order). Scope then expanded: owner wants to filter on **every
field currently displayed in the Orders tab**, each independently accessible.

## Problem

`apps/dashboard/src/components/OrdersTab.jsx` exposes only a fraction of the filtering the backend
already supports, and the controls it does have are unclear:

- The date range (lines ~313–321) is two bare native `<input type="date">` with only a `—` between
  them — no label. After #337 it filters by **fulfilment date** (Delivery Date for deliveries,
  Required By for pickups), not order/submission date, but nothing says so. Native inputs also render
  in the browser's locale format (month-first), which is the "wrong format" the owner reported.
- Several server-supported filters (`source`, `deliveryType`, `paymentMethod`, full `paymentStatus`
  incl. Partial) are only reachable via cross-tab navigation, never as direct controls.
- No way to filter by order #, customer, bouquet text, or total price from the table itself.

The backend `GET /orders` (`backend/src/routes/orders.js`) **already** accepts: `status`, `source`
(incl. `Other`), `deliveryType`, `paymentStatus`, `paymentMethod` (incl. `Not recorded`),
`excludeCancelled`, order-date range (`dateFrom`/`dateTo`), fulfilment-date range
(`requiredByFrom`/`requiredByTo`), plus `upcoming`/`forDate`/`activeOnly`/`completedOnly`. **No
backend change is required.**

## Goal

Give the owner per-field filtering over the Orders tab, surfaced as a familiar data-grid pattern on
the dashboard and an equivalent mobile drawer on the florist app, sharing one filter model.

## Decisions (settled with owner)

1. **Pattern:** per-column header `▾` → small popover with that column's control (dashboard).
2. **Fulfilment splits into two columns:** **Type** (🚗/🏪) and **Date** — each independently
   filterable. Resolves the original date ambiguity (the Date column is explicitly labelled).
3. **Status column popover bundles** the payment/source family: Status select + Payment status
   (Все / Оплачен / Не оплачен / Частично) + Payment method + Source.
4. **No margin filter** — the margin dot stays purely visual.
5. **Mirror to florist** — `OrderListPage.jsx` gets an equivalent **filter drawer** (bottom sheet),
   not a per-column grid (won't fit 375px). Shares the filter model.
6. **Date display** uses the existing custom `DatePicker` (day-month-year), never native inputs.
7. **No** per-column sorting (keep existing sort dropdown), **no** saved presets, **no** new
   endpoints. YAGNI.

## Architecture

### Shared core — `packages/shared/utils/orderFilters.js` (+ test, mandatory)

One pure, testable filter model consumed by both apps. Presentation differs per app; logic does not.

```
emptyOrderFilter()              → canonical filter object with every field (nullable/empty defaults)
buildOrderQueryParams(filter)   → { ...GET /orders params } for the SERVER-supported subset:
                                   status, source, deliveryType, paymentStatus, paymentMethod,
                                   excludeCancelled, dateFrom/dateTo (order date),
                                   requiredByFrom/requiredByTo (fulfilment date)
orderMatchesClientFilter(o, f)  → boolean predicate for CLIENT-only fields:
                                   order # (contains), customer name (contains),
                                   bouquet/request (contains), total price min/max
activeFilterCount(filter)       → number, for the florist "Фильтры (n)" badge + chip rendering
clearOrderFilter()              → reset to empty
```

Field → handling split:

| Field             | Where        | Param / predicate |
|-------------------|--------------|-------------------|
| Status            | server       | `status` |
| Payment status    | server       | `paymentStatus` (Paid/Unpaid/Partial) |
| Payment method    | server       | `paymentMethod` (incl. `Not recorded`) |
| Source            | server       | `source` (incl. `Other`) |
| Delivery type     | server       | `deliveryType` |
| Order date range  | server       | `dateFrom` / `dateTo` |
| Fulfilment date   | server       | `requiredByFrom` / `requiredByTo` |
| Exclude cancelled | server       | `excludeCancelled` |
| Order #           | client       | `App Order ID` contains |
| Customer          | client       | `Customer Name` contains |
| Bouquet / request | client       | `Customer Request` contains |
| Total price       | client       | min/max of `Final Price` ‖ `Price Override` ‖ `Sell Total` |

**Filtering model — hybrid.** The server filters the fetched set by the supported fields; the client
narrows that set by #/customer/bouquet/price. The two **date ranges are the scope controls** — the
total-price (and other client) filters only narrow *within the already-fetched date window*; to
search wider, widen the date range. Default view stays "upcoming" (today + future). This is the same
shape the table already uses (it does client-side `search` / `noDateOnly` / `focusOrderId` filtering
on top of a server fetch), so no architectural change — `orderMatchesClientFilter` simply replaces
the ad-hoc inline `search` predicate.

### Dashboard — `apps/dashboard/src/components/OrdersTab.jsx`

- **Column layout** (header row + card-row body, keeping the existing flex-cell alignment):
  `☐ · # · Order date · Customer · Bouquet · Status · Type · Fulfilment date · ·(margin dot) · Total · (Age when unpaid) · chevron`.
  The current single **Fulfilment** cell (icon + due date) splits into a **Type** cell (icon) and a
  **Fulfilment date** cell.
- **New component `apps/dashboard/src/components/order/ColumnFilterPopover.jsx`** — a small
  click-outside-dismiss popover anchored to a header `▾`. Generic shell; each column passes its own
  body (text input / DatePicker range / segmented control / select / number range). Reuses the
  dashboard `DatePicker`.
- **Per-column controls:**
  - `#` → text (contains)
  - `Order date` → DatePicker range
  - `Customer` → text
  - `Bouquet` → text
  - `Status` → bundled: Status select · Payment status segmented · Payment method select · Source select
  - `Type` → segmented Все / Доставка / Самовывоз
  - `Fulfilment date` → DatePicker range
  - `Total` → min / max number inputs
- **Affordance:** a column with an active filter highlights its `▾` (brand colour + dot). The
  existing active-filter chip row and **Reset-all** button extend to every field (driven by
  `activeFilterCount` / `clearOrderFilter`).
- State migrates from the current scattered `useState`s to a single `filter` object (+ setter
  helpers). `upcomingMode` stays as a quick preset; setting an order-date range turns it off (current
  behaviour preserved). `fetchKey` derives from the filter object.

### Florist — `apps/florist/src/pages/OrderListPage.jsx`

- A **"Фильтры (n)" button** opens a bottom-sheet drawer (new
  `apps/florist/src/components/OrderFilterDrawer.jsx`) with the same fields stacked vertically,
  reusing the shared model and the florist `DatePicker`. `n` = `activeFilterCount`.
- The existing active/completed **view tabs** and **status sub-filters** and the single completed-view
  date fold into the shared `filter` object (status → `filter.status`, the completed-view single date
  → the **fulfilment-date** range with `from == to`, consistent with the dashboard's post-#337 date
  meaning). No behaviour regression: active/completed view
  remains the top-level switch; the drawer adds the rest.

### Backend

None. All server params already exist and are exercised by the existing E2E/orderRepo tests.

## Testing

- `packages/shared/test/orderFilters.test.js` — unit tests for `buildOrderQueryParams`,
  `orderMatchesClientFilter`, `activeFilterCount`, `emptyOrderFilter`/`clearOrderFilter` (mandated
  for new shared utils; coverage thresholds apply).
- Build **all three** apps locally (shared change reaches every app via re-exports; florist +
  dashboard both touched).
- No new backend endpoint → no new E2E section required; note this in the PR per the verification
  gate.

## Parity / docs

- Root `CLAUDE.md` parity table: add **Order filtering** — `OrdersTab.jsx` (dashboard, per-column
  popovers) ↔ `OrderListPage.jsx` + `OrderFilterDrawer.jsx` (florist, drawer), shared
  `orderFilters` util.
- `apps/dashboard/CLAUDE.md` and `apps/florist/CLAUDE.md`: note the new components and the
  shared-model relationship.

## Out of scope (explicit)

Margin filter · per-column sorting · saved/named filter presets · new server-side price param ·
infinite scroll / pagination changes · any Y-model / stock work.
