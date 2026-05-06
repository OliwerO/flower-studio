# Bouquet Picker Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bouquet picker bugs — #223 (upcoming Stock Order flowers missing) and #224 (Demand Entry path broken when a Batch exists).

**Architecture:** Phase 1 fixes the PO visibility pipeline: backend status filter, a new `isStockItemVisible` utility (with pendingPO guard), and a re-fetch in `startEditing` for auto-created Stock Items. Phase 2 restores the Demand Entry path: a new `createDemandEntry` hook function, a shared `BatchPickerModal` component, and grouped-by-baseName wiring in both BouquetEditor (florist) and BouquetSection (dashboard).

**Tech Stack:** Node/Express (backend), React + Tailwind (frontend), Vitest (tests), `@flower-studio/shared` (shared hook + components).

**Branches touched:** `fix/bouquet-picker-bugs` — create this branch before Task 1.

**ADRs governing this work:** `docs/adr/0001-flower-picker-grouped-with-modal.md`, `docs/adr/0002-demand-entry-aggregate-model.md`

---

## Phase 1 — #223: Surface all upcoming Stock Order flowers

### Task 1: Widen backend PO status filter

**Files:**
- Modify: `backend/src/routes/stock.js:235-241`

- [ ] **Step 1: Create branch**

```bash
git checkout -b fix/bouquet-picker-bugs
```

- [ ] **Step 2: Replace the filterByFormula at line 240**

Find the block starting at line 235:
```javascript
// for POs in Draft, Sent, or Shopping status (flowers not yet received into stock).
router.get('/pending-po', async (req, res, next) => {
  try {
    const pendingPOs = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: `OR({Status} = '${PO_STATUS.DRAFT}', {Status} = '${PO_STATUS.SENT}', {Status} = '${PO_STATUS.SHOPPING}')`,
```

Replace with:
```javascript
// for all non-Complete, non-Cancelled POs — flowers are still incoming or being evaluated.
router.get('/pending-po', async (req, res, next) => {
  try {
    const pendingPOs = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: `OR({Status} = '${PO_STATUS.DRAFT}', {Status} = '${PO_STATUS.SENT}', {Status} = '${PO_STATUS.SHOPPING}', {Status} = '${PO_STATUS.REVIEWING}', {Status} = '${PO_STATUS.EVALUATING}', {Status} = '${PO_STATUS.EVAL_ERROR}')`,
```

- [ ] **Step 3: Run backend tests to confirm nothing broken**

```bash
cd backend && npx vitest run
```
Expected: all tests pass (no test touches the PO status filter directly — just confirm no regressions).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/stock.js
git commit -m "fix(stock): include Reviewing/Evaluating/EvalError POs in pending-po picker

Flowers in Reviewing and Evaluating are physically in the studio — hiding
them from the bouquet picker created a blindspot until the Stock Order
reached Complete. All non-Complete, non-Cancelled statuses now qualify.

Closes part of #223"
```

---

### Task 2: Export `isStockItemVisible` utility + add tests

**Files:**
- Modify: `packages/shared/hooks/useOrderEditing.js` (add export before the default export)
- Modify: `packages/shared/test/useOrderEditing.test.js` (add new describe block)

- [ ] **Step 1: Write the failing tests first**

Add to `packages/shared/test/useOrderEditing.test.js` after the existing `findDuplicateStockItem` block:

```javascript
import { findDuplicateStockItem, isStockItemVisible } from '../hooks/useOrderEditing.js';

