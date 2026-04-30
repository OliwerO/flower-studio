> **ARCHIVED 2026-04-30.** This plan was authored 2026-03-23. Both premises ("Frontend: zero test files, zero CI" and "Backend: 3 test files") are now false — Vitest covers backend (15 files) and shared (9 files), Playwright + a 24-section API E2E suite live under `tests/` and `scripts/e2e-test.js`, and `.github/workflows/test.yml` runs both on every PR. Kept for historical context. Do not treat as the current plan. Referenced branch `claude/analyze-and-improve-app-gLGMR` was abandoned.

# Frontend Testing Plan

> Saved 2026-03-23. Pick this up in a fresh Claude Code session.
> Branch: `claude/analyze-and-improve-app-gLGMR`

## Current State

- **Backend**: 3 Vitest test files in `backend/src/__tests__/` (~500 lines). Config at `backend/vitest.config.js`. Works.
- **Frontend**: Zero test files, zero testing deps, zero test config across all 3 apps + shared package.
- **CI**: No `.github/workflows/` directory exists.
- **Node**: v22.22.0

---

## Step 0 — CLAUDE.md Testing Rules (already done)

A "Testing Rules" section has been added to `CLAUDE.md`. This ensures Claude Code
automatically writes tests for any new shared utility, hook, or backend service.
**No action needed — this step is complete.**

---

## Step 1 — Install Dependencies

### 1a. Root-level dev deps (shared by all workspaces via hoisting)

```bash
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom --save-dev -w
```

`@vitest/coverage-v8` is needed for the coverage thresholds in Step 2a.

These are dev-only and shared. No need to install per-app since npm workspaces hoists.

### 1b. Verify all apps can resolve them

```bash
cd apps/florist && node -e "require.resolve('vitest')"
cd apps/delivery && node -e "require.resolve('vitest')"
cd apps/dashboard && node -e "require.resolve('vitest')"
cd packages/shared && node -e "require.resolve('vitest')"
```

If resolution fails for any workspace, add them as devDependencies to that specific `package.json`.

---

## Step 2 — Vitest Configuration

