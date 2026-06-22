# Trace Under Shortfall + Pending Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a row in the Shortfalls or Pending-Arrivals card expands to the full per-Variety usage trace (`VarietyTracePanel`), in both the florist and dashboard apps.

**Architecture:** This is a **UI-only extension of PRD #324 T5** (the per-Variety trace read-surface that already landed). The backend endpoint `GET /stock/varieties/:key/usage` and the `VarietyTracePanel` presenter already exist and are tested. This slice (a) extracts the row-expand open/fetch/cache state into one shared hook, (b) replaces `ShortfallSummary`'s existing *orders-only* mini-trace with the full `VarietyTracePanel`, (c) adds the same expand to `PendingArrivalsPanel` (today it has none), (d) wires both hosts to pass a Variety-key fetcher, and (e) optionally ports the balance sparkline from the stranded `dbea7b6`. No schema, no new route, no integration.

**Tech Stack:** React (functional + hooks), Tailwind, Vitest + @testing-library/react, npm workspaces (`@flower-studio/shared`).

## Global Constraints

- **Flag-gated:** Everything renders only under `STOCK_Y_MODEL=true` paths. The cards (`ShortfallSummary`/`PendingArrivalsPanel`/`VarietyTracePanel`) are already mounted only behind the flag in both hosts — do NOT add new flag checks, just don't introduce any flag-off code path. Never touch legacy/flag-off rendering.
- **Cross-app parity (root CLAUDE.md):** Every card/trace change ships in BOTH `apps/florist/src/pages/StockPanelPage.jsx` AND `apps/dashboard/src/components/StockTab.jsx`, lock-step. Shared logic lives in `packages/shared`.
- **Pitfall #8 holds:** Never inline `qty - committed`; `getEffectiveStock(qty)` returns `qty`. This slice does no stock math — it only reads trace events — but do not introduce any availability arithmetic.
- **New shared hook needs a test:** `packages/shared/hooks/` additions require a test in `packages/shared/test/`; CI enforces 80% line coverage on `utils/` and `hooks/`.
- **Reuse, don't rebuild:** The endpoint (`/stock/varieties/:key/usage`) and presenter (`VarietyTracePanel`) already exist. Do not add a second trace endpoint, a second presenter, or a per-`stockId` fetch path. One endpoint, one presenter, one hook.
- **Pre-PR matrix:** shared changed → `cd packages/shared && ../../backend/node_modules/.bin/vitest run` + build ALL THREE apps (`apps/florist`, `apps/dashboard`, `apps/delivery`) with `./node_modules/.bin/vite build`. No backend tests needed (no backend change).
- **Russian UI strings via `t.xxx`.** Any new key lands in en + ru in every app's `translations.js` (NO `pl` block exists in these apps).

## OPEN DECISION (confirm with owner during review — recommended default baked in)

**Shortfall expand granularity.** Today `ShortfallSummary` rows expand to a list of *driving orders only* (`trail.filter(e => e.type === 'order')`), scoped to the single Demand-Entry `stockId`. This slice replaces that with the full `VarietyTracePanel` (orders + purchases + writeoffs + premades + drift footer), scoped to the whole **Variety** (all batches + DEs, all dates).

- **Recommended default (this plan):** full `VarietyTracePanel`. Rationale: it is the canonical "where did stems go / come from" surface, already built and tested; it matches the stock-list-row trace; it answers "why am I short" more completely (incoming purchases + premade locks, not just demand).
- **Trade-off:** loses the date-scoped "orders driving THIS date's shortfall" focus — the panel shows whole-Variety history across all dates.
- **Fallback if owner prefers the focused view:** keep `VarietyTracePanel` but the host can pass already-filtered events; out of scope unless owner asks. The plan implements the recommended default; owner vetoes at PR review.

## File Structure