describe('isStockItemVisible', () => {
  it('hides a depleted dated Batch with no pending PO', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(false);
  });

  it('shows a depleted dated Batch that has pending PO demand', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, { rec1: { ordered: 5 } })).toBe(true);
  });

  it('shows a dated Batch with positive qty regardless of pending PO', () => {
    const item = { id: 'rec2', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 6 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows an undated Demand Entry regardless of negative qty', () => {
    const item = { id: 'rec3', 'Display Name': 'Rose', 'Current Quantity': -5 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows a non-dated zero-qty item (pending demand)', () => {
    const item = { id: 'rec4', 'Display Name': 'Lavender', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('defaults pendingPO to empty object when omitted', () => {
    const item = { id: 'rec5', 'Display Name': 'Tulip (10.Apr.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (isStockItemVisible not yet exported)**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useOrderEditing.test.js
```
Expected: `isStockItemVisible is not a function` or similar import error.

- [ ] **Step 3: Add `isStockItemVisible` export to `useOrderEditing.js`**

Add this block immediately before `export function findDuplicateStockItem` (around line 12):

```javascript
const _DATE_BATCH_RE = /\(\d{1,2}\.\w{3,4}\.?\)$/;

// Returns false for depleted dated-Batch Stock Items that have no pending PO demand.
// Exported so both the hook internals and BouquetEditor can share the same rule.
export function isStockItemVisible(stockItem, pendingPO = {}) {
  const qty = Number(stockItem['Current Quantity']) || 0;
  const name = stockItem['Display Name'] || '';
  if (qty <= 0 && _DATE_BATCH_RE.test(name) && !(pendingPO[stockItem.id]?.ordered > 0)) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useOrderEditing.test.js
```
Expected: all tests in both describe blocks pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/hooks/useOrderEditing.js packages/shared/test/useOrderEditing.test.js
git commit -m "feat(shared): export isStockItemVisible with pendingPO guard

Dated Batches at qty<=0 that have pending PO demand should stay visible
in the picker. The guard was missing — this utility enforces it and is
unit-tested independently of the hook.

Part of #223"
```

---

### Task 3: Apply `isStockItemVisible` everywhere + fix `startEditing` re-fetch

**Files:**
- Modify: `packages/shared/hooks/useOrderEditing.js` (getFilteredStock + startEditing)
- Modify: `apps/florist/src/components/BouquetEditor.jsx` (visibleStock memo)

- [ ] **Step 1: Update `getFilteredStock` in `useOrderEditing.js`**

Find `getFilteredStock` (around line 327):
```javascript
function getFilteredStock(query) {
  return stockItems.filter(s => {
    const name = (s['Display Name'] || '').toLowerCase();
    const qty = Number(s['Current Quantity']) || 0;
    if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
    if (editLines.some(l => l.stockItemId === s.id)) return false;
    if (query) return name.includes(query.toLowerCase());
    return true;
  });
}
```

Replace with:
```javascript
function getFilteredStock(query) {
  return stockItems.filter(s => {
    if (!isStockItemVisible(s, pendingPO)) return false;
    if (editLines.some(l => l.stockItemId === s.id)) return false;
    if (query) return (s['Display Name'] || '').toLowerCase().includes(query.toLowerCase());
    return true;
  });
}
```

- [ ] **Step 2: Update `startEditing` in `useOrderEditing.js`**

Find the stock/pending-po fetch block inside `startEditing` (around line 60-64):
```javascript
if (stockItems.length === 0) {
  apiClient.get('/stock?includeEmpty=true&includeInactive=true').then(r => setStockItems(r.data)).catch(() => {});
}
apiClient.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
apiClient.get('/stock/premade-committed').then(r => setPremadeMap(r.data || {})).catch(() => setPremadeMap({}));
```

Replace with:
```javascript
// Fetch stock and pending-po in parallel. If pending-po auto-created new Stock Items
// for unlinked PO lines, re-fetch stock so the picker sees them immediately.
Promise.all([
  apiClient.get('/stock?includeEmpty=true&includeInactive=true'),
  apiClient.get('/stock/pending-po'),
]).then(([stockRes, poRes]) => {
  setStockItems(stockRes.data);
  setPendingPO(poRes.data);
  const knownIds = new Set(stockRes.data.map(s => s.id));
  const hasNewItems = Object.keys(poRes.data).some(id => !knownIds.has(id));
  if (hasNewItems) {
    return apiClient.get('/stock?includeEmpty=true&includeInactive=true');
  }
  return null;
}).then(r => { if (r) setStockItems(r.data); })
.catch(() => {});
apiClient.get('/stock/premade-committed').then(r => setPremadeMap(r.data || {})).catch(() => setPremadeMap({}));
```

- [ ] **Step 3: Update `visibleStock` memo in `BouquetEditor.jsx`**

Find the `visibleStock` useMemo (lines 12-19):
```javascript
const visibleStock = useMemo(() =>
  editing.stockItems.filter(s => {
    const qty = Number(s['Current Quantity']) || 0;
    if (qty <= 0 && dateBatchPattern.test(s['Display Name'] || '')) return false;
    return true;
  }),
  [editing.stockItems]
);
```

Replace with:
```javascript
const visibleStock = useMemo(() =>
  editing.stockItems.filter(s => {
    const qty = Number(s['Current Quantity']) || 0;
    if (qty <= 0 && dateBatchPattern.test(s['Display Name'] || '') && !(editing.pendingPO?.[s.id]?.ordered > 0)) return false;
    return true;
  }),
  [editing.stockItems, editing.pendingPO]
);
```

- [ ] **Step 4: Run shared tests**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run
```
Expected: all tests pass.

- [ ] **Step 5: Build florist app to verify no import errors**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -5
```
Expected: `✓ built in Xs` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/hooks/useOrderEditing.js apps/florist/src/components/BouquetEditor.jsx
git commit -m "fix(picker): apply pendingPO guard to all stock visibility filters

getFilteredStock, startEditing re-fetch, and BouquetEditor visibleStock
now all use isStockItemVisible so dated Batches with pending PO demand
remain visible. startEditing re-fetches stock after pending-po if new
Stock Items were auto-created for unlinked PO lines.

Closes #223"
```

---

## Phase 2 — #224: Demand Entry disambiguation modal

### Task 4: `findAllMatchingVariety` + `createDemandEntry` in hook + tests

**Files:**
- Modify: `packages/shared/hooks/useOrderEditing.js`
- Modify: `packages/shared/test/useOrderEditing.test.js`

- [ ] **Step 1: Write failing tests for `findAllMatchingVariety`**

Add to `packages/shared/test/useOrderEditing.test.js`:

```javascript
import { findDuplicateStockItem, isStockItemVisible, findAllMatchingVariety } from '../hooks/useOrderEditing.js';

describe('findAllMatchingVariety', () => {
  const stock = [
    { id: 'rec1', 'Display Name': 'Pink Peonies (06.May.)' },
    { id: 'rec2', 'Display Name': 'Pink Peonies (15.Apr.)' },
    { id: 'rec3', 'Display Name': 'Pink Peonies' },
    { id: 'rec4', 'Display Name': 'Rose' },
    { id: 'rec5', 'Display Name': 'Rose (01.May.)' },
  ];

  it('returns all Stock Items whose base name matches — Batches and Demand Entry', () => {
    const result = findAllMatchingVariety(stock, 'Pink Peonies');
    expect(result.map(s => s.id)).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('is case-insensitive', () => {
    expect(findAllMatchingVariety(stock, 'pink peonies')).toHaveLength(3);
    expect(findAllMatchingVariety(stock, 'ROSE')).toHaveLength(2);
  });

  it('returns empty array for unknown variety', () => {
    expect(findAllMatchingVariety(stock, 'Tulip')).toEqual([]);
  });

  it('returns empty array for empty or null input', () => {
    expect(findAllMatchingVariety(stock, '')).toEqual([]);
    expect(findAllMatchingVariety(stock, null)).toEqual([]);
  });

  it('handles items with no Display Name', () => {
    const messy = [{ id: 'x1' }, { id: 'x2', 'Display Name': 'Rose' }];
    expect(findAllMatchingVariety(messy, 'Rose').map(s => s.id)).toEqual(['x2']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useOrderEditing.test.js
```
Expected: `findAllMatchingVariety is not a function`.

- [ ] **Step 3: Add `findAllMatchingVariety` and `createDemandEntry` to `useOrderEditing.js`**

Add this import at the top of `useOrderEditing.js` (after the React import):
```javascript
import parseBatchName from '../utils/parseBatchName.js';
```

Add this exported function before `export function findDuplicateStockItem`:
```javascript
// Returns all Stock Items whose base variety name matches baseName (case-insensitive).
// Includes both dated Batches ("Rose (06.May.)") and undated Demand Entries ("Rose").
// Exported for unit testing and use in picker components.
export function findAllMatchingVariety(stockItems, baseName) {
  const needle = (baseName || '').trim().toLowerCase();
  if (!needle) return [];
  return stockItems.filter(s => {
    const { name } = parseBatchName(s['Display Name'] || '');
    return name.trim().toLowerCase() === needle;
  });
}
```

Add this function inside the hook body (after `addNewFlowerQuick`, before `computeShortfalls`):
```javascript
// ── Demand Entry path ──────────────────────────────────────────────
// Creates or deepens the single undated Demand Entry for a variety.
// If one already exists, use it (deepens the aggregate negative qty).
// If not, create one inheriting price from the most recent Batch.
async function createDemandEntry(baseName) {
  const variety = findAllMatchingVariety(stockItems, baseName);
  const demandEntry = variety.find(s => parseBatchName(s['Display Name'] || '').batch === null);

  if (demandEntry) {
    addFlowerFromStock(demandEntry);
    return;
  }

  // Inherit prices from the most recently restocked Batch
  const batches = variety.filter(s => parseBatchName(s['Display Name'] || '').batch !== null);
  const mostRecentBatch = batches.reduce((best, s) => {
    if (!best) return s;
    const d = new Date(s['Last Restocked'] || 0);
    return d > new Date(best['Last Restocked'] || 0) ? s : best;
  }, null);

  const costPrice = Number(mostRecentBatch?.['Current Cost Price']) || 0;
  const sellPrice = Number(mostRecentBatch?.['Current Sell Price']) || 0;

  try {
    const res = await apiClient.post('/stock', {
      displayName: baseName.trim(),
      quantity: 0,
      costPrice,
      sellPrice,
    });
    setStockItems(prev => [...prev, res.data]);
    setEditLines(prev => [...prev, {
      id: null,
      stockItemId: res.data.id,
      flowerName: res.data['Display Name'],
      quantity: 1,
      _originalQty: 0,
      costPricePerUnit: costPrice,
      sellPricePerUnit: sellPrice,
    }]);
  } catch {
    showToast(t.updateError || 'Error creating demand entry', 'error');
    return;
  }
  setFlowerSearch('');
}
```

Add `createDemandEntry` to the returned object at the bottom of the hook (after `cancelDissolve`):
```javascript
createDemandEntry,
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run test/useOrderEditing.test.js
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/hooks/useOrderEditing.js packages/shared/test/useOrderEditing.test.js
git commit -m "feat(shared): findAllMatchingVariety + createDemandEntry for #224

findAllMatchingVariety groups Stock Items by base variety name across
Batches and Demand Entries. createDemandEntry reuses an existing Demand
Entry or creates one inheriting prices from the most recent Batch.
One Demand Entry per variety invariant is enforced by reusing if found.

Part of #224"
```

---

### Task 5: `BatchPickerModal` component + shared index export

**Files:**
- Create: `packages/shared/components/BatchPickerModal.jsx`
- Modify: `packages/shared/index.js`

- [ ] **Step 1: Create `BatchPickerModal.jsx`**

```jsx
// packages/shared/components/BatchPickerModal.jsx
import parseBatchName from '../utils/parseBatchName.js';

/**
 * Modal shown when the owner selects a flower variety that has multiple
 * Stock Items (Batches and/or an existing Demand Entry). Lets the owner
 * pick which Stock Item to use, or create a new Demand Entry.
 *
 * Props:
 *   baseName        string  — variety base name, e.g. "Pink Peonies"
 *   matches         array   — all Stock Items for this variety (Batches + Demand Entry)
 *   pendingPO       object  — { [stockId]: { ordered, plannedDate } } from useOrderEditing
 *   onSelectStock   fn      — (stockItem) => void
 *   onCreateDemand  fn      — () => void  (only called when no Demand Entry exists)
 *   onClose         fn      — () => void
 *   t               object  — translation keys:
 *                             batchPickerTitle, demandEntry, demandEntryHint,
 *                             demandEntryCreate, onOrder, cancel, stems
 */
export default function BatchPickerModal({
  baseName, matches, pendingPO = {}, onSelectStock, onCreateDemand, onClose, t,
}) {
  const batches = matches.filter(s => parseBatchName(s['Display Name'] || '').batch !== null);
  const demandEntry = matches.find(s => parseBatchName(s['Display Name'] || '').batch === null);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">{baseName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t.batchPickerTitle}</p>
        </div>

        <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {batches.map(s => {
            const qty = Number(s['Current Quantity']) || 0;
            const sell = Number(s['Current Sell Price']) || 0;
            const { batch } = parseBatchName(s['Display Name'] || '');
            const po = pendingPO[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStock(s)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{batch}</span>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {sell.toFixed(0)} zł · {qty} {t.stems}
                    {po?.ordered > 0 && (
                      <span className="text-blue-600 font-medium"> · +{po.ordered} {t.onOrder}</span>
                    )}
                  </div>
                </div>
                <span className={`text-sm font-bold ml-3 ${qty > 0 ? 'text-green-600' : 'text-amber-600'}`}>
                  {qty > 0 ? `+${qty}` : qty}
                </span>
              </button>
            );
          })}

          {demandEntry ? (
            <button
              type="button"
              onClick={() => onSelectStock(demandEntry)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-blue-700">{t.demandEntry}</span>
                <div className="text-xs text-blue-500 mt-0.5">{t.demandEntryHint}</div>
              </div>
              <span className="text-sm font-bold ml-3 text-blue-600">
                {Number(demandEntry['Current Quantity']) || 0}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreateDemand}
              className="w-full flex items-start px-4 py-3 text-left hover:bg-indigo-50 active:bg-indigo-100 transition-colors"
            >
              <span className="text-sm font-medium text-indigo-700">+ {t.demandEntryCreate}</span>
            </button>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 border-t border-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from `packages/shared/index.js`**

Add at the end of `index.js`:
```javascript
export { default as BatchPickerModal } from './components/BatchPickerModal.jsx';
export { findAllMatchingVariety } from './hooks/useOrderEditing.js';
```

- [ ] **Step 3: Build all three apps to catch any broken imports**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/delivery && ./node_modules/.bin/vite build 2>&1 | tail -3
```
Expected: all three build without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/components/BatchPickerModal.jsx packages/shared/index.js
git commit -m "feat(shared): BatchPickerModal for variety disambiguation

Shows all Batches (date + qty + PO badge) and the existing Demand Entry
(if any) for a flower variety, plus a 'Create Demand Entry' action when
none exists. Receives t prop from the calling app for bilingual support.

Part of #224"
```

---

### Task 6: Wire `BatchPickerModal` into `BouquetEditor.jsx` (florist)

**Files:**
- Modify: `apps/florist/src/components/BouquetEditor.jsx`
- Modify: `apps/florist/src/translations.js`

- [ ] **Step 1: Add translation keys to `apps/florist/src/translations.js`**

Find the English section and add (near the `addNewFlower` / `flowerSearch` keys, around line 206):
```javascript
batchPickerTitle:    'Select batch or create demand',
demandEntry:         'Demand entry (current stock)',
demandEntryHint:     'Deepens existing demand — will go more negative',
demandEntryCreate:   'Create demand entry (will go negative)',
stems:               'stems',
```

Find the Russian section and add (near `addNewFlower` / `flowerSearch`, around line 909):
```javascript
batchPickerTitle:    'Выберите партию или создайте спрос',
demandEntry:         'Запрос на поставку (текущий)',
demandEntryHint:     'Углубляет существующий спрос — уйдёт дальше в минус',
demandEntryCreate:   'Создать спрос на поставку (уйдёт в минус)',
stems:               'шт.',
```

- [ ] **Step 2: Update imports in `BouquetEditor.jsx`**

Find line 2:
```javascript
import { renderStockName } from '@flower-studio/shared';
```

Replace with:
```javascript
import { renderStockName, parseBatchName, findAllMatchingVariety, BatchPickerModal } from '@flower-studio/shared';
```

- [ ] **Step 3: Add picker modal state**

After `const [flowerSearch, setFlowerSearch] = useState('');` (line 7), add:
```javascript
const [pickerModalVariety, setPickerModalVariety] = useState(null);
const [pickerModalMatches, setPickerModalMatches] = useState([]);
```

- [ ] **Step 4: Replace `catalogItems` with `catalogVarieties` (grouped by baseName)**

Replace the existing `catalogItems` useMemo (lines 23-36) with two memos:
```javascript
// Filtered catalog: search + in-stock toggle. Still per-Stock-Item for internal logic.
const catalogItems = useMemo(() => {
  let result = visibleStock;
  if (!showOutOfStock) {
    result = result.filter(s =>
      (Number(s['Current Quantity']) || 0) > 0 || (editing.pendingPO?.[s.id]?.ordered || 0) > 0
    );
  }
  const q = flowerSearch.toLowerCase().trim();
  if (!q) return result;
  return result.filter(s =>
    (s['Display Name'] || '').toLowerCase().includes(q) ||
    (s['Category'] || '').toLowerCase().includes(q)
  );
}, [visibleStock, flowerSearch, showOutOfStock, editing.pendingPO]);

// Group by base variety name — one row per variety in the picker.
const catalogVarieties = useMemo(() => {
  const map = new Map();
  for (const s of catalogItems) {
    const { name: base } = parseBatchName(s['Display Name'] || '');
    const key = base.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        baseName: base,
        totalQty: 0,
        sell: Number(s['Current Sell Price']) || 0,
        poQty: 0,
        inCart: false,
      });
    }
    const entry = map.get(key);
    entry.totalQty += Number(s['Current Quantity']) || 0;
    entry.poQty += editing.pendingPO?.[s.id]?.ordered || 0;
    if (editing.editLines.find(l => l.stockItemId === s.id)) entry.inCart = true;
  }
  return [...map.values()];
}, [catalogItems, editing.pendingPO, editing.editLines]);
```

- [ ] **Step 5: Replace the "Add unlisted flower" button condition**

Find (line 127):
```javascript
{flowerSearch.length >= 2 && !catalogItems.some(s => (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()) && (
```

Replace with:
```javascript
{flowerSearch.length >= 2 && !editing.stockItems.some(s => {
  const { name } = parseBatchName(s['Display Name'] || '');
  return name.toLowerCase() === flowerSearch.trim().toLowerCase();
}) && (
```

Also update the button's onClick to use `addNewFlowerQuick` directly (the "find existing" branch is now handled by the modal):
```javascript
onClick={() => {
  editing.addNewFlowerQuick(flowerSearch);
  setFlowerSearch('');
}}
```

- [ ] **Step 6: Replace the catalog rows render to use `catalogVarieties`**

Find the catalog map (line 147 `catalogItems.map(s => {`). Replace the entire map with:
```javascript
catalogVarieties.map(({ baseName, totalQty, sell, poQty, inCart }) => {
  const low = totalQty > 0 && totalQty <= 5;
  const out = totalQty <= 0;
  return (
    <button
      key={baseName}
      type="button"
      onClick={() => {
        const allMatches = findAllMatchingVariety(editing.stockItems, baseName);
        setPickerModalVariety(baseName);
        setPickerModalMatches(allMatches);
      }}
      className={`w-full flex items-center px-3 py-2.5 gap-2 text-left transition-colors active-scale
                  ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
    >
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
          {baseName}
        </div>
        <div className="text-xs text-ios-tertiary">
          <span className="font-bold text-brand-700">{sell.toFixed(0)} zł</span>
          <span> · {totalQty} pcs</span>
          {low && !out && <span className="text-ios-orange"> · low</span>}
          {out && !poQty && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
          {poQty > 0 && <span className="text-blue-600 font-medium"> · +{poQty} {t.onOrder || 'on order'}</span>}
        </div>
      </div>
      {inCart && (
        <span className="min-w-[22px] h-[22px] px-1 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
          ✓
        </span>
      )}
    </button>
  );
})
```

- [ ] **Step 7: Add `BatchPickerModal` render at end of the editing block**

Add just before the final `</div>` closing the editing block (after the Save/Cancel buttons, around line 295):

```jsx
{pickerModalVariety && (
  <BatchPickerModal
    baseName={pickerModalVariety}
    matches={pickerModalMatches}
    pendingPO={editing.pendingPO}
    onSelectStock={s => {
      addFromCatalog(s);
      setPickerModalVariety(null);
      setFlowerSearch('');
    }}
    onCreateDemand={() => {
      editing.createDemandEntry(pickerModalVariety);
      setPickerModalVariety(null);
      setFlowerSearch('');
    }}
    onClose={() => setPickerModalVariety(null)}
    t={{
      batchPickerTitle:  t.batchPickerTitle,
      demandEntry:       t.demandEntry,
      demandEntryHint:   t.demandEntryHint,
      demandEntryCreate: t.demandEntryCreate,
      onOrder:           t.onOrder,
      cancel:            t.cancel,
      stems:             t.stems,
    }}
  />
)}
```

- [ ] **Step 8: Build florist app**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -5
```
Expected: builds cleanly.

- [ ] **Step 9: Commit**

```bash
git add apps/florist/src/components/BouquetEditor.jsx apps/florist/src/translations.js
git commit -m "feat(florist): grouped picker + BatchPickerModal for flower disambiguation

Picker groups by base variety name (one row per variety). Clicking any
row opens BatchPickerModal showing all Batches + existing Demand Entry
+ 'Create Demand Entry'. 'Add unlisted flower' only fires for truly new
varieties. Closes the path regression from c69cad6.

Part of #224"
```

---

### Task 7: Wire `BatchPickerModal` into `BouquetSection.jsx` (dashboard)

**Files:**
- Modify: `apps/dashboard/src/components/order/BouquetSection.jsx`
- Modify: `apps/dashboard/src/translations.js`

- [ ] **Step 1: Add translation keys to `apps/dashboard/src/translations.js`**

Find the English section (near `addNewFlower`, around line 271) and add:
```javascript
batchPickerTitle:    'Select batch or create demand',
demandEntry:         'Demand entry (current stock)',
demandEntryHint:     'Deepens existing demand — will go more negative',
demandEntryCreate:   'Create demand entry (will go negative)',
stems:               'stems',
```

Find the Russian section (near `addNewFlower`, around line 1163) and add:
```javascript
batchPickerTitle:    'Выберите партию или создайте спрос',
demandEntry:         'Запрос на поставку (текущий)',
demandEntryHint:     'Углубляет существующий спрос — уйдёт дальше в минус',
demandEntryCreate:   'Создать спрос на поставку (уйдёт в минус)',
stems:               'шт.',
```

- [ ] **Step 2: Update imports in `BouquetSection.jsx`**

Find line 2:
```javascript
import { parseBatchName } from '@flower-studio/shared';
```

Replace with:
```javascript
import { parseBatchName, findAllMatchingVariety, BatchPickerModal } from '@flower-studio/shared';
```

- [ ] **Step 3: Add picker modal state**

At the top of the component (inside `BouquetSection`), add state after the existing destructuring:
```javascript
const [pickerModalVariety, setPickerModalVariety] = useState(null);
const [pickerModalMatches, setPickerModalMatches] = useState([]);
```

Add import at top of file:
```javascript
import { useState } from 'react';
```

- [ ] **Step 4: Replace the catalog click handler in the picker dropdown**

Find (around line 112-113):
```javascript
onClick={() => editing.addFlowerFromStock(s)}
```

Replace with:
```javascript
onClick={() => {
  const allMatches = findAllMatchingVariety(editing.stockItems, parseBatchName(s['Display Name'] || '').name);
  if (allMatches.length <= 1) {
    editing.addFlowerFromStock(s);
  } else {
    setPickerModalVariety(parseBatchName(s['Display Name'] || '').name);
    setPickerModalMatches(allMatches);
  }
}}
```

**Note:** BouquetSection already shows per-Stock-Item rows (not grouped). The modal fires when clicking a row that has siblings (multiple batches or a demand entry). This avoids changing the picker list structure while still adding the disambiguation path.

- [ ] **Step 5: Update the "Add new flower" button condition**

Find (around line 134):
```javascript
{flowerSearch.length >= 2 && !stockItems.some(s =>
  (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()
) && (
```

Replace with:
```javascript
{flowerSearch.length >= 2 && !editing.stockItems.some(s => {
  const { name } = parseBatchName(s['Display Name'] || '');
  return name.toLowerCase() === flowerSearch.trim().toLowerCase();
}) && (
```

- [ ] **Step 6: Add `BatchPickerModal` render**

Add after the closing `</div>` of the `addingFlower` block (around line 146), still inside the editing block:

```jsx
{pickerModalVariety && (
  <BatchPickerModal
    baseName={pickerModalVariety}
    matches={pickerModalMatches}
    pendingPO={editing.pendingPO}
    onSelectStock={s => {
      editing.addFlowerFromStock(s);
      setPickerModalVariety(null);
      editing.setFlowerSearch('');
      editing.setAddingFlower(false);
    }}
    onCreateDemand={() => {
      editing.createDemandEntry(pickerModalVariety);
      setPickerModalVariety(null);
      editing.setFlowerSearch('');
      editing.setAddingFlower(false);
    }}
    onClose={() => setPickerModalVariety(null)}
    t={{
      batchPickerTitle:  t.batchPickerTitle,
      demandEntry:       t.demandEntry,
      demandEntryHint:   t.demandEntryHint,
      demandEntryCreate: t.demandEntryCreate,
      onOrder:           t.onOrder,
      cancel:            t.cancel,
      stems:             t.stems,
    }}
  />
)}
```

- [ ] **Step 7: Run shared tests + build all apps**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/delivery && ./node_modules/.bin/vite build 2>&1 | tail -3
```
Expected: all tests pass, all three apps build cleanly.

- [ ] **Step 8: Run backend tests + E2E**

```bash
cd backend && npx vitest run 2>&1 | tail -5
```
Expected: all backend tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/order/BouquetSection.jsx apps/dashboard/src/translations.js
git commit -m "feat(dashboard): BatchPickerModal in BouquetSection for #224

Dashboard picker now opens BatchPickerModal when a clicked flower has
multiple Stock Items (Batches or a Demand Entry). 'Add new flower'
gated by baseName match across all stockItems, not exact Display Name.
Translation keys added in both EN and RU.

Closes #224"
```

---

## Post-implementation verification

- [ ] **Run full check matrix**

```bash
cd backend && npx vitest run
cd packages/shared && ../../backend/node_modules/.bin/vitest run
cd apps/florist && ./node_modules/.bin/vite build
cd apps/dashboard && ./node_modules/.bin/vite build
cd apps/delivery && ./node_modules/.bin/vite build
npm run harness &
sleep 3 && npm run test:e2e
```

- [ ] **Open PR referencing both issues**

```bash
gh pr create \
  --title "fix(picker): PO visibility + Demand Entry modal (#223, #224)" \
  --body "..."
```

PR body must reference E2E section number or harness output per CLAUDE.md Verification Gate.
