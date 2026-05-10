# Stock Y-model: Variety collapsed list + getVarietyTotals + trace + write-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute task-by-task.

**Goal:** Collapse Stock list view by Variety (4-tuple, ADR-0006) with 4-bucket header (`onHand` / `planned` / `reservedForPremades` / `net`) per Variety, Stock Items nested under each. Backend returns per-Variety aggregation + premade reservation roll-up under `STOCK_Y_MODEL`. Per-Batch trace as modal on florist, inline on dashboard. Write-off targets a specific Batch (default oldest, FIFO).

**Architecture:** New shared helper `getVarietyTotals` (in `stockMath.js`, pitfall #8 territory). Backend `/stock` gains Variety-grouped path under flag; `/stock/:id/usage` filters by exact ID under flag. Two new shared components: `<TypeGroupHeader>` (collapsible Type) + `<VarietyListItem>` (Variety row with 4 buckets + nested Stock Items). Florist + dashboard adopt; existing flat list preserved under flag-off.

**Tech Stack:** React + Tailwind, Express + Drizzle (Postgres), no new deps.

**ADR alignment:** ADR-0005 (dated DEs), ADR-0006 (4-tuple identity), ADR-0007 (Batch decrement retained). Pitfall #8 is the load-bearing constraint — committed is informational, never subtracted.

**Key files (existing):**
- `packages/shared/utils/stockMath.js` — adds `getVarietyTotals`
- `backend/src/routes/stock.js` — extends `/stock` GET + `/stock/:id/usage`
- `backend/src/repos/stockRepo.js` — adds grouped query
- `apps/florist/src/pages/StockPanelPage.jsx` + `apps/florist/src/components/StockItem.jsx`
- `apps/dashboard/src/components/StockTab.jsx`
- `packages/shared/utils/varietyKey.js` — already exists (#288); reused for grouping

---

## Task 1: `getVarietyTotals` helper

**Pitfall #8 — TDD red mandatory + opus code-quality review on this task.**

**Files:**
- Modify: `packages/shared/utils/stockMath.js`
- Modify: `packages/shared/test/stockMath.test.js`

- [ ] **Step 1: Write failing tests (red phase mandatory — pitfall #8 area)**

```js
// Append to packages/shared/test/stockMath.test.js
import { getVarietyTotals } from '../utils/stockMath.js';

describe('getVarietyTotals — Variety bucket aggregation per ADR-0005', () => {
  it('separates onHand (Batches) from planned (Demand Entries)', () => {
    const rows = [
      { id: 'b1', current_quantity: 10, date: '2026-05-10' },  // Batch
      { id: 'b2', current_quantity: -3, date: '2026-05-12' },  // DE
      { id: 'b3', current_quantity:  5, date: '2026-05-11' },  // Batch
    ];
    expect(getVarietyTotals(rows, new Map())).toEqual({
      onHand: 15, planned: 3, reservedForPremades: 0, net: 12, reclaimable: 0,
    });
  });

  it('subtracts reservedForPremades from onHand-side; net adjusts', () => {
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    const reservations = new Map([['b1', 4]]);
    expect(getVarietyTotals(rows, reservations))
      .toEqual({ onHand: 10, planned: 0, reservedForPremades: 4, net: 6, reclaimable: 4 });
  });

  it('regression — pitfall #8 v1: NEVER computes qty - committed (double-count)', () => {
    // Pre-2026-04-22 bug: subtracting committed-qty from on-hand double-counted demand.
    // Ensure helper does not accept a "committed" parameter and does not subtract it.
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    // Even if a caller passes a stale committed object on the row, helper ignores it.
    const polluted = rows.map(r => ({ ...r, committed: 5 }));
    expect(getVarietyTotals(polluted, new Map()).onHand).toBe(10);
    expect(getVarietyTotals(polluted, new Map()).net).toBe(10);
  });

  it('regression — pitfall #8 v2: cumulative shortfall stays negative under net', () => {
    // 2026-04-22 second-attempt bug: `qty < 0 ? qty : qty - committed` broke cumulative
    // shortfall. With multiple negative DEs, net should sum to total negative magnitude.
    const rows = [
      { id: 'd1', current_quantity: -5, date: '2026-05-10' },
      { id: 'd2', current_quantity: -3, date: '2026-05-12' },
    ];
    expect(getVarietyTotals(rows, new Map()))
      .toEqual({ onHand: 0, planned: 8, reservedForPremades: 0, net: -8, reclaimable: 0 });
  });

  it('reclaimable = min(reservedForPremades, planned shortfall) — 0 when no shortfall', () => {
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    const reservations = new Map([['b1', 4]]);
    expect(getVarietyTotals(rows, reservations).reclaimable).toBe(4);
  });

  it('reclaimable when both onHand and planned exist', () => {
    const rows = [
      { id: 'b1', current_quantity:  10, date: '2026-05-10' },
      { id: 'd1', current_quantity: -15, date: '2026-05-12' },
    ];
    const reservations = new Map([['b1', 6]]);
    // onHand=10, planned=15, reservedForPremades=6, net = 10 - 15 = -5,
    // reclaimable = how many premade stems could fill the shortfall = min(6, 5) = 5
    expect(getVarietyTotals(rows, reservations))
      .toEqual({ onHand: 10, planned: 15, reservedForPremades: 6, net: -5, reclaimable: 5 });
  });

  it('handles empty rows array', () => {
    expect(getVarietyTotals([], new Map()))
      .toEqual({ onHand: 0, planned: 0, reservedForPremades: 0, net: 0, reclaimable: 0 });
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL** — `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/stockMath.test.js`

- [ ] **Step 3: Implement helper**

```js
// Append to packages/shared/utils/stockMath.js with full doc-comment

/**
 * getVarietyTotals — per-Variety bucket aggregation per ADR-0005 + ADR-0006.
 *
 * Inputs are already filtered to a single Variety (4-tuple). Caller does the
 * NULL-aware grouping via varietyKey/groupByVariety.
 *
 * Returns four buckets + reclaimable signal:
 *   - onHand                = sum of positive current_quantity (Batches)
 *   - planned               = sum of |negative current_quantity| (Demand Entries) — magnitude, not sign
 *   - reservedForPremades   = sum of reservations across this Variety's stock IDs
 *   - net                   = onHand − planned − reservedForPremades  ❌ NO. We do NOT subtract reservedForPremades again.
 *                           = onHand − planned. Reservations are an informational bucket per
 *                             ADR-0005; subtracting them would re-double-count (Pitfall #8 trap).
 *   - reclaimable           = min(reservedForPremades, max(0, planned − onHand))
 *                             — how many premade stems could be reclaimed to fill the shortfall
 *
 * **Pitfall #8 (CLAUDE.md root §Known Pitfalls #8):** committed is informational; never
 * subtract it from on-hand. Two prior bugs encoded as regression fixtures (v1 = qty−committed
 * double count, v2 = `qty<0 ? qty : qty−committed` broke cumulative shortfall).
 *
 * @param {Array<{ id: string, current_quantity: number, date: string }>} rows
 * @param {Map<string, number>} reservations stockId → reservedQty (from getPremadeReservations)
 * @returns {{ onHand: number, planned: number, reservedForPremades: number, net: number, reclaimable: number }}
 */
export function getVarietyTotals(rows, reservations = new Map()) {
  let onHand = 0;
  let planned = 0;
  let reservedForPremades = 0;
  for (const row of rows) {
    const qty = Number(row.current_quantity) || 0;
    if (qty > 0) onHand += qty;
    else if (qty < 0) planned += -qty;
    const reserved = reservations.get(row.id) ?? 0;
    if (reserved > 0) reservedForPremades += reserved;
  }
  const net = onHand - planned;
  const reclaimable = Math.min(reservedForPremades, Math.max(0, planned - onHand));
  return { onHand, planned, reservedForPremades, net, reclaimable };
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Export from `packages/shared/index.js`**

```js
export { getEffectiveStock, hasStockShortfall, getVarietyTotals } from './utils/stockMath.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/utils/stockMath.js packages/shared/test/stockMath.test.js packages/shared/index.js
git commit -m "feat(shared): getVarietyTotals — per-Variety bucket aggregation (#289, pitfall #8 regression fixtures)"
```

---

## Task 2: Backend `/stock` Y-model aggregation route + repo query

**TDD red mandatory.** Backend service area.

**Files:**
- Modify: `backend/src/repos/stockRepo.js`
- Modify: `backend/src/routes/stock.js`
- Modify: `backend/src/__tests__/stockRepo.test.js` (new test cases) or create `stockRoutes.test.js`

- [ ] **Step 1: Write failing tests for `stockRepo.listGroupedByVariety`**

```js
// Append to backend/src/__tests__/stockRepo.test.js (or appropriate)
describe('stockRepo.listGroupedByVariety (Y-model, #289)', () => {
  it('groups Stock Items by 4-tuple with NULL-aware equality', async () => {
    // seed: 2 rows same Variety, 1 row different Variety, 1 row null colour vs same Variety with "Pink"
    // expect 3 groups
  });
  it('attaches premade reservations roll-up per group', async () => {
    // seed Variety with batch + premade lines pointing to that batch
    // expect group.reservedForPremades > 0
  });
  it('hides zero-qty groups when includeEmpty=false', async () => { ... });
});
```

(Use existing test harness `pglite` setup; mirror existing `stockRepo.test.js` style.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `listGroupedByVariety` in `stockRepo.js`**

```js
export async function listGroupedByVariety({ includeEmpty = false } = {}) {
  const handle = getDb();
  // Fetch all Y-model rows (Variety attrs populated)
  const rows = await handle.select(...).from(stock).where(/* type_name IS NOT NULL */);
  // Premade reservations
  const reservations = await getPremadeReservations(rows.map(r => r.id));
  // Group by 4-tuple
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.type_name ?? ''}|${row.colour ?? ''}|${row.size_cm ?? ''}|${row.cultivar ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...identity, rows: [], reservedForPremades: 0 });
    groups.get(key).rows.push(row);
    const r = reservations.get(row.id) ?? 0;
    if (r > 0) groups.get(key).reservedForPremades += r;
  }
  // Filter zero-qty if requested
  if (!includeEmpty) {
    for (const [k, g] of groups) {
      const totalQty = g.rows.reduce((s, r) => s + (r.current_quantity || 0), 0);
      if (totalQty === 0 && g.reservedForPremades === 0) groups.delete(k);
    }
  }
  return [...groups.values()];
}
```

- [ ] **Step 4: Implement Y-model branch in `GET /stock` route**

```js
// backend/src/routes/stock.js — inside existing GET /stock handler
if (getStockYModelEnabled() && req.query.grouped === 'true') {
  const groups = await stockRepo.listGroupedByVariety({ includeEmpty: req.query.includeEmpty === 'true' });
  return res.json({ groups });
}
// existing flat path unchanged
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(backend): /stock?grouped=true Y-model Variety aggregation behind flag (#289)"
```

---

## Task 3: Backend `/stock/:id/usage` exact-ID filter behind flag

**TDD red mandatory.** Backend service area.

**Files:**
- Modify: `backend/src/routes/stock.js` (lines ~506-709)
- Modify: `backend/src/__tests__/stockRoutes.test.js` (or appropriate)

- [ ] **Step 1: Write failing test**

Two batches of same Variety. Issue trace for batch A's id under flag-on. Expect: only events that link to batch A's id, no sibling-aggregation. Under flag-off: existing base-name aggregation still works.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement flag branch**

```js
// backend/src/routes/stock.js — inside GET /stock/:id/usage handler
const stockItem = await stockRepo.getById(req.params.id);
let trail;
if (getStockYModelEnabled()) {
  // Exact-ID filter: only events with stock_item_id === req.params.id
  trail = await stockRepo.getUsageByExactId(req.params.id);
} else {
  // legacy: existing sibling-aggregation by base name
  trail = await stockRepo.getUsageByBaseName(stockItem['Display Name']);
}
res.json({ stockItem: { id, displayName, currentQty }, trail });
```

`stockRepo.getUsageByExactId` is a new helper that joins order_lines, stock_writeoffs, purchase_lines, premade_bouquet_lines on `stock_item_id = $1`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(backend): /stock/:id/usage exact-ID filter behind STOCK_Y_MODEL (#289, ADR-0007)"
```

---

## Task 4: `<TypeGroupHeader>` shared component

**TDD red mandatory** (new shared component).

**Files:**
- Create: `packages/shared/components/TypeGroupHeader.jsx`
- Create: `packages/shared/test/TypeGroupHeader.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import TypeGroupHeader from '../components/TypeGroupHeader.jsx';

describe('TypeGroupHeader', () => {
  it('renders Type label + total qty across varieties', () => {
    render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByText('Rose')).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('toggles collapsed on click', () => {
    const onToggle = vi.fn();
    render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={onToggle} t={{ stems: 'stems' }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('chevron rotates when collapsed', () => {
    const { rerender } = render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByTestId('type-chevron')).toHaveAttribute('data-collapsed', 'false');
    rerender(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={true} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByTestId('type-chevron')).toHaveAttribute('data-collapsed', 'true');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — sticky header w/ chevron, total stems summary, varieties count badge.

- [ ] **Step 4: Run, expect 3 PASS**

- [ ] **Step 5: Export from `packages/shared/index.js`**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(shared): <TypeGroupHeader> sticky collapsible header (#289)"
```

---

## Task 5: `<VarietyListItem>` header with 4 buckets

**TDD red mandatory** (new component, pitfall #8 area — uses getVarietyTotals).

**Files:**
- Create: `packages/shared/components/VarietyListItem.jsx`
- Create: `packages/shared/test/VarietyListItem.test.jsx`

- [ ] **Step 1: Write failing tests for header rendering**

```jsx
const t = { onHand: 'on hand', planned: 'planned', reserved: 'reserved', net: 'net', stems: 'stems' };
const variety = {
  key: 'Rose|Pink|60|',
  type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
  rows: [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }],
};

describe('VarietyListItem header', () => {
  it('renders Variety display (drops Type since under TypeGroupHeader): "Pink 60cm"', () => {
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Pink 60cm/)).toBeInTheDocument();
    expect(screen.queryByText(/Rose/)).not.toBeInTheDocument();
  });

  it('renders 4 buckets aligned right', () => {
    render(<VarietyListItem variety={variety} reservations={new Map([['b1', 3]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByTestId('bucket-onHand')).toHaveTextContent('10');
    expect(screen.getByTestId('bucket-planned')).toHaveTextContent('0');
    expect(screen.getByTestId('bucket-reserved')).toHaveTextContent('3');
    expect(screen.getByTestId('bucket-net')).toHaveTextContent('7');
  });

  it('cultivar shown only when non-null', () => {
    const v2 = { ...variety, cultivar: "Sarah Bernhardt" };
    const { rerender } = render(<VarietyListItem variety={v2} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Sarah Bernhardt/)).toBeInTheDocument();
  });

  it('toggles expanded on header click', () => {
    const onToggle = vi.fn();
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('variety-header'));
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement header (4-column grid, right-aligned numbers, expand chevron). Use `getVarietyTotals`.**

- [ ] **Step 4: Run, expect 4 PASS**

- [ ] **Step 5: Export + commit**

```bash
git commit -am "feat(shared): <VarietyListItem> header with 4 buckets (#289)"
```

---

## Task 6: `<VarietyListItem>` expand reveals nested Stock Items

**Files:**
- Modify: `packages/shared/components/VarietyListItem.jsx`
- Modify: `packages/shared/test/VarietyListItem.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
it('expanded shows one row per nested Stock Item', () => { ... });
it('row label uses (<Date>) suffix per ADR-0006', () => { ... });
it('Demand Entry rows visually distinct from Batches', () => { ... });
it('clicking a Batch row fires onBatchClick(stockItemId)', () => { ... });
```

- [ ] **Step 2: Implement**

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

---

## Task 7: `<VarietyListItem>` tap-on-reserved → premade list

**Files:**
- Modify: `packages/shared/components/VarietyListItem.jsx`
- Modify: `packages/shared/test/VarietyListItem.test.jsx`

- [ ] **Step 1: Failing tests**

```jsx
it('tap-on-reserved-bucket reveals premade list when premadesByStockId provided', () => { ... });
it('reserved bucket inert (no expand) when no premades', () => { ... });
```

- [ ] **Step 2: Implement** — tap reserved bucket toggles a sub-list rendering `premadesByStockId.get(stockId)`.

- [ ] **Step 3: Commit**

---

## Task 8: Per-Batch trace UX seam — modal (florist) + inline panel (dashboard)

**Pitfall area** (touches StockItem.jsx). Per-task code-quality mandatory.

**Files:**
- Create: `packages/shared/components/BatchTraceModal.jsx` (florist UX) + test
- Create: `packages/shared/components/BatchTracePanel.jsx` (dashboard UX) + test (or: shared core + thin wrappers)
- Modify: `packages/shared/index.js`

Decision: ship a single `<BatchTracePanel>` (presentational) + a `<BatchTraceModal>` thin wrapper that mounts the panel inside a modal. Dashboard renders `<BatchTracePanel>` directly inline; florist renders `<BatchTraceModal>` over its row.

- [ ] **Step 1: Failing tests for the panel**

```jsx
it('renders trail entries grouped by type', () => { ... });
it('order entries show customer + date', () => { ... });
it('writeoff entries show reason', () => { ... });
it('empty trail shows "No history" message', () => { ... });
```

- [ ] **Step 2: Tests for modal wrapper**

```jsx
it('mounts panel + close button', () => { ... });
it('Esc closes modal', () => { ... });
```

- [ ] **Step 3: Implement panel + modal**

- [ ] **Step 4: Run, all pass**

- [ ] **Step 5: Commit**

---

## Task 9: Write-off Batch picker — exclude Demand Entries, default oldest

**Files:**
- Create: `packages/shared/components/WriteOffBatchPicker.jsx`
- Create: `packages/shared/test/WriteOffBatchPicker.test.jsx`

- [ ] **Step 1: Failing tests**

```jsx
it('lists only Batch rows (Demand Entries excluded)', () => { ... });
it('selects oldest Batch by date by default', () => { ... });
it('Owner can override the default Batch', () => { ... });
it('confirm fires onConfirm({ stockId, qty, reason })', () => { ... });
```

- [ ] **Step 2: Implement**

- [ ] **Step 3: Pass + commit**

---

## Task 10: Florist `StockPanelPage` adoption behind flag

**Pitfall #8 area** (StockItem.jsx + StockPanelPage). Per-task code-quality mandatory.

**Files:**
- Modify: `apps/florist/src/pages/StockPanelPage.jsx`
- Modify: `apps/florist/src/components/StockItem.jsx` (florist trace becomes modal-driven)
- Modify: `apps/florist/src/translations.js`

Skip TDD red phase (UI wiring composing existing components). But run shared tests + florist build after.

- [ ] **Step 1: Detect flag + fetch grouped data**

```jsx
const yEnabled = useStockYModelFlag();
const { data: grouped } = yEnabled
  ? await apiClient.get('/stock?grouped=true')
  : null;
```

- [ ] **Step 2: Render `<TypeGroupHeader>` + `<VarietyListItem>` when flag-on; legacy `<StockItem>` flat list when flag-off**

- [ ] **Step 3: Wire `<BatchTraceModal>` for Batch tap; preserve write-off via `<WriteOffBatchPicker>`**

- [ ] **Step 4: Add translation keys; build florist; commit**

---

## Task 11: Dashboard `StockTab` adoption behind flag

**Pitfall #8 area.**

Mirror Task 10 pattern, but trace is **inline** via `<BatchTracePanel>` (not modal).

- [ ] **Step 1-4** mirror florist; build dashboard; commit.

---

## Task 12: Lab Playwright + CHANGELOG + CLAUDE.md

**Files:**
- Modify: `lab/scenarios/baseline.js` or new `lab/scenarios/stockYList.js` if scenario fixtures need extension
- Create: `lab/playwright/stock-y-list.spec.ts` (or whatever naming convention exists)
- Modify: `CHANGELOG.md`, `packages/shared/CLAUDE.md`, `apps/florist/CLAUDE.md`, `apps/dashboard/CLAUDE.md`, root `CLAUDE.md` (if structure tables drift)

- [ ] **Step 1: Verify lab scenario seeds 4-tuple Variety rows; extend if not**

- [ ] **Step 2: Write Playwright spec** covering:
  - Type group expand/collapse
  - Variety expand reveals nested Stock Items
  - Tap-on-reserved-bucket → premade list
  - Tap-on-Batch row → modal opens (florist) / inline expands (dashboard)
  - "Show cleared rows" toggle hides/shows zero-qty rows
  - Write-off picker excludes Demand Entries, defaults to oldest

- [ ] **Step 3: Run `npm run lab:test:ui` — green output before commit**

- [ ] **Step 4: CHANGELOG + CLAUDE.md updates; commit**

---

## Self-review

- ✅ Spec coverage: helper (T1), backend aggregation (T2), exact-ID trace (T3), header components (T4-T7), trace UX seam (T8), write-off picker (T9), adoption (T10-T11), Playwright (T12).
- ✅ Pitfall #8 regression fixtures both encoded (T1).
- ⚠️ Cultivar visibility, "Show cleared rows" toggle, and "Show non-flower stock" toggle are wiring concerns landed in T10/T11.
- ⚠️ Backend write-off route may already accept stock_item_id; confirm in T9 to avoid net-new endpoint.

## Execution

Subagent-Driven Development. Sonnet implementer + spec-reviewer per task. Opus code-quality on T1, T8, T10, T11 (Pitfall #8 / cancel-with-return adjacency). Final opus review after T12.