- **Create** `packages/shared/hooks/useVarietyTraceExpand.js` — owns expand state: which row is open, per-Variety-key trace cache, loading flag, lazy fetch on first open. Deep module: collapses the duplicated `openRow`/`trails`/`loadingId` state machine that would otherwise be copy-pasted into both cards.
- **Create** `packages/shared/test/useVarietyTraceExpand.test.js` — hook unit tests.
- **Modify** `packages/shared/components/ShortfallSummary.jsx` — drop internal `openRow`/`trails`/`loadingId`/`fetchUsage`; consume the hook; render `VarietyTracePanel` on expand keyed by Variety.
- **Modify** `packages/shared/components/PendingArrivalsPanel.jsx` — add a tappable chevron + expand; consume the hook; render `VarietyTracePanel`. Legacy (untyped, `__legacy__|…`) rows stay non-expandable.
- **Modify** `packages/shared/test/ShortfallSummary.test.jsx` + `packages/shared/test/PendingArrivalsPanel.test.jsx` — update/add expand assertions. (If a file does not yet exist, create it.)
- **Modify** `apps/dashboard/src/components/StockTab.jsx` — pass `fetchVarietyUsage` to both cards; remove the old `fetchUsage` stockId fetcher.
- **Modify** `apps/florist/src/pages/StockPanelPage.jsx` — same wiring, parity.
- **(Optional, Task 5)** **Modify** `packages/shared/components/VarietyTracePanel.jsx` — port `BalanceSparkline` (adapt from `dbea7b6` `BatchTracePanel`); add `traceBalance` strings.
- **Modify** `packages/shared/CLAUDE.md` (hook entry), `CHANGELOG.md`, `docs/adr/0008-*.md` (note the new mount surfaces).

---

### Task 1: `useVarietyTraceExpand` shared hook

**Files:**
- Create: `packages/shared/hooks/useVarietyTraceExpand.js`
- Test: `packages/shared/test/useVarietyTraceExpand.test.js`

**Interfaces:**
- Consumes: a host-provided `fetchVarietyUsage(key) => Promise<{ events, unaccountedStems }>` (wraps `GET /stock/varieties/:key/usage`, which returns `{ variety, events, unaccountedStems }`).
- Produces:
  - `openId: string | null` — currently expanded row id.
  - `isOpen(id) => boolean`.
  - `toggle(id, key) => void` — opens row `id`; on first open of Variety `key`, lazy-fetches and caches by `key`. Toggling the open row closes it.
  - `getTrace(key) => { events: array, unaccountedStems: number, loading: boolean, loaded: boolean }` — cache lookup by Variety key (default empty/not-loaded shape when absent).

  Rows are opened by a **row id** (unique per row, e.g. `key@date`) but traces are **cached by Variety key**, so the same Variety short on two dates fetches once.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/shared/test/useVarietyTraceExpand.test.js
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';

const payload = { events: [{ type: 'order', qty: -5, orderId: '#1' }], unaccountedStems: 0 };

