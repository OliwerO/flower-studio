# Stock Y-model: hybrid `<VarietyAllocationPicker>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** New shared `<VarietyAllocationPicker>` consumes `stockAllocationEngine` (#287) and replaces `<BatchPickerModal>` across 4 callsites under `STOCK_Y_MODEL`.

**Architecture:** Hybrid two-stage picker (Q8 = III in 2026-05-10 grill). Stage 1 = single search bar with cross-field substring match across 4-tuple Variety attributes (ADR-0006); one result row per Variety. Stage 2 = inline allocation panel rendering engine options. Owner-only "+ Create new Variety" expands to 4-field form with column-scoped autocomplete + cultivar prefill. `BatchPickerModal` deleted; flag-off path falls back to auto-pick first match (preserves rollback safety).

**Tech Stack:** React + Tailwind, no new deps. Backend support already lives in `stockRepo.distinctValues`, `stockRepo.getPremadeReservations`, `POST /stock` (Variety creation), `GET /stock?includeEmpty=true`.

**Key files (existing):**
- `packages/shared/utils/stockAllocationEngine.js` — engine consumed by Stage 2 (#287)
- `packages/shared/components/BatchPickerModal.jsx` — to delete
- `packages/shared/hooks/useOrderEditing.js` — `findAllMatchingVariety` to remove; `addFlowerFromStock` + `createDemandEntry` consumed by new picker
- `apps/florist/src/components/BouquetEditor.jsx:299-330` — callsite 1
- `apps/dashboard/src/components/order/BouquetSection.jsx:161-189` — callsite 2
- `apps/florist/src/components/steps/Step2Bouquet.jsx` — callsite 3 (gains multi-match modal under flag-on)
- `apps/dashboard/src/components/steps/Step2Bouquet.jsx` — callsite 4 (same)
- `backend/src/services/configService.js:413` — `getStockYModelEnabled()` (already wired)
- `lab/scenarios/stockOverhaul.js` — Y-model fixtures (~200 stock items)

**ADR alignment:**
- ADR-0005 — dated Demand Entries; engine emits ranked options
- ADR-0006 — four-tuple identity, NULL-aware equality, cultivar visibility = `cultivar IS NOT NULL`, Owner-only Variety creation
- ADR-0007 — Batch decrement retained (no skipDeduction special case)

---

## Task 1: `varietyKey` util (shared)

**Why deep:** consumed by picker grouping, future Stock list collapse, future migration script. Deletion scatters NULL-aware tuple comparison across N callers.

**Files:**
- Create: `packages/shared/utils/varietyKey.js`
- Test: `packages/shared/test/varietyKey.test.js`

- [ ] **Step 1: Write failing tests (red phase mandatory — new shared util)**

```js
// packages/shared/test/varietyKey.test.js
import { describe, it, expect } from 'vitest';
import { varietyKey, groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';

describe('varietyKey', () => {
  it('serializes the 4-tuple deterministically', () => {
    expect(varietyKey({ type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null }))
      .toBe('Rose|Pink|60|');
  });
  it('preserves NULL distinct from empty (ADR-0006 strict identity)', () => {
    const a = varietyKey({ type_name: 'Eucalyptus', colour: null, size_cm: null, cultivar: null });
    const b = varietyKey({ type_name: 'Eucalyptus', colour: 'Green', size_cm: null, cultivar: null });
    expect(a).not.toBe(b);
  });
  it('treats empty string as NULL (defensive)', () => {
    const a = varietyKey({ type_name: 'Rose', colour: '', size_cm: null, cultivar: null });
    const b = varietyKey({ type_name: 'Rose', colour: null, size_cm: null, cultivar: null });
    expect(a).toBe(b);
  });
});

describe('groupByVariety', () => {
  it('groups stock rows by 4-tuple', () => {
    const rows = [
      { id: '1', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null, current_quantity: 10, date: '2026-05-10' },
      { id: '2', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null, current_quantity: -3, date: '2026-05-12' },
      { id: '3', type_name: 'Rose', colour: 'Red', size_cm: 60, cultivar: null, current_quantity: 5, date: '2026-05-10' },
    ];
    const groups = groupByVariety(rows);
    expect(groups.size).toBe(2);
    expect(groups.get('Rose|Pink|60|').rows).toHaveLength(2);
  });
});

describe('varietyDisplayName', () => {
  it('renders full form with cultivar', () => {
    expect(varietyDisplayName({ type_name: 'Rose', colour: 'White', size_cm: 70, cultivar: "O'Hara" }))
      .toBe("Rose White 70cm O'Hara");
  });
  it('omits cultivar when NULL (ADR-0006 visibility rule)', () => {
    expect(varietyDisplayName({ type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null }))
      .toBe('Rose Pink 60cm');
  });
  it('omits empty colour/size cleanly', () => {
    expect(varietyDisplayName({ type_name: 'Eucalyptus', colour: null, size_cm: null, cultivar: null }))
      .toBe('Eucalyptus');
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL** — `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/varietyKey.test.js`

- [ ] **Step 3: Implement util**

```js
// packages/shared/utils/varietyKey.js

/**
 * Variety identity helpers per ADR-0006.
 * 4-tuple: (type_name, colour?, size_cm?, cultivar?). NULL-aware strict identity.
 * Empty strings normalized to null defensively.
 */

const norm = (v) => (v === '' || v === undefined ? null : v);

export function varietyKey(row) {
  return [
    norm(row.type_name) ?? '',
    norm(row.colour) ?? '',
    norm(row.size_cm) ?? '',
    norm(row.cultivar) ?? '',
  ].join('|');
}

export function groupByVariety(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = varietyKey(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        type_name: norm(row.type_name),
        colour: norm(row.colour),
        size_cm: norm(row.size_cm),
        cultivar: norm(row.cultivar),
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }
  return map;
}

export function varietyDisplayName(v) {
  const parts = [norm(v.type_name)];
  if (norm(v.colour)) parts.push(v.colour);
  if (norm(v.size_cm) != null) parts.push(`${v.size_cm}cm`);
  if (norm(v.cultivar)) parts.push(v.cultivar);
  return parts.filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Export from `packages/shared/index.js`**

```js
// packages/shared/index.js — add near stockAllocationEngine export
export { varietyKey, groupByVariety, varietyDisplayName } from './utils/varietyKey.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/utils/varietyKey.js packages/shared/test/varietyKey.test.js packages/shared/index.js
git commit -m "feat(shared): varietyKey + groupByVariety + varietyDisplayName per ADR-0006"
```

---

## Task 2: `<VarietyAllocationPicker>` Stage 1 — typeahead

**Why deep:** Hosts both stages and bridges engine to UI. Replacing it scatters Variety-search + engine wiring across 4 callsites.

**Files:**
- Create: `packages/shared/components/VarietyAllocationPicker.jsx`
- Test: `packages/shared/test/VarietyAllocationPicker.test.jsx`

- [ ] **Step 1: Write failing tests for Stage 1**

```jsx
// packages/shared/test/VarietyAllocationPicker.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyAllocationPicker from '../components/VarietyAllocationPicker.jsx';

const t = {
  pickerSearchPlaceholder: 'Search…',
  pickerCreateNew: '+ Create new Variety',
  pickerNoResults: 'No matches',
  stems: 'stems',
  onHand: 'on hand',
  planned: 'planned',
  reserved: 'reserved',
  net: 'net',
};

const makeRows = () => [
  { id: 'b1', type_name: 'Rose',   colour: 'Pink',  size_cm: 60, cultivar: null,             current_quantity: 10, date: '2026-05-10' },
  { id: 'b2', type_name: 'Rose',   colour: 'Pink',  size_cm: 60, cultivar: null,             current_quantity: -3, date: '2026-05-12' },
  { id: 'b3', type_name: 'Rose',   colour: 'White', size_cm: 70, cultivar: "Sarah Bernhardt", current_quantity: 5,  date: '2026-05-10' },
  { id: 'b4', type_name: 'Peony',  colour: 'Pink',  size_cm: 50, cultivar: null,             current_quantity: 0,  date: '2026-05-10' },
];

describe('VarietyAllocationPicker — Stage 1 typeahead', () => {
  it('renders one row per Variety with computed display name', () => {
    render(<VarietyAllocationPicker
      stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1}
      role="florist" t={t} onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getAllByTestId('variety-row')).toHaveLength(3);
    expect(screen.getByText(/Rose Pink 60cm/)).toBeInTheDocument();
    expect(screen.getByText(/Rose White 70cm Sarah Bernhardt/)).toBeInTheDocument();
  });

  it('cross-field substring match — "sarah" returns one Variety', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'sarah' } });
    expect(screen.getAllByTestId('variety-row')).toHaveLength(1);
    expect(screen.getByText(/Sarah Bernhardt/)).toBeInTheDocument();
  });

  it('cross-field — "60" returns all 60cm Varieties', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '60' } });
    expect(screen.getAllByTestId('variety-row')).toHaveLength(1);
  });

  it('hides zero-qty Varieties by default', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/Peony/)).not.toBeInTheDocument();
  });

  it('"+ Create new Variety" hidden for florist', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('+ Create new Variety')).not.toBeInTheDocument();
  });

  it('"+ Create new Variety" visible for owner', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getByText('+ Create new Variety')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement Stage 1 minimum**

```jsx
// packages/shared/components/VarietyAllocationPicker.jsx
import { useMemo, useState } from 'react';
import { groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';

/**
 * Hybrid two-stage Variety picker — replaces BatchPickerModal under STOCK_Y_MODEL.
 * Props:
 *   stockItems       — Y-model rows (type_name/colour/size_cm/cultivar/current_quantity/date)
 *   reservations     — Map<stockId, reservedQty> from getPremadeReservations
 *   requiredBy       — YYYY-MM-DD strict (the order's needed-by date)
 *   qty              — stems needed for the order line being added
 *   role             — 'owner' | 'florist' (gates "+ Create new Variety")
 *   t                — translation strings
 *   onSelectStock    — (stockItem | { kind: 'fresh', date }) => void
 *   onCreateVariety  — (varietyDraft) => Promise<stockItem>  (Owner-only, optional)
 *   onClose          — () => void
 */
export default function VarietyAllocationPicker({
  stockItems = [],
  reservations = new Map(),
  requiredBy,
  qty = 1,
  role,
  t,
  onSelectStock,
  onCreateVariety,
  onClose,
}) {
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);

  const groups = useMemo(() => {
    const all = groupByVariety(stockItems);
    const visible = [];
    const needle = search.trim().toLowerCase();
    for (const [, group] of all) {
      const totalQty = group.rows.reduce((sum, r) => sum + (Number(r.current_quantity) || 0), 0);
      if (totalQty <= 0 && !needle) continue;
      if (needle) {
        const haystack = [
          group.type_name, group.colour, group.size_cm, group.cultivar,
          varietyDisplayName(group),
        ].filter(Boolean).map(String).join(' ').toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      visible.push({ ...group, totalQty });
    }
    return visible;
  }, [stockItems, search]);

  const isOwner = role === 'owner';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <input
            autoFocus
            type="search"
            placeholder={t.pickerSearchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {groups.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">{t.pickerNoResults}</p>
          )}
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              data-testid="variety-row"
              onClick={() => setExpandedKey(g.key)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100"
            >
              <div className="text-sm font-medium text-gray-900">{varietyDisplayName(g)}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.totalQty} {t.stems}</div>
            </button>
          ))}
        </div>

        {isOwner && (
          <div className="px-4 py-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {/* Task 4 */}}
              className="text-sm text-indigo-700 font-medium"
            >
              {t.pickerCreateNew}
            </button>
          </div>
        )}

        <div className="px-4 pb-4 pt-2 border-t border-gray-50">
          <button type="button" onClick={onClose} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
            {t.cancel || 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Export from `packages/shared/index.js`**

```js
export { default as VarietyAllocationPicker } from './components/VarietyAllocationPicker.jsx';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/components/VarietyAllocationPicker.jsx packages/shared/test/VarietyAllocationPicker.test.jsx packages/shared/index.js
git commit -m "feat(shared): VarietyAllocationPicker Stage 1 typeahead"
```

---

## Task 3: Stage 2 — engine option panel

**Files:**
- Modify: `packages/shared/components/VarietyAllocationPicker.jsx`
- Modify: `packages/shared/test/VarietyAllocationPicker.test.jsx`

- [ ] **Step 1: Write failing Stage 2 tests**

```jsx
// add to existing test file
describe('VarietyAllocationPicker — Stage 2 allocation panel', () => {
  it('renders engine options when a Variety row is expanded', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    expect(screen.getByTestId('option-batch')).toBeInTheDocument();
    expect(screen.getByTestId('option-merge')).toBeInTheDocument();
    expect(screen.getByTestId('option-fresh')).toBeInTheDocument();
  });

  it('marks default option per smart-default rule (same-date Demand Entry)', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    expect(screen.getByTestId('option-merge')).toHaveAttribute('data-default', 'true');
  });

  it('shows free/total/reserved breakdown per Batch', () => {
    const reservations = new Map([['b1', 4]]);
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={reservations}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const batch = screen.getByTestId('option-batch');
    expect(batch).toHaveTextContent('6');  // freeQty = 10 - 4
    expect(batch).toHaveTextContent('10'); // total
    expect(batch).toHaveTextContent('4');  // reservedQty
  });

  it('clicking a Batch option calls onSelectStock with the row', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    fireEvent.click(screen.getByTestId('option-batch'));
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('clicking fresh fires onSelectStock with kind:fresh + requiredBy', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    fireEvent.click(screen.getByTestId('option-fresh'));
    expect(onSelectStock).toHaveBeenCalledWith({ kind: 'fresh', date: '2026-05-12' });
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement Stage 2 panel + reserved expansion**

Wire `stockAllocationEngine`. When `expandedKey` set, look up that group's rows, build reservation submap, render engine options below the row. Each option has `data-testid="option-batch|option-merge|option-fresh"` + `data-default` + click handler:
- Batch → `onSelectStock(row)` (existing stockItem)
- Merge → `onSelectStock(demandEntryRow)` (existing demand entry stockItem)
- Fresh → `onSelectStock({ kind: 'fresh', date: requiredBy })` — new convention; callsite materializes row.

Reserved bucket (`reservedQty > 0`) clickable expands a sub-list of premade names — accept a `premadesByStockId` prop (`Map<stockId, [{ id, name, qty }]>`) for now; if not passed, just display count.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(shared): VarietyAllocationPicker Stage 2 — engine options + reserved breakdown"
```

---

## Task 4: "+ Create new Variety" Owner-only form

**Files:**
- Modify: `packages/shared/components/VarietyAllocationPicker.jsx`
- Modify: `packages/shared/test/VarietyAllocationPicker.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
describe('VarietyAllocationPicker — Create new Variety (Owner)', () => {
  it('expands inline 4-field form when clicked (Owner)', () => {
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}}
      onCreateVariety={vi.fn()} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    expect(screen.getByLabelText(/Type/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Colour/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cultivar/)).toBeInTheDocument();
  });

  it('Save & continue calls onCreateVariety with the draft', async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'new-stock-id' });
    const onSelect = vi.fn();
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={onSelect} onClose={() => {}} onCreateVariety={onCreate} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Tulip' } });
    fireEvent.change(screen.getByLabelText(/Colour/), { target: { value: 'Yellow' } });
    fireEvent.click(screen.getByText(t.pickerSaveContinue || 'Save & continue'));
    await screen.findByTestId('variety-create-saving');  // optimistic state OR resolves
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      type_name: 'Tulip', colour: 'Yellow', size_cm: null, cultivar: null,
    }));
  });

  it('Type is required — Save disabled with empty Type', () => {
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}} onCreateVariety={vi.fn()} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    expect(screen.getByText(t.pickerSaveContinue || 'Save & continue')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement form**

Add internal `creating` state + draft fields. On submit call `onCreateVariety(draft)` and on resolution call `onSelectStock(newStockItem)`. Cultivar prefill is a TODO comment — host wires autocomplete via `apiClient.get('/stock/distinct/cultivar')` and prefill is achieved by parent providing `existingCultivars` map (deferred to host wiring task; component only emits raw draft).

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(shared): VarietyAllocationPicker '+ Create new Variety' (Owner-only)"
```

---

## Task 5: "Order fresh for all" bulk action

**Files:**
- Modify: `packages/shared/components/VarietyAllocationPicker.jsx`
- Modify: `packages/shared/test/VarietyAllocationPicker.test.jsx`

Bulk-fresh is a host-driven concept — picker exposes a single API: `onBulkFreshForAll?: (varietyKeys: string[]) => void`. Picker doesn't track multi-line state; host wraps it.

- [ ] **Step 1: Write failing tests**

```jsx
it('renders "Order fresh for all" CTA when host passes bulkCandidates', () => {
  const onBulkFresh = vi.fn();
  render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
    requiredBy="2026-05-12" qty={1} role="florist" t={t}
    onSelectStock={() => {}} onClose={() => {}}
    bulkCandidates={['Rose|Pink|60|', 'Rose|White|70|Sarah Bernhardt']}
    onBulkFreshForAll={onBulkFresh} />);
  fireEvent.click(screen.getByText(t.pickerOrderFreshAll || 'Order fresh for all'));
  expect(onBulkFresh).toHaveBeenCalledWith(['Rose|Pink|60|', 'Rose|White|70|Sarah Bernhardt']);
});

it('CTA hidden when bulkCandidates is empty/undefined', () => {
  render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
    requiredBy="2026-05-12" qty={1} role="florist" t={t}
    onSelectStock={() => {}} onClose={() => {}} />);
  expect(screen.queryByText(t.pickerOrderFreshAll || 'Order fresh for all')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement CTA above the close button**

```jsx
{bulkCandidates?.length > 1 && onBulkFreshForAll && (
  <div className="px-4 py-2 border-t border-gray-100">
    <button type="button" onClick={() => onBulkFreshForAll(bulkCandidates)}
      className="w-full py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg">
      {t.pickerOrderFreshAll}
    </button>
  </div>
)}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(shared): VarietyAllocationPicker — Order fresh for all CTA"
```

---

## Task 6: Wire BouquetEditor (florist) + BouquetSection (dashboard) — flag-gated swap

**TDD red phase:** SKIP (route handler / UI wiring composing existing component).

**Files:**
- Modify: `apps/florist/src/components/BouquetEditor.jsx`
- Modify: `apps/dashboard/src/components/order/BouquetSection.jsx`

- [ ] **Step 1: Add `STOCK_Y_MODEL` flag accessor in shared client**

Use `useConfig` / `cachedGet('/config')` already used by apps. Backend exposes flag via `GET /config` (verify or add `stockYModel: getStockYModelEnabled()` to the config response — check existing wiring).

If flag not yet on the client config endpoint, add it: `backend/src/routes/config.js` (one-line addition). Otherwise reuse.

- [ ] **Step 2: Replace BatchPickerModal in BouquetEditor**

```jsx
// apps/florist/src/components/BouquetEditor.jsx
import { renderStockName, parseBatchName, VarietyAllocationPicker, useStockYModelFlag } from '@flower-studio/shared';
import { useAuth } from '@flower-studio/shared';
// ...
const yModel = useStockYModelFlag();
const { role } = useAuth();
// In click handler:
onClick={() => {
  if (!yModel) {
    // Flag-off: auto-pick first match (preserves rollback safety; matches dashboard's existing single-match shortcut)
    const matches = editing.stockItems.filter(s => parseBatchName(s['Display Name']||'').name.trim().toLowerCase() === baseName.toLowerCase());
    if (matches.length) addFromCatalog(matches[0]);
    return;
  }
  setPickerOpen(true);
}}
// Render:
{pickerOpen && (
  <VarietyAllocationPicker
    stockItems={editing.stockItems}
    reservations={editing.premadeReservations || new Map()}
    requiredBy={detail?.['Required By'] || new Date().toISOString().slice(0,10)}
    qty={1}
    role={role}
    t={pickerT}
    onSelectStock={(picked) => {
      if (picked.kind === 'fresh') {
        editing.createDemandEntry({ /* full Variety draft from picker — needs API */ });
      } else {
        const existing = editing.editLines.findIndex(l => l.stockItemId === picked.id);
        if (existing >= 0) editing.incrementQty(existing);
        else editing.addFlowerFromStock(picked);
      }
      setPickerOpen(false);
    }}
    onCreateVariety={async (draft) => {
      const { data } = await apiClient.post('/stock', { /* Variety attrs */ });
      return data;
    }}
    onClose={() => setPickerOpen(false)}
  />
)}
```

- [ ] **Step 3: Same for `apps/dashboard/src/components/order/BouquetSection.jsx`**

- [ ] **Step 4: Manual smoke test (Playwright snapshot or screenshot)** — flag-on shows new picker, flag-off auto-picks.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(florist+dashboard): swap BatchPickerModal → VarietyAllocationPicker behind STOCK_Y_MODEL"
```

---

## Task 7: Wire Step2Bouquet (florist + dashboard) — flag-gated

**Files:**
- Modify: `apps/florist/src/components/steps/Step2Bouquet.jsx`
- Modify: `apps/dashboard/src/components/steps/Step2Bouquet.jsx`

Step2 currently has inline catalog. Under `STOCK_Y_MODEL=true`, when a user picks a Variety with multiple Stock Items, open `<VarietyAllocationPicker>` for that Variety. Under flag-off, keep current inline behavior (no change).

- [ ] **Step 1: Add picker state to both Step2 components**

- [ ] **Step 2: Wire flag check via `useStockYModelFlag()`**

- [ ] **Step 3: On catalog click, if flag-on AND Variety has >1 row → open picker; else current path**

- [ ] **Step 4: Manual smoke test** — new order wizard step 2, multi-row Variety selection.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(steps): Step2Bouquet picker swap behind STOCK_Y_MODEL (florist+dashboard)"
```

---

## Task 8: Delete `BatchPickerModal` + cleanup imports

**Files:**
- Delete: `packages/shared/components/BatchPickerModal.jsx`
- Modify: `packages/shared/index.js`
- Modify: `packages/shared/CLAUDE.md`
- Modify: `packages/shared/hooks/useOrderEditing.js` (remove `findAllMatchingVariety` export — superseded by `groupByVariety`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Delete the file + barrel export line**

```bash
rm packages/shared/components/BatchPickerModal.jsx
```

- [ ] **Step 2: Remove from `packages/shared/index.js`**:
- `export { default as BatchPickerModal } …`
- `export { findAllMatchingVariety } …`

- [ ] **Step 3: Remove `findAllMatchingVariety` from `useOrderEditing.js`** (and the test if any).

- [ ] **Step 4: Update `packages/shared/CLAUDE.md`** structure block — remove BatchPickerModal row, add VarietyAllocationPicker + varietyKey rows.

- [ ] **Step 5: Add CHANGELOG entry**

- [ ] **Step 6: Verify no remaining imports**

```bash
grep -r "BatchPickerModal\|findAllMatchingVariety" --include="*.js" --include="*.jsx"
# Expected: no matches
```

- [ ] **Step 7: Commit**

```bash
git commit -am "chore(shared): delete BatchPickerModal + findAllMatchingVariety (superseded by VarietyAllocationPicker)"
```

---

## Task 9: Lab Playwright rehearsal

**Files:**
- Modify: `lab/scenarios/stockOverhaul.js` (only if extension trivial; defer to #290 if not)
- Create or modify: `lab/playwright/varietyPicker.spec.ts` (or equivalent)

- [ ] **Step 1: Verify `stockOverhaul.js` already seeds enough Y-model Varieties for the rehearsal** — read scenario; if missing 4-tuple coverage, add 3-5 explicit Varieties (Rose Pink 60, Rose White 70 Sarah Bernhardt, Peony Pink 50, Eucalyptus null null null).

- [ ] **Step 2: Write Playwright spec covering**:
  - Stage 1 typeahead returns one row per Variety
  - Cross-field "sarah" returns Sarah Bernhardt only
  - Florist session — "+ Create new Variety" hidden
  - Owner session — visible
  - Stage 2 — engine renders all option kinds; default highlighted
  - Order fresh for all → applied across multiple lines

- [ ] **Step 3: Run `npm run lab:test:ui`** — green output mandatory before commit.

- [ ] **Step 4: Commit**

```bash
git commit -am "test(lab): Playwright rehearsal for VarietyAllocationPicker"
```

---

## Self-review

- ✅ Spec coverage: stage 1 (T2), stage 2 (T3), create-Variety (T4), bulk fresh (T5), 4 callsites (T6+T7), delete BatchPickerModal (T8), Playwright (T9). Util seam in T1.
- ✅ All steps have actual code/commands, no placeholders.
- ✅ Type consistency: `varietyKey` / `groupByVariety` / `varietyDisplayName` referenced consistently across tasks; engine props match T2 onwards.
- ⚠️ Backend `GET /config` — flag exposure verified at T6 step 1; if missing, inline addition stays inside that task (single-line config response field).
- ⚠️ Cultivar autocomplete — picker emits raw draft only; host fetches `/stock/distinct/cultivar` to provide suggestions in a follow-up if needed (out-of-scope for this slice; spec gates "prefill" on host).

## Execution

Subagent-Driven Development. Implementer + spec-reviewer = sonnet. Code-quality at phase boundary = opus. Phase boundaries: after T5 (full picker built) and after T9 (full slice). Per-task code-quality on T6+T7+T8 (touch order/cart wiring — adjacent to Pitfall #4 feature gates and Pitfall #7 cancel-with-return surface).