### 2a. Shared package: `packages/shared/vitest.config.js`

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['utils/**', 'hooks/**'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
```

The `coverage.thresholds` block is **Option B** — CI will fail if new utils/hooks
drop line coverage below 80%. This only applies to the shared package (where all
reusable logic lives), not to app-level components (those change too often for
hard thresholds to be practical).

> Note: shared package doesn't have `@vitejs/plugin-react` as a dep. Either install it there
> (`npm install -D @vitejs/plugin-react -w packages/shared`) or skip the react plugin for
> pure-logic tests and only add it when testing JSX like `stockName.jsx`.

### 2b. Each frontend app: extend `vite.config.js` with test block

For each of `apps/florist/vite.config.js`, `apps/delivery/vite.config.js`, `apps/dashboard/vite.config.js`:

Add a `test` property to the existing `defineConfig`:

```js
// Add to existing defineConfig:
test: {
  environment: 'jsdom',
  setupFiles: ['./test/setup.js'],
  globals: true,
},
```

Change the import from `'vite'` to `'vitest/config'`:
```js
import { defineConfig } from 'vitest/config';
```

### 2c. Create setup files

Create `packages/shared/test/setup.js`, `apps/florist/test/setup.js`, `apps/delivery/test/setup.js`, `apps/dashboard/test/setup.js` — all identical:

```js
import '@testing-library/jest-dom';
```

This adds matchers like `toBeInTheDocument()`, `toHaveTextContent()`, etc.

---

## Step 3 — Add Test Scripts to package.json

### 3a. Each app + shared package.json — add:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### 3b. Root package.json — add workspace-wide test command:

```json
"scripts": {
  "test": "npm run test --workspaces --if-present",
  "test:frontend": "npm run test -w packages/shared -w apps/florist -w apps/delivery -w apps/dashboard"
}
```

---

## Step 4 — Write Tests: Shared Utilities (highest ROI)

### 4a. `packages/shared/test/parseBatchName.test.js`

Test cases:
- `"Rose Red (14.Mar.)"` → `{ name: "Rose Red", batch: "14.Mar." }`
- `"Rose Red (14.Mar)"` → `{ name: "Rose Red", batch: "14.Mar" }` (no trailing dot)
- `"Tulip Pink"` (no batch) → `{ name: "Tulip Pink", batch: null }`
- `""` → `{ name: "", batch: null }`
- `null` → `{ name: null, batch: null }` (or undefined — check)
- `"Rose (Red) (14.Mar.)"` → verify greedy vs lazy match
- `"Lily (3.Sept.)"` → single-digit day

Source: `packages/shared/utils/parseBatchName.js` (5 lines, regex-based)

### 4b. `packages/shared/test/timeSlots.test.js`

Test cases for `getAvailableSlots(allSlots, selectedDate, leadMinutes)`:
- **Future date**: all slots return `available: true`
- **Empty/null input**: returns `[]`
- **Sorting**: `['14:00-16:00', '10:00-12:00']` returns sorted by start time
- **Today with mocked time**: slots before `now + leadMinutes` are `available: false`
- **Custom leadMinutes**: verify the buffer applies
- **Edge**: slot starting exactly at `now + lead` → `available: false` (uses `>` not `>=`)

Important: Must mock `new Date()` with `vi.useFakeTimers()` / `vi.setSystemTime()` for "today" tests.

Source: `packages/shared/utils/timeSlots.js` (36 lines)

### 4c. `packages/shared/test/stockName.test.jsx`

Test cases for `renderStockName(displayName, lastRestocked)`:
- `null`/`undefined`/`""` → returns `''`
- `"Rose Red"` (no batch, no lastRestocked) → returns plain string `"Rose Red"`
- `"Rose Red (14.Mar.)"` → returns JSX with base name + badge containing "14.Mar."
- With `lastRestocked` within 7 days → gray badge
- With `lastRestocked` 8-14 days ago → amber badge
- With `lastRestocked` 15+ days ago → red badge
- Name has batch suffix AND lastRestocked provided → uses batch from name, but daysAgo from lastRestocked

Use `@testing-library/react`'s `render()` for JSX output, check text content and class names.

Source: `packages/shared/utils/stockName.jsx` (42 lines)

---

## Step 5 — Write Tests: Shared Hooks

### 5a. `packages/shared/test/useOrderEditing.test.js`

Use `renderHook` from `@testing-library/react`.

Mock deps:
```js
const mockApiClient = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const mockShowToast = vi.fn();
const mockT = { updateError: 'Error', bouquetUpdated: 'Updated' };
```

Test cases:
- **startEditing**: maps order lines to edit format, sets `editingBouquet: true`
- **updateLineQty**: changes quantity for correct index only
- **commitLineQty**: clamps empty/zero to 1
- **incrementQty / decrementQty**: +1 / -1 with floor of 1
- **confirmRemoveLine('return')**: moves line to `removedLines` with action='return'
- **confirmRemoveLine('writeoff')**: same with action='writeoff', adds reason
- **addFlowerFromStock**: appends new line from stock item
- **cancelEditing**: resets all editing state
- **editCostTotal / editSellTotal / editMargin**: computed values based on editLines
- **getFilteredStock**: filters by query, excludes already-added items, hides depleted dated batches
- **handleSaveClick with reductions**: sets `stockAction: 'pending'` instead of saving
- **handleSaveClick without reductions**: calls doSave directly
- **doSave success**: calls PUT, resets state, fetches refreshed order, shows success toast
- **doSave failure**: shows error toast, returns null

Source: `packages/shared/hooks/useOrderEditing.js` (273 lines)

### 5b. `packages/shared/test/useOrderPatching.test.js`

Test cases:
- **patchOrder success**: calls PATCH, merges response into order via setOrder, shows toast
- **patchOrder failure**: shows error toast, doesn't crash
- **patchDelivery success**: patches delivery sub-object
- **patchDelivery with no deliveryId**: returns early, no API call
- **saving state**: true during request, false after

Source: `packages/shared/hooks/useOrderPatching.js` (42 lines)

---

## Step 6 — Write Tests: Key Components

### 6a. `packages/shared/test/AuthContext.test.jsx`

Test cases:
- **useAuth outside provider**: throws `"useAuth must be used inside AuthProvider"`
- **login**: sets pin, role, driverName in context
- **logout**: resets to null state
- **default state**: pin=null, role=null, driverName=null

### 6b. `packages/shared/test/ToastContext.test.jsx`

Test cases:
- **showToast**: sets toast with message and type
- **auto-dismiss**: toast becomes null after 4000ms (use fake timers)
- **dismiss**: manually clears toast
- **useToast outside provider**: throws

### 6c. `packages/shared/test/ErrorBoundary.test.jsx`

Test cases:
- **No error**: renders children normally
- **Child throws**: renders fallback with Russian error heading "Что-то пошло не так"
- **Shows error message**: displays `error.message` in fallback
- **Reload button**: exists and is clickable

### 6d. `apps/dashboard/src/__tests__/KanbanBoard.test.jsx`

Test cases:
- **Renders 4 columns**: New, Ready, Out for Delivery, Done
- **Sorts orders into correct columns**: order with Status='New' in first column
- **Done column includes both Delivered and Picked Up**
- **Empty columns show dash placeholder**
- **Click on card calls onOrderClick with order object**
- **KanbanCard shows customer name, price, bouquet summary**
- **Delivery vs Pickup icons**: 🚗 vs 🏪
- **Unpaid badge shown when Payment Status ≠ Paid**

Will need to mock `../translations.js` — use `vi.mock()`.

### 6e. `apps/florist/src/__tests__/BouquetEditor.test.jsx`

This is a complex 306-line component. Focus on:
- **Read-only mode**: renders order lines with prices when not editing
- **Edit mode**: shows search input, stepper buttons, save/cancel buttons
- **Budget display**: shows original price, sell total, delta
- **Over-budget warning**: red text when sell total > original price
- **addFromCatalog**: increments existing item or adds new
- **Remove dialog**: appears when ✕ clicked, offers Return/Write Off

Will need mocks for: `../translations.js`, `@flower-studio/shared` (renderStockName).

---

## Step 7 — GitHub Actions CI Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, claude/*]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Backend tests
        run: npm test -w backend

      - name: Shared package tests + coverage check
        run: npx vitest run --coverage -w packages/shared

      - name: Florist app tests
        run: npm test -w apps/florist

      - name: Delivery app tests
        run: npm test -w apps/delivery

      - name: Dashboard app tests
        run: npm test -w apps/dashboard

      - name: Build all apps
        run: |
          npm run build -w apps/florist
          npm run build -w apps/delivery
          npm run build -w apps/dashboard
```

---

## Step 8 — Commit & Push

```bash
git add -A
git commit -m "feat: add frontend testing infrastructure with Vitest + RTL + CI

- Vitest + React Testing Library + jsdom for all frontend workspaces
- Shared utility tests: parseBatchName, timeSlots, stockName
- Shared hook tests: useOrderEditing, useOrderPatching
- Context tests: AuthContext, ToastContext, ErrorBoundary
- Component tests: KanbanBoard, BouquetEditor
- GitHub Actions workflow runs all tests on push/PR"

git push -u origin claude/analyze-and-improve-app-gLGMR
```

---

## File Inventory (what gets created)

| File | Type | Lines (est.) |
|------|------|-------------|
| `packages/shared/vitest.config.js` | Config | 10 |
| `packages/shared/test/setup.js` | Setup | 1 |
| `packages/shared/test/parseBatchName.test.js` | Test | 30 |
| `packages/shared/test/timeSlots.test.js` | Test | 60 |
| `packages/shared/test/stockName.test.jsx` | Test | 50 |
| `packages/shared/test/useOrderEditing.test.js` | Test | 150 |
| `packages/shared/test/useOrderPatching.test.js` | Test | 60 |
| `packages/shared/test/AuthContext.test.jsx` | Test | 40 |
| `packages/shared/test/ToastContext.test.jsx` | Test | 40 |
| `packages/shared/test/ErrorBoundary.test.jsx` | Test | 35 |
| `apps/florist/test/setup.js` | Setup | 1 |
| `apps/florist/src/__tests__/BouquetEditor.test.jsx` | Test | 100 |
| `apps/delivery/test/setup.js` | Setup | 1 |
| `apps/dashboard/test/setup.js` | Setup | 1 |
| `apps/dashboard/src/__tests__/KanbanBoard.test.jsx` | Test | 80 |
| `.github/workflows/test.yml` | CI | 35 |
| **Total new test code** | | **~650 lines** |

Plus edits to:
- `package.json` (root) — add `test` scripts
- `packages/shared/package.json` — add `test` scripts + devDeps if needed
- `apps/florist/package.json` — add `test` scripts
- `apps/delivery/package.json` — add `test` scripts
- `apps/dashboard/package.json` — add `test` scripts
- `apps/florist/vite.config.js` — add `test` block
- `apps/delivery/vite.config.js` — add `test` block
- `apps/dashboard/vite.config.js` — add `test` block

---

## Priority Order (if time-constrained)

1. **Steps 1-3** (deps + config + scripts) — foundation, ~15 min
2. **Step 4a-4b** (parseBatchName + timeSlots) — pure logic, instant ROI
3. **Step 5a** (useOrderEditing) — most complex shared logic
4. **Step 6a-6c** (contexts) — used by every app
5. **Step 6d** (KanbanBoard) — representative component test
6. **Step 7** (CI) — automates everything
7. **Steps 4c, 5b, 6e** — remaining coverage

---

## How This Adapts to New Features

Two mechanisms keep test coverage growing automatically:

### Option A — CLAUDE.md convention (already applied)
The `Testing Rules` section in `CLAUDE.md` tells Claude Code:
> New shared utilities and hooks **must** include a test file.

Every Claude Code session reads `CLAUDE.md` first. When building a new feature —
e.g. a `useDeliveryTracking` hook — it will create
`packages/shared/test/useDeliveryTracking.test.js` alongside it. No human reminder needed.

### Option B — Coverage threshold (enforced in CI)
`packages/shared/vitest.config.js` sets `coverage.thresholds.lines: 80` for `utils/` and `hooks/`.
If someone adds a new utility without tests, coverage drops and CI fails.

This only gates the shared package — not app components. App components change too
frequently for hard thresholds, and the CLAUDE.md rule handles them well enough.

### What's NOT covered (and why that's fine)
- **App-level components** (`apps/*/src/components/`) — no coverage gate. These are
  UI-heavy, change often, and testing them has diminishing returns. The CLAUDE.md rule
  encourages tests for complex ones, but doesn't enforce it.
- **Backend routes** — already have their own test pattern in `backend/src/__tests__/`.
  The CLAUDE.md rule now covers new services too.

---

## Notes for Implementation

- `renderStockName` returns JSX or a string depending on input — test both paths
- `useOrderEditing` calls `apiClient.get('/stock?includeEmpty=true')` on first `startEditing()` — mock this
- `timeSlots.test.js` MUST use `vi.useFakeTimers()` — the "today" logic depends on `new Date()`
- Dashboard and florist tests need `vi.mock('../translations.js')` returning an object with all `t.xxx` keys
- The `translations.js` mock can return key names as values: `{ statusNew: 'statusNew', save: 'save', ... }`
- `BouquetEditor` receives an `editing` prop that is the return value of `useOrderEditing` — test the component with a mock editing object, not the real hook
- `ErrorBoundary` test: use a child component that conditionally throws to trigger the boundary
