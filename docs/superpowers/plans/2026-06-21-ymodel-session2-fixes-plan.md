# Y-model Session-2 Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 8 change-requests captured in the 2026-06-21 Y-model owner test session (`2026-06-21-ymodel-test-session-2-crs.md`) — fixing the availability-bucket semantics, the new-demand order-submit flow, and the stock-panel layout, plus re-landing the crash fix already hot-patched on the lab.

**Architecture:** Four independent, individually-shippable slices, each its own `fix/*` or `feat/*` branch + PR off `master`. **S1 (availability model) lands before S2 (new-demand flow)** — S2's over-allocation gate and PO "free" caps read the numbers S1 corrects. S0 (crash re-land) and S3 (layout) are independent and can land in any order.

**Tech Stack:** Express + Postgres (Drizzle) backend; React + Vite shared component package consumed by florist + dashboard apps; Vitest everywhere; `STOCK_Y_MODEL` flag-gated.

## Global Constraints

- All work is **flag-gated behind `STOCK_Y_MODEL`** — never change legacy (flag-off) behavior.
- **Cross-app parity** (root CLAUDE.md): every picker/stock-view change ships in BOTH florist (`apps/florist`) and dashboard (`apps/dashboard`). Shared logic lives in `packages/shared`.
- **Stock can go negative by design** (pitfall #8) — negatives are a buy signal, never silently "fixed". `getEffectiveStock(qty)` returns `qty`; never inline `qty - committed`.
- **New shared utils/hooks require tests** in `packages/shared/test/` (CI enforces 80% line coverage on `utils/` + `hooks/`).
- UI strings via `t.xxx` (ru/en/pl) — no hardcoded user-facing text. Comments English.
- Pre-PR matrix per slice: `cd backend && npx vitest run` (if backend touched); `cd packages/shared && ../../backend/node_modules/.bin/vitest run` (if shared touched); **build all three apps** (`./node_modules/.bin/vite build` in florist, dashboard, delivery) when shared changes.
- Owner-decided semantics (this planning session, 2026-06-21) are baked in below — do not re-derive.

## Owner decisions locked this session
- **D-A (CR-04):** Availability line shows **On hand** = grabbable-now (currently the value labelled "Net") and **Available** = On hand + premade-reserved. Drop the "Committed" and "Net" labels. Premade shown as the On hand→Available gap.
- **D-B (CR-04):** Premade-reserved **reduces** On hand (Hydrangea: 28 physical, 6 premade → On hand 22, Available 28). Reclaimable — owner knows dissolving the premade frees them.
- **D-C (CR-01):** Over-allocation uses an **inline confirm** ("Only N available — create demand for M more?"), not a hard block.
- **D-D (CR-06):** The "From incoming PO" source appears **only for future-dated POs**; for a shown PO the "(N free)" must net existing demand. Overdue PO → not an addable source (owner creates a new PO / new demand instead).
- **D-E (CR-03):** Overdue planned arrivals still **count** toward incoming/effective in the informational stock view, but the date is **flagged overdue** (red).

---

## File Structure

**Shared (`packages/shared/`):**
- `utils/stockMath.js` — add `available` to `getVarietyAvailability` return; semantics unchanged for `net`/`onHand` (callers relabel). [S1]
- `components/VarietyAvailabilityLine.jsx` — relabel: `On hand {net} · [{reserved} Premade · Available {avail}] · [+inc <date overdue?> · Effective]`. [S1]
- `components/DateTag.jsx` — accept `overdue` styling. [S1]
- `components/VarietyAllocationPicker.jsx` — `buildSources` future-only PO + net free cap; `AllocationForm` price input + inline-confirm gate; carry Variety on the `fresh` selection. [S1 buildSources, S2 form]
- `utils/stockArrivals` (existing `arrivalsForVariety`) — tag arrivals future/overdue. [S1]
- `utils/stockAllocationEngine.js` — null-date guard (re-land of lab hot-patch). [S0]

**Florist (`apps/florist/src/`):** `components/steps/Step2Bouquet.jsx`, `components/BouquetEditor.jsx`, `components/VarietyListItem` host (`pages/StockPanelPage.jsx`). 
**Dashboard (`apps/dashboard/src/`):** `components/steps/Step2Bouquet.jsx`, `components/order/BouquetSection.jsx`, `components/StockTab.jsx`.
**Shared stock-panel:** `components/ShortfallSummary.jsx`, `components/PendingArrivalsPanel.jsx`, `components/VarietyListItem.jsx`. [S3 + S1]

**Backend (`backend/src/`):** no schema change. `routes/stock.js` `/premade-committed` already returns the reservation map S1 needs. `repos/orderRepo.js` orphan guard stays (S2 makes the frontend always supply an id).

---

## Slice S0 — Re-land the null-date crash fix (CR-02)

**Branch:** `fix/ymodel-null-date-sort-guard`

The lab hot-patch (`byDateAsc` in `stockAllocationEngine.js` + 3 tests) currently lives only on the throwaway octopus branch. Re-land on master and guard the other unguarded `.date.localeCompare` comparators of the same crash class.

**Files:**
- Modify: `packages/shared/utils/stockAllocationEngine.js` (port `byDateAsc`, both sorts)
- Modify: `packages/shared/components/WriteOffBatchPicker.jsx:46`, `BatchArrivalList.jsx:231`, `VarietyTracePanel.jsx:30`, `BatchTracePanel.jsx:31`, `PendingArrivalsPanel.jsx:60`
- Test: `packages/shared/test/stockAllocationEngine.test.js` (port fixture 8, 3 tests)

**Interfaces:**
- Produces: `byDateAsc(a, b)` — null-safe FIFO comparator (undated sorts last). Export it from a shared util (`utils/sortByDate.js`) so the 5 components import one implementation.

- [ ] **Step 1:** Create `packages/shared/utils/sortByDate.js` exporting `byDateAsc(a, b)` (undated last) and `byDateDesc(a, b)` (undated last). Add to `packages/shared/index.js` exports + the structure block in `packages/shared/CLAUDE.md`.

```js
// Null-safe date comparators for rows shaped { date: string|null }.
// Undated rows (legacy/orig Stock Items, dateless DEs) sort LAST so dated
// rows keep chronological order — never dereference null.localeCompare.
export function byDateAsc(a, b) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
}
export function byDateDesc(a, b) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return b.date.localeCompare(a.date);
}
```

- [ ] **Step 2:** Create `packages/shared/test/sortByDate.test.js` — cases: both dated asc/desc, one null sorts last (asc & desc), both null → 0. Run `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/sortByDate.test.js` → PASS.
- [ ] **Step 3:** In `stockAllocationEngine.js` replace the local `byDateAsc` (lab hot-patch) with an import from `./sortByDate.js`; both `sortedBatches`/`sortedDemands` use it. Keep fixture-8 tests. Run engine test → 38 PASS.
- [ ] **Step 4:** Replace the inline `(a,b)=>a.date.localeCompare(b.date)` / `b.date.localeCompare(a.date)` in the 5 components with `byDateAsc`/`byDateDesc` imports. (BatchArrivalList + PendingArrivalsPanel want desc/asc respectively — match existing direction.)
- [ ] **Step 5:** Build all three apps. Commit: `fix(stock): null-safe date sort guard across Y-model comparators (#CR-02)`.

---

## Slice S1 — Availability model rework (CR-04, CR-06, CR-03)

**Branch:** `feat/ymodel-availability-model`

Redefine what the availability line shows (On hand = grabbable, Available = + premade), wire real premade reservations into the picker + stock list (they're currently `new Map()`), make the incoming-PO source future-only with a demand-netted free cap, and flag overdue arrivals.

**Files:**
- Modify: `packages/shared/utils/stockMath.js` — `getVarietyAvailability` returns `available`
- Modify: `packages/shared/components/VarietyAvailabilityLine.jsx` — new labels
- Modify: `packages/shared/utils/stockMath.js` `arrivalsForVariety` — tag `overdue`
- Modify: `packages/shared/components/DateTag.jsx` — `overdue` style
- Modify: `packages/shared/components/VarietyAllocationPicker.jsx` — `buildSources`
- Modify (wiring, both apps): `Step2Bouquet.jsx`, `BouquetEditor.jsx`/`BouquetSection.jsx`, `StockPanelPage.jsx`/`StockTab.jsx`
- Tests: `stockMath.test.js`, `VarietyAvailabilityLine.test.jsx`, `VarietyAllocationPicker.test.jsx`

**Interfaces:**
- Produces: `getVarietyAvailability(rows, reservations, arrivals)` → adds `available: net + reserved` to the existing object (other fields unchanged).
- Produces: `arrivalsForVariety(rows, pendingPO, todayIso?)` → each arrival `{ date, qty, overdue: boolean }` (overdue = `date < todayIso`).
- Consumes (wiring): `GET /api/stock/premade-committed` → `{ stockId: { qty, bouquets } }` → build `Map(stockId → qty)`.

### Task S1.1 — `available` bucket in stockMath

- [ ] **Step 1:** Add failing test to `packages/shared/test/stockMath.test.js`:

```js
it('getVarietyAvailability exposes available = net + reserved', () => {
  const rows = [{ id: 'b', current_quantity: 28 }];
  const reservations = new Map([['b', 6]]);
  const a = getVarietyAvailability(rows, reservations, []);
  expect(a.net).toBe(22);        // grabbable now (onHand 28 − reserved 6)
  expect(a.reserved).toBe(6);
  expect(a.available).toBe(28);  // net + reserved (reclaimable premade)
});
```

- [ ] **Step 2:** Run `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/stockMath.test.js` → FAIL (`available` undefined).
- [ ] **Step 3:** In `getVarietyAvailability` return, add `available: net + reserved`:

```js
return { onHand, committed, reserved, incoming, net, available: net + reserved, effective: net + incoming, arrivals: sortedArrivals };
```

- [ ] **Step 4:** Run test → PASS. Run full `stockMath.test.js` → all PASS.
- [ ] **Step 5:** Commit: `feat(stock): add available bucket (net + premade) to variety availability`.

### Task S1.2 — Overdue tagging in arrivalsForVariety

- [ ] **Step 1:** Failing test in `stockMath.test.js`:

```js
it('arrivalsForVariety tags overdue when planned date is in the past', () => {
  const rows = [{ id: 's' }];
  const pendingPO = { s: { pos: [{ quantity: 20, plannedDate: '2026-06-16' }] } };
  const [arr] = arrivalsForVariety(rows, pendingPO, '2026-06-21');
  expect(arr).toMatchObject({ qty: 20, date: '2026-06-16', overdue: true });
});
```

- [ ] **Step 2:** Run → FAIL. 
- [ ] **Step 3:** Add optional `todayIso` param; set `overdue: todayIso ? String(date) < String(todayIso) : false` on each pushed arrival. Default param keeps existing callers working (overdue:false).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task S1.3 — Relabel VarietyAvailabilityLine (D-A, D-B, D-E)

New render: `On hand {net} · [{reserved} Premade · Available {available}] · [ +{incoming} <DateTag overdue?> · Effective {effective} ]`. Premade+Available shown only when `reserved > 0`. `On hand` amber when `< 0`.

- [ ] **Step 1:** Update `packages/shared/test/VarietyAvailabilityLine.test.jsx`:

```jsx
it('shows On hand and Available with the premade gap', () => {
  render(<VarietyAvailabilityLine availability={{ net: 22, reserved: 6, available: 28, incoming: 0, effective: 22, arrivals: [] }} />);
  expect(screen.getByTestId('avail-onhand')).toHaveTextContent('22');
  expect(screen.getByText(/6/)).toBeInTheDocument();      // premade
  expect(screen.getByTestId('avail-available')).toHaveTextContent('28');
  expect(screen.queryByText(/Committed/)).toBeNull();      // dropped
});
it('hides Premade/Available when nothing reserved', () => {
  render(<VarietyAvailabilityLine availability={{ net: 9, reserved: 0, available: 9, incoming: 0, effective: 9, arrivals: [] }} />);
  expect(screen.getByTestId('avail-onhand')).toHaveTextContent('9');
  expect(screen.queryByTestId('avail-available')).toBeNull();
});
```

- [ ] **Step 2:** Run `../../backend/node_modules/.bin/vitest run test/VarietyAvailabilityLine.test.jsx` → FAIL.
- [ ] **Step 3:** Rewrite the component body:

```jsx
const { net = 0, reserved = 0, available = 0, incoming = 0, effective = 0, arrivals = [] } = availability || {};
const firstArrival = arrivals[0] ?? null;
const onHandClass = net < 0 ? 'text-amber-600' : 'text-gray-900';
return (
  <div data-testid="variety-availability" className="text-sm text-gray-500 flex flex-wrap items-center gap-x-1.5">
    <span><span data-testid="avail-onhand" className={`font-semibold ${onHandClass}`}>{net}</span> {t.onHand ?? 'On hand'}</span>
    {reserved > 0 && (
      <>
        <span>· {reserved} {t.premade ?? 'Premade'}</span>
        <span>· <span data-testid="avail-available" className="font-medium text-gray-900">{available}</span> {t.available ?? 'Available'}</span>
      </>
    )}
    {incoming > 0 && (
      <span data-testid="avail-incoming" className="flex items-center gap-x-1">
        · <span className="text-blue-600 font-medium">+{incoming}</span>
        {firstArrival?.date && <DateTag date={firstArrival.date} kind="arriving" overdue={firstArrival.overdue} compact t={t} />}
        · <span className="font-medium text-gray-900">{effective}</span> {t.effective ?? 'Effective'}
      </span>
    )}
  </div>
);
```

- [ ] **Step 4:** Update the JSDoc header (replace the old `On hand · Committed · Reserved · Net` description). Add `premade`/`available` keys to florist + dashboard `translations.js` (ru: «Премейд»/«Доступно», en: «Premade»/«Available», pl per existing). Run tests → PASS.
- [ ] **Step 5:** `DateTag` — when `overdue`, render red. Add a `DateTag.test` case. Commit.

### Task S1.4 — Wire premade reservations into the picker + bouquet list (both apps)

The Step2Bouquet/BouquetEditor surfaces pass `new Map()` → premades never show. Fetch `/stock/premade-committed`, build a `Map(stockId → qty)`, pass it everywhere `getVarietyAvailability`/`VarietyAllocationPicker` is called.

- [ ] **Step 1:** In florist `Step2Bouquet.jsx`, add state `const [reservations, setReservations] = useState(new Map())`; in the effect that loads `pendingPO`, also `client.get('/stock/premade-committed')` → `setReservations(new Map(Object.entries(data).map(([id, v]) => [id, v.qty])))`.
- [ ] **Step 2:** Replace the two `new Map()` args (lines ~356, ~377) and the `<VarietyAllocationPicker reservations={new Map()}>` (line ~899) with `reservations`.
- [ ] **Step 3:** Repeat in florist `BouquetEditor.jsx` and dashboard `Step2Bouquet.jsx` + `BouquetSection.jsx`.
- [ ] **Step 4:** Manual-equivalent test: extend `VarietyAllocationPicker.test.jsx` to assert that when `reservations` has an entry, the expanded variety's availability reflects it (Available > On hand).
- [ ] **Step 5:** Build all three apps. Commit: `feat(stock): surface premade reservations in bouquet picker + list (CR-04)`.

### Task S1.5 — buildSources: future-only PO + demand-netted free cap (D-D, CR-06)

- [ ] **Step 1:** Add failing `buildSources` tests in `VarietyAllocationPicker.test.jsx`:

```js
it('incoming PO free cap nets existing demand', () => {
  const avail = { incoming: 7, effective: 0, net: -7, arrivals: [{ date: '2026-07-01', qty: 7, overdue: false }] };
  const src = buildSources([], avail, {}).find(s => s.value === 'incoming');
  expect(src.available).toBe(0);            // demand eats the PO → 0 free
});
it('omits the incoming PO source when the PO is overdue', () => {
  const avail = { incoming: 7, effective: 0, net: -7, arrivals: [{ date: '2026-06-16', qty: 7, overdue: true }] };
  expect(buildSources([], avail, {}).find(s => s.value === 'incoming')).toBeUndefined();
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In the incoming branch of `buildSources`: skip when the first arrival is `overdue`; set `available: Math.max(0, Math.min(availability.incoming, availability.effective))`.

```js
const firstArr = availability.arrivals?.[0];
if ((availability?.incoming ?? 0) > 0 && firstArr && !firstArr.overdue) {
  list.push({
    value: 'incoming',
    label: `${t.srcIncoming ?? 'From incoming PO'} +${availability.incoming}${firstArr.date ? ` → ${formatDateDMY(firstArr.date)}` : ''}`,
    available: Math.max(0, Math.min(availability.incoming, availability.effective)),
    selection: { kind: 'fresh' },
  });
}
```

- [ ] **Step 4:** Run → PASS. Verify the AllocationForm shows `(0 free)` for a fully-claimed future PO (the dropdown label already appends `(N free)`).
- [ ] **Step 5:** Commit.

### Task S1.6 — Stock-panel view shows the availability line (CR-03)

- [ ] **Step 1:** In `VarietyListItem.jsx`, render `<VarietyAvailabilityLine availability={...} />` (or its buckets) in the row header, fed by `getVarietyAvailability(rows, reservations, arrivalsForVariety(rows, pendingPO, todayIso))`. Pass `reservations` + `pendingPO` from `StockPanelPage.jsx` (florist) and `StockTab.jsx` (dashboard) — both already fetch `/stock/premade-committed` for the flat-table `+N Reserved`.
- [ ] **Step 2:** Decide visibility: always show On hand; show Available/Premade only when `reserved > 0`; show incoming/effective only when `incoming > 0`.
- [ ] **Step 3:** Component test: `VarietyListItem.test.jsx` asserts the line renders with incoming + overdue flag.
- [ ] **Step 4:** Build all three apps. Commit: `feat(stock): show net+premade+incoming availability in stock panel (CR-03)`.
- [ ] **Step 5:** Update `project_ymodel_cr_decisions_2026_06_12` memory — D5 ("committed" visible) is superseded by D-A/D-B.

---

## Slice S2 — New-demand allocation flow (CR-08, CR-07, CR-01)

**Branch:** `feat/ymodel-new-demand-flow`. **Depends on S1.**

Make "New demand" create a real DE stock row (fixing the orphan submit blocker), let the owner price it, and gate accidental over-allocation with an inline confirm.

**Files:**
- Modify: `packages/shared/components/VarietyAllocationPicker.jsx` — `AllocationForm` (price input + confirm gate), carry Variety on `fresh` selection in `buildSources`
- Modify: `apps/florist/src/components/steps/Step2Bouquet.jsx` + `apps/dashboard/src/components/steps/Step2Bouquet.jsx` — `onSelectStock` `fresh` creates a DE row
- Modify: `apps/florist/src/components/BouquetEditor.jsx` + `apps/dashboard/src/components/order/BouquetSection.jsx` — same `fresh` path (edit flow already has `createDemandEntry`; ensure picker `fresh` routes through it)
- Tests: `VarietyAllocationPicker.test.jsx`

**Interfaces:**
- Produces: `onSelectStock(selection, amount, opts?)` where `opts = { sellPrice?, costPrice?, confirmNegative?: true }`. Hosts create a DE stock row for `selection.kind === 'fresh'` and attach its id.
- Produces: `buildSources` `fresh` selection carries `{ kind: 'fresh', variety }` (the expanded Variety 4-tuple) so the host knows what to create.

### Task S2.1 — `fresh` selection carries the Variety

- [ ] **Step 1:** Failing test: `buildSources(..).find(s=>s.value==='fresh').selection.variety` equals the passed variety.
- [ ] **Step 2:** `buildSources` gains a `variety` param (the expanded Variety key); fresh + incoming selections become `{ kind: 'fresh', variety }`. `AllocationForm` passes the expanded variety in. Run → PASS.

### Task S2.2 — AllocationForm: price input for fresh lines (CR-07)

- [ ] **Step 1:** Failing test: when the selected source is `fresh`, a `data-testid="alloc-sell"` input renders; `onAdd` is called with `{ sellPrice }`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `AllocationForm`, when `selected.selection.kind === 'fresh'`, render a Sell-price (and Cost-price) number input (default empty/0). Pass through: `onAdd(selected.selection, Math.max(1, amt), { sellPrice, costPrice })`.
- [ ] **Step 4:** Run → PASS. Add `allocSellPrice`/`allocCostPrice` translation keys (ru/en/pl).
- [ ] **Step 5:** Commit.

### Task S2.3 — Inline-confirm over-allocation gate (CR-01, D-C)

- [ ] **Step 1:** Failing test: with a capped source where `amount > available`, clicking Add does **not** immediately call `onAdd`; a confirm element appears; confirming calls `onAdd(selection, amount, { confirmNegative: true })`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `AllocationForm`, track `const [pendingConfirm, setPendingConfirm] = useState(false)`. On Add: if `selected.available != null && amt > selected.available` and not yet confirmed → `setPendingConfirm(true)` and render an inline confirm row: `{t.allocShortConfirm}` interpolating `available` + `amt - available`, with `[Create demand]` / `[Cancel]`. Confirm → `onAdd(..., { confirmNegative: true })`. Uncapped sources (`available == null`, i.e. New demand) bypass the gate.
- [ ] **Step 4:** Run → PASS. Add `allocShortConfirm` etc. (ru: «В наличии только {n}. Создать дефицит на {m}?»).
- [ ] **Step 5:** Commit.

### Task S2.4 — Hosts create a DE stock row for `fresh` (CR-08 blocker)

- [ ] **Step 1:** In florist `Step2Bouquet.jsx` `onSelectStock`, replace the `kind === 'fresh'` branch (currently pushes `{ stockItemId: null }`) with: POST `/stock` using `picked.variety` 4-tuple (mirror the existing `onCreateVariety` at `:947`), then `addOne({ id: res.data.id, ... }, add)` with the typed `sellPrice`/`costPrice`. On failure → toast the backend error, do not add an orphan line.

```js
if (picked?.kind === 'fresh') {
  const v = picked.variety || {};
  try {
    const res = await client.post('/stock', {
      displayName: varietyDisplayName(v) || picked.date || '',
      typeName: v.type_name ?? null, colour: v.colour ?? null,
      sizeCm: v.size_cm ?? null, cultivar: v.cultivar ?? null,
      costPrice: opts?.costPrice ?? 0, sellPrice: opts?.sellPrice ?? 0, quantity: 0,
    });
    onStockRefresh?.();
    addOne({ id: res.data.id, 'Display Name': res.data['Display Name'],
             'Current Cost Price': opts?.costPrice ?? 0, 'Current Sell Price': opts?.sellPrice ?? 0 }, add);
  } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
  setYPickerOpen(false); return;
}
```

- [ ] **Step 2:** Make `onSelectStock` `async` and accept the 3rd `opts` arg. Remove the green "STOCK" tag path for null-`stockItemId` lines (no longer produced).
- [ ] **Step 3:** Mirror in dashboard `Step2Bouquet.jsx`. For `BouquetEditor.jsx`/`BouquetSection.jsx`, route the picker `fresh` selection through the existing `useOrderEditing.createDemandEntry` (passes price + creates the row already).
- [ ] **Step 4:** Manual verification scenario (lab): add a "New demand" Peony line → Submit → order created, DE row exists, line bound to its id. Confirm via `/stock` + order lines.
- [ ] **Step 5:** Build all three apps. Commit: `fix(orders): New demand creates a real demand entry so submit succeeds (CR-08)`.

### Task S2.5 — Backend regression lock

- [ ] **Step 1:** Add an integration test to `backend/src/__tests__/orderRepo.integration.test.js`: creating an order whose line points at a freshly-created DE stock row (qty 0, typed Variety) succeeds and deepens the DE via step 3b (no orphan rejection). Run `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js` → PASS.
- [ ] **Step 2:** Commit.

---

## Slice S3 — Stock-panel column alignment (CR-05)

**Branch:** `fix/stock-panel-column-alignment`. Independent.

**Files:** `packages/shared/components/ShortfallSummary.jsx`, `PendingArrivalsPanel.jsx`, and the flat-table grid in `apps/florist/src/pages/StockPanelPage.jsx` / `apps/dashboard/src/components/StockTab.jsx`.

- [ ] **Step 1:** Define a shared `grid-template-columns` (e.g. a constant or a Tailwind grid class) covering: Type | Variety | amount(right). Apply it as the row layout in all three sections so Type/Variety left edges and the stem-amount column align vertically across Shortfalls, Pending Arrivals, and the Flat table.
- [ ] **Step 2:** Keep the three as visually distinct cards (existing borders/headers) — only the inner column grid is unified.
- [ ] **Step 3:** Visual check on the lab dev server (both apps). Pure layout — no logic/test change, but run existing component tests to confirm no breakage.
- [ ] **Step 4:** Build all three apps. Commit: `fix(stock): align columns across Shortfalls / Pending Arrivals / Flat table (CR-05)`.

---

## Self-Review

- **Coverage:** CR-01→S2.3, CR-02→S0, CR-03→S1.2/S1.6, CR-04→S1.1/S1.3/S1.4, CR-05→S3, CR-06→S1.5, CR-07→S2.2, CR-08→S2.4/S2.5. All 8 mapped.
- **Sequencing:** S1 before S2 (gate + free caps read S1's numbers). S0/S3 independent.
- **Type consistency:** `getVarietyAvailability` adds `available` (S1.1) consumed by VarietyAvailabilityLine (S1.3) + buildSources (S1.5); `arrivalsForVariety` adds `overdue` (S1.2) consumed by buildSources (S1.5) + DateTag (S1.3); `onSelectStock(selection, amount, opts)` defined S2.1 consumed S2.2/2.3/2.4.
- **Open micro-decisions deferred to execution (non-blocking):** exact ru/pl copy for new keys; whether the stock-panel line shows Effective inline or on tap.