describe('useVarietyTraceExpand', () => {
  it('opens a row, lazy-fetches once, caches by variety key, and closes on re-toggle', async () => {
    const fetchVarietyUsage = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useVarietyTraceExpand(fetchVarietyUsage));

    expect(result.current.openId).toBe(null);
    expect(result.current.getTrace('K').loaded).toBe(false);

    // open row "K@2026-06-22" for variety key "K"
    act(() => result.current.toggle('K@2026-06-22', 'K'));
    expect(result.current.isOpen('K@2026-06-22')).toBe(true);
    expect(result.current.getTrace('K').loading).toBe(true);

    await waitFor(() => expect(result.current.getTrace('K').loaded).toBe(true));
    expect(result.current.getTrace('K').events).toHaveLength(1);
    expect(fetchVarietyUsage).toHaveBeenCalledTimes(1);

    // open a SECOND row of the SAME variety key — no refetch (cache hit)
    act(() => result.current.toggle('K@2026-06-25', 'K'));
    expect(result.current.isOpen('K@2026-06-25')).toBe(true);
    expect(fetchVarietyUsage).toHaveBeenCalledTimes(1);

    // re-toggle the open row → closes
    act(() => result.current.toggle('K@2026-06-25', 'K'));
    expect(result.current.openId).toBe(null);
  });

  it('on fetch error leaves a loaded-but-empty trace (graceful, no throw)', async () => {
    const fetchVarietyUsage = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useVarietyTraceExpand(fetchVarietyUsage));
    act(() => result.current.toggle('K@d', 'K'));
    await waitFor(() => expect(result.current.getTrace('K').loaded).toBe(true));
    expect(result.current.getTrace('K').events).toEqual([]);
    expect(result.current.getTrace('K').loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useVarietyTraceExpand.test.js`
Expected: FAIL — `useVarietyTraceExpand` is not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```jsx
// packages/shared/hooks/useVarietyTraceExpand.js
import { useCallback, useState } from 'react';

const EMPTY = { events: [], unaccountedStems: 0, loading: false, loaded: false };

/**
 * useVarietyTraceExpand — expand state for date-grouped stock cards.
 *
 * Opens ONE row at a time (by row id) and lazy-fetches that row's Variety
 * usage trace once per Variety key (cached). Reused by ShortfallSummary and
 * PendingArrivalsPanel so the open/fetch/cache machinery lives in one place.
 *
 * @param fetchVarietyUsage async (key) => { events, unaccountedStems }
 */
export function useVarietyTraceExpand(fetchVarietyUsage) {
  const [openId, setOpenId] = useState(null);
  const [cache, setCache] = useState(() => new Map()); // varietyKey → trace state

  const getTrace = useCallback(
    (key) => cache.get(key) ?? EMPTY,
    [cache],
  );

  const isOpen = useCallback((id) => openId === id, [openId]);

  const toggle = useCallback(
    (id, key) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      // Lazy-fetch this Variety's trace once.
      setCache((prev) => {
        if (prev.has(key)) return prev; // cache hit — no refetch
        const next = new Map(prev);
        next.set(key, { events: [], unaccountedStems: 0, loading: true, loaded: false });
        return next;
      });
      if (!cache.has(key) && fetchVarietyUsage) {
        Promise.resolve(fetchVarietyUsage(key))
          .then((data) =>
            setCache((prev) =>
              new Map(prev).set(key, {
                events: data?.events ?? [],
                unaccountedStems: data?.unaccountedStems ?? 0,
                loading: false,
                loaded: true,
              }),
            ),
          )
          .catch(() =>
            setCache((prev) =>
              new Map(prev).set(key, { events: [], unaccountedStems: 0, loading: false, loaded: true }),
            ),
          );
      }
    },
    [openId, cache, fetchVarietyUsage],
  );

  return { openId, isOpen, toggle, getTrace };
}

export default useVarietyTraceExpand;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useVarietyTraceExpand.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Export + document**

Add to `packages/shared/index.js` (alongside the other hook exports):

```js
export { useVarietyTraceExpand } from './hooks/useVarietyTraceExpand.js';
```

Add to `packages/shared/CLAUDE.md` under `hooks/`:

```
  useVarietyTraceExpand.js    → Expand state for date-grouped stock cards: opens one row at a time, lazy-fetches + caches each Variety's /stock/varieties/:key/usage trace. Used by ShortfallSummary + PendingArrivalsPanel.
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/hooks/useVarietyTraceExpand.js packages/shared/test/useVarietyTraceExpand.test.js packages/shared/index.js packages/shared/CLAUDE.md
git commit -m "feat(stock): shared useVarietyTraceExpand hook for card row-trace expand"
```

---

### Task 2: ShortfallSummary expands to VarietyTracePanel

**Files:**
- Modify: `packages/shared/components/ShortfallSummary.jsx`
- Test: `packages/shared/test/ShortfallSummary.test.jsx` (create if absent)

**Interfaces:**
- Consumes: `useVarietyTraceExpand` (Task 1), `VarietyTracePanel` (existing). New prop `fetchVarietyUsage(key)` replaces the old `fetchUsage(stockId)`.
- Produces: rows that, when tapped, render `<VarietyTracePanel events unaccountedStems t />` below the row, keyed by Variety.

- [ ] **Step 1: Write the failing test**

```jsx
// @vitest-environment jsdom
// packages/shared/test/ShortfallSummary.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ShortfallSummary from '../components/ShortfallSummary.jsx';

const t = {
  shortfallsTitle: 'Shortfalls', stems: 'stems', traceEmpty: 'No events',
  traceTypeOrder: 'Order', traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase', traceTypePremade: 'Premade',
};

// One Variety short on one date.
const groups = [{
  key: 'Peony|Pink|60|Sarah',
  type_name: 'Peony', colour: 'Pink', size_cm: 60, cultivar: 'Sarah',
  rows: [{ id: 'de1', date: '2026-06-22', 'Current Quantity': -7 }],
}];

it('expands a shortfall row to the full VarietyTracePanel via fetchVarietyUsage', async () => {
  const fetchVarietyUsage = vi.fn().mockResolvedValue({
    events: [
      { type: 'order', qty: -7, orderId: '#202605-1', customer: 'Jane', date: '2026-06-20' },
      { type: 'purchase', qty: 25, supplier: 'FarmCo', date: '2026-06-18' },
    ],
    unaccountedStems: 0,
  });

  render(<ShortfallSummary groups={groups} reservations={new Map()} t={t} fetchVarietyUsage={fetchVarietyUsage} today="2026-06-21" />);

  fireEvent.click(screen.getByTestId('shortfall-row'));
  await waitFor(() => expect(fetchVarietyUsage).toHaveBeenCalledWith('Peony|Pink|60|Sarah'));
  // VarietyTracePanel renders trace-row entries (order + purchase), not just orders.
  const rows = await screen.findAllByTestId('trace-row');
  expect(rows.length).toBe(2);
  expect(screen.getByText('Purchase')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/ShortfallSummary.test.jsx`
Expected: FAIL — component still uses `fetchUsage`/orders-only list; `fetchVarietyUsage` unused, no `purchase` row rendered.

- [ ] **Step 3: Edit ShortfallSummary**

In `packages/shared/components/ShortfallSummary.jsx`:

1. Update imports (add hook + panel; `varietyFinancials`/`InlinePriceField`/`DateTag`/`STOCK_GRID_FULL` stay):

```jsx
import { useMemo } from 'react';
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';
import VarietyTracePanel from './VarietyTracePanel.jsx';
import { allocateVarietyCoverage, arrivalsForVariety } from '../utils/stockMath.js';
import { varietyFinancials } from '../utils/varietyFinancials.js';
import DateTag from './DateTag.jsx';
import { STOCK_GRID_FULL } from './stockRowGrid.js';
import InlinePriceField from './InlinePriceField.jsx';
```

2. Replace the prop `fetchUsage` with `fetchVarietyUsage`, drop the `openRow`/`trails`/`loadingId` `useState` + `toggleRow`, and use the hook:

```jsx
export default function ShortfallSummary({
  groups,
  reservations = new Map(),
  pendingPO = {},
  t,
  onVarietyClick,
  fetchVarietyUsage,
  today,
  splitType = false,
  onPatchPriceBulk,
}) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [collapsed, setCollapsed] = useState(false);
  const { isOpen, toggle, getTrace } = useVarietyTraceExpand(fetchVarietyUsage);
  // ...byDate / finByKey / idsByKey memos unchanged...
```

3. Pass the hook handles down to `DateRow` (replace the old `openRow/trails/loadingId/onToggleRow` props):

```jsx
<DateRow
  date={date}
  rows={rows}
  t={t}
  isOpen={isOpen}
  toggle={toggle}
  getTrace={getTrace}
  onVarietyClick={onVarietyClick}
  splitType={splitType}
  finByKey={finByKey}
  idsByKey={idsByKey}
  onPatchPriceBulk={onPatchPriceBulk}
/>
```

4. In `DateRow`, give each row a stable open-id `rowId = `${r.key}@${date}``; replace the click handler and the chevron `isOpen` checks; the row button keeps its existing grid/flex markup but its `onClick` becomes:

```jsx
const rowId = `${r.key}@${date}`;
const open = isOpen(rowId);
// ...
onClick={(e) => { e.stopPropagation(); toggle(rowId, r.key); }}
```

Use `open` wherever the old `isOpen` (chevron rotation `rotate-90`) was referenced.

5. Replace the entire `{isOpen && (<div className="ml-6 …"> …orders-only list… </div>)}` block with:

```jsx
{open && (
  <div className="ml-6 mt-1 mb-2">
    {getTrace(r.key).loading && (
      <p className="text-red-400 italic text-xs">{t.loading ?? 'Loading…'}</p>
    )}
    {!getTrace(r.key).loading && (
      <VarietyTracePanel
        events={getTrace(r.key).events}
        unaccountedStems={getTrace(r.key).unaccountedStems}
        t={t}
      />
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/ShortfallSummary.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full shared suite (no regressions)**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/components/ShortfallSummary.jsx packages/shared/test/ShortfallSummary.test.jsx
git commit -m "feat(stock): shortfall row expands to full VarietyTracePanel (PRD #324 T5 ext)"
```

---

### Task 3: PendingArrivalsPanel gains the same expand

**Files:**
- Modify: `packages/shared/components/PendingArrivalsPanel.jsx`
- Test: `packages/shared/test/PendingArrivalsPanel.test.jsx` (create if absent)

**Interfaces:**
- Consumes: `useVarietyTraceExpand` + `VarietyTracePanel`; new prop `fetchVarietyUsage(key)`.
- Produces: typed pending rows are tappable → expand `VarietyTracePanel`; legacy (`__legacy__|…`) rows stay non-expandable (no Variety key to resolve).

- [ ] **Step 1: Write the failing test**

```jsx
// @vitest-environment jsdom
// packages/shared/test/PendingArrivalsPanel.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PendingArrivalsPanel from '../components/PendingArrivalsPanel.jsx';

const t = { pendingArrivals: 'Incoming', stems: 'stems', traceEmpty: 'No events',
  traceTypeOrder: 'Order', traceTypePurchase: 'Purchase' };

const pendingPO = { s1: { plannedDate: '2026-06-25', flowerName: 'Peony', pos: [{ quantity: 25, plannedDate: '2026-06-25' }] } };
const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: 'Sarah' }];

it('expands a pending row to VarietyTracePanel via fetchVarietyUsage', async () => {
  const fetchVarietyUsage = vi.fn().mockResolvedValue({
    events: [{ type: 'purchase', qty: 25, supplier: 'FarmCo', date: '2026-06-25' }],
    unaccountedStems: 0,
  });
  render(<PendingArrivalsPanel pendingPO={pendingPO} stock={stock} t={t} fetchVarietyUsage={fetchVarietyUsage} />);

  fireEvent.click(screen.getByTestId('pending-arrival-row'));
  await waitFor(() => expect(fetchVarietyUsage).toHaveBeenCalledWith('Peony|Pink|60|Sarah'));
  expect(await screen.findByTestId('trace-row')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/PendingArrivalsPanel.test.jsx`
Expected: FAIL — rows are static `<li>`, no toggle, `fetchVarietyUsage` unused.

- [ ] **Step 3: Edit PendingArrivalsPanel**

In `packages/shared/components/PendingArrivalsPanel.jsx`:

1. Add imports + accept the prop + use the hook:

```jsx
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';
import VarietyTracePanel from './VarietyTracePanel.jsx';
// ...
export default function PendingArrivalsPanel({ pendingPO = {}, stock = [], t = {}, splitType = false, onPatchPriceBulk, fetchVarietyUsage }) {
  const [collapsed, setCollapsed] = useState(false);
  const { isOpen, toggle, getTrace } = useVarietyTraceExpand(fetchVarietyUsage);
  // ...existing memos unchanged...
```

2. A row is expandable only when it carries a real Variety key (typed). Define a helper inside the date `<ul>` map for each `f`:

```jsx
const rowId = `${sec.date ?? 'undated'}@${f.key}`;
const canTrace = !!fetchVarietyUsage && !f.key.startsWith('__legacy__');
const open = canTrace && isOpen(rowId);
```

3. Wrap BOTH the `splitType` grid `<li>` and the mobile flex `<li>` so that when `canTrace`, the row content is a `<button>` calling `toggle(rowId, f.key)` and a chevron `▸` (rotate-90 when `open`) prefixes col 1 / the flex label; when `!canTrace`, keep today's static `<li>`. For the grid branch, put the chevron INSIDE col 1 (same pattern ShortfallSummary uses) so column boundaries don't shift:

```jsx
// col 1: Type (with chevron when traceable)
<span className="flex items-baseline gap-1 min-w-0">
  {canTrace && <span className={`text-indigo-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>}
  <span className="font-semibold text-gray-900 truncate">{f.type ?? f.fallbackName}</span>
</span>
```

Make the whole row clickable by wrapping the grid `<span>`/flex `<span>` in a `<button type="button" data-testid="pending-arrival-row" onClick={(e) => { e.stopPropagation(); if (canTrace) toggle(rowId, f.key); }}>` (move the `data-testid` onto the button). Keep `<li>` as the outer element holding both the button and the expand panel.

4. After the row button, render the expand panel (same shape as Task 2):

```jsx
{open && (
  <div className="ml-6 mt-1 mb-2">
    {getTrace(f.key).loading && <p className="text-indigo-400 italic text-xs">{t.loading ?? 'Loading…'}</p>}
    {!getTrace(f.key).loading && (
      <VarietyTracePanel events={getTrace(f.key).events} unaccountedStems={getTrace(f.key).unaccountedStems} t={t} />
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/PendingArrivalsPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full shared suite**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/components/PendingArrivalsPanel.jsx packages/shared/test/PendingArrivalsPanel.test.jsx
git commit -m "feat(stock): pending-arrival row expands to VarietyTracePanel (typed rows)"
```

---

### Task 4: Wire both host apps (parity)

**Files:**
- Modify: `apps/dashboard/src/components/StockTab.jsx`
- Modify: `apps/florist/src/pages/StockPanelPage.jsx`

**Interfaces:**
- Consumes: the new `fetchVarietyUsage` prop on both cards (Tasks 2–3).
- Produces: a Variety-key fetcher hitting the existing endpoint; the old per-`stockId` `fetchUsage` prop is removed.

This is pure UI wiring — skip the TDD red phase; build is the gate.

- [ ] **Step 1: Dashboard — swap the fetcher**

In `apps/dashboard/src/components/StockTab.jsx`, on the `<ShortfallSummary …>` mount, replace:

```jsx
fetchUsage={async (stockId) => {
  const res = await client.get(`/stock/${stockId}/usage`);
  return res.data.trail || [];
}}
```

with:

```jsx
fetchVarietyUsage={async (key) => {
  const res = await client.get(`/stock/varieties/${encodeURIComponent(key)}/usage`);
  return res.data; // { variety, events, unaccountedStems }
}}
```

And add the SAME `fetchVarietyUsage={…}` prop to the `<PendingArrivalsPanel …>` mount.

- [ ] **Step 2: Florist — same wiring (parity)**

In `apps/florist/src/pages/StockPanelPage.jsx`, apply the identical swap on `<ShortfallSummary>` (replace its `fetchUsage` block, ~line 552) and add `fetchVarietyUsage` to `<PendingArrivalsPanel>` (~line 538).

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "fetchUsage" apps/florist/src apps/dashboard/src packages/shared`
Expected: zero matches (the prop is fully renamed). If any remain, fix them.

- [ ] **Step 4: Build all three apps**

```bash
cd apps/florist   && ./node_modules/.bin/vite build && cd ../..
cd apps/dashboard && ./node_modules/.bin/vite build && cd ../..
cd apps/delivery  && ./node_modules/.bin/vite build && cd ../..
```
Expected: three clean builds.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/StockTab.jsx apps/florist/src/pages/StockPanelPage.jsx
git commit -m "feat(stock): wire Variety-key trace fetch into shortfall + pending cards (both apps)"
```

---

### Task 5 (OPTIONAL — owner-gated polish): balance sparkline in VarietyTracePanel

Skip unless the owner wants the at-a-glance balance line in the card expand. Ports the `BalanceSparkline` from the stranded `dbea7b6` (`BatchTracePanel`) into the shared `VarietyTracePanel` so every trace mount (stock-list row + shortfall + pending) gets it.

**Files:**
- Modify: `packages/shared/components/VarietyTracePanel.jsx`
- Modify: `packages/shared/test/VarietyTracePanel.test.jsx`
- Modify: `apps/*/src/**/translations.js` (en + ru `traceBalance`)

**Interfaces:**
- Produces: `<div data-testid="trace-sparkline">` at the top of the panel when there are ≥2 dated events; computes running balance from `events` (oldest→newest), red when the final balance < 0.

- [ ] **Step 1: Write the failing test**

```jsx
// add to packages/shared/test/VarietyTracePanel.test.jsx
it('renders a balance sparkline when there are 2+ dated events', () => {
  const events = [
    { type: 'purchase', qty: 25, date: '2026-06-18' },
    { type: 'order', qty: -30, date: '2026-06-20' },
  ];
  render(<VarietyTracePanel events={events} unaccountedStems={-5} t={{ stems: 'stems', traceBalance: 'Balance', traceTypeOrder: 'Order', traceTypePurchase: 'Purchase' }} />);
  expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/VarietyTracePanel.test.jsx`
Expected: FAIL — no `trace-sparkline` node.

- [ ] **Step 3: Port BalanceSparkline into VarietyTracePanel**

Add the `BalanceSparkline` function (copy verbatim from `git show dbea7b6 -- packages/shared/components/BatchTracePanel.jsx`, the `function BalanceSparkline({ points, t })` block) into `VarietyTracePanel.jsx`. Above the events `<ul>`, compute running balance and mount it:

```jsx
const sorted = hasEvents ? [...events].sort(byDateAsc) : [];
let bal = 0;
const withBalance = sorted
  .filter((e) => e.date) // sparkline only over dated events
  .map((e) => { bal += (e.qty ?? e.quantity ?? 0); return { entry: e, balance: bal }; });
// ...
{withBalance.length >= 2 && <BalanceSparkline points={withBalance} t={t} />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/VarietyTracePanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Add `traceBalance` strings (en + ru, all apps that ship the card)**

In `apps/florist/src/translations.js` and `apps/dashboard/src/translations.js`, add to both the `en` and `ru` blocks:

```js
traceBalance: 'Balance',   // en
traceBalance: 'Баланс',    // ru
```

- [ ] **Step 6: Build all three apps + commit**

```bash
cd apps/florist && ./node_modules/.bin/vite build && cd ../..
cd apps/dashboard && ./node_modules/.bin/vite build && cd ../..
cd apps/delivery && ./node_modules/.bin/vite build && cd ../..
git add packages/shared/components/VarietyTracePanel.jsx packages/shared/test/VarietyTracePanel.test.jsx apps/florist/src/translations.js apps/dashboard/src/translations.js
git commit -m "feat(stock): balance sparkline atop VarietyTracePanel (port of dbea7b6)"
```

---

### Task 6: Docs + final verification

**Files:**
- Modify: `CHANGELOG.md`, `docs/adr/0008-*.md`

- [ ] **Step 1: CHANGELOG entry** — under the current date, note: "Shortfalls + Pending-Arrivals card rows now expand to the full per-Variety usage trace (reuses `/stock/varieties/:key/usage`); no schema/endpoint change."

- [ ] **Step 2: ADR-0008 note** — append a short paragraph: the per-Variety trace surface now also mounts under Shortfall + Pending rows (not only the stock-list row); still legacy-model events, absorption still deferred.

- [ ] **Step 3: Final pre-PR matrix**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run && cd ../..
cd apps/florist && ./node_modules/.bin/vite build && cd ../..
cd apps/dashboard && ./node_modules/.bin/vite build && cd ../..
cd apps/delivery && ./node_modules/.bin/vite build && cd ../..
```
Expected: shared suite green; three clean builds. (No backend tests — no backend change.)

- [ ] **Step 4: Commit + open PR**

```bash
git add CHANGELOG.md docs/adr/0008-*.md
git commit -m "docs(stock): record trace-under-cards surface (PRD #324 T5 extension)"
```

PR body names verification: shared vitest output + three Vite builds + lab visual confirm. Reuses the existing `/stock/varieties/:key/usage` endpoint (no backend change to verify).

---

## What changed vs the original T5 plan (`2026-05-29-t5-variety-trace-surface.md`)

| Original T5 | This slice |
|---|---|
| Mounted `VarietyTracePanel` on the **stock-list Variety row** only (`VarietyListItem` expand). | Extends the SAME panel + endpoint to **Shortfall + Pending-Arrivals rows**. |
| `ShortfallSummary` had an ad-hoc **orders-only** expand via `/stock/:id/usage` (single DE id). | Superseded by the full Variety trace via `/stock/varieties/:key/usage` (OPEN DECISION above). |
| `PendingArrivalsPanel` had **no** expand. | Gains the expand (typed rows; legacy rows stay static). |
| Open/fetch state inlined per host. | DRY'd into one shared hook `useVarietyTraceExpand`. |
| Balance sparkline lived (unmerged) in `BatchTracePanel` on `dbea7b6`. | Optionally ported into shared `VarietyTracePanel` (Task 5, owner-gated). |
| Absorption deferred (no `transaction_id`). | **Unchanged** — still deferred; surfaces as the drift footer. |

**No requirement/PRD change needed.** This is a T5 UI extension on the legacy event model; it does not touch the `order_line_consumptions` ledger (still PRD #324 T1, future). No schema, no new route, no integration → no `to-prd` (below the ≥2-subsystem threshold). One tracer issue + this plan suffices.

## Right-size check

6 tasks (one optional). New code: 1 small hook (~45 LOC) + 2 component edits + 2 host wirings + optional sparkline port + docs. No schema, no backend. Comfortably one window.

## Self-Review

- **Spec coverage:** expand on shortfall (Task 2) ✓; expand on pending (Task 3) ✓; both apps (Task 4) ✓; reuse existing endpoint + panel (constraint) ✓; freed-right-side context = the cleaner row from S3 hosts the expand ✓; sparkline (optional, Task 5) ✓.
- **Placeholder scan:** none — every code step shows the code; the sparkline port references the exact source commit.
- **Type consistency:** hook returns `{ openId, isOpen, toggle, getTrace }`; both cards consume those names; `fetchVarietyUsage(key) => { events, unaccountedStems }` matches the endpoint payload and `VarietyTracePanel`'s `(events, unaccountedStems, t)` props.
