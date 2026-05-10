# Stock Y-model: gap closures (#287/#288/#289 follow-ups)

> Subagent-driven execution. Sonnet implementer + spec-review. Backend = TDD red mandatory.

**Goal:** Close 3 backend gaps that left `<VarietyAllocationPicker>` create-flow + reserved-bucket tap as dead-ends.

## Tasks

### T1: `POST /stock` accepts 4-tuple Variety attrs

**Files:** `backend/src/routes/stock.js`, `backend/src/repos/stockRepo.js`, `backend/src/__tests__/stockRoutes.test.js` (or appropriate)

Today the POST handler whitelists `displayName, category, quantity, costPrice, sellPrice, supplier, unit, lotSize, farmer`. Add `typeName, colour, sizeCm, cultivar` (camelCase wire) → write to `type_name, colour, size_cm, cultivar` columns. Pass-through; no validation beyond type coercion.

**Tests:** post with all 4-tuple fields → row reads them back; partial fields (only typeName) work; legacy displayName-only still works.

### T2: `/stock/premade-committed` Y-model branch populates `bouquets[]`

**Files:** `backend/src/routes/stock.js` lines ~110-130, possibly `backend/src/repos/stockRepo.js`

Currently Y-model branch returns `{ stockId: { qty, bouquets: [] } }`. Extend to join premade_bouquet_lines → premade_bouquets so `bouquets: [{ bouquetId, name, qty }]` is populated, matching the legacy branch's shape.

**Tests:** premade with 2 lines for same Variety → response has both bouquet names. Empty premades → `bouquets: []`.

### T3: `createDemandEntry` accepts 4-tuple draft

**Files:** `packages/shared/hooks/useOrderEditing.js` lines 220-266, `packages/shared/test/useOrderEditing.test.js` if exists or new test

Current signature: `createDemandEntry(baseName: string)`. New: `createDemandEntry(varietyDraft)` where `varietyDraft` is either the legacy string (back-compat) OR `{ baseName?, type_name?, colour?, size_cm?, cultivar? }`. When 4-tuple provided, POST /stock with all fields. Display name auto-derived from `varietyDisplayName` if not given.

**Tests:** 4-tuple draft → POST body carries all 4; legacy string still works.

### T4: Picker callsite TODOs

**Files:** 4 callsites with `TODO: pass full variety attrs once createDemandEntry supports new shape`:
- `apps/florist/src/components/BouquetEditor.jsx:370-372`
- `apps/dashboard/src/components/order/BouquetSection.jsx:228-231`
- `apps/florist/src/components/steps/Step2Bouquet.jsx:827-846`
- `apps/dashboard/src/components/steps/Step2Bouquet.jsx:644-661`

Replace fallbacks: when picker emits `{ kind: 'fresh', date, variety }` (we may need to extend the payload), call `editing.createDemandEntry({ ...variety, baseName: varietyDisplayName(variety) })`. Same for `onCreateVariety` flow — pass through the 4-tuple to `apiClient.post('/stock', { typeName, colour, sizeCm, cultivar, displayName })`.

Note: `<VarietyAllocationPicker>` may already have the variety in scope when emitting fresh. Verify by reading the component; if not, extend the emission shape to include the variety four-tuple.

**Skip TDD red** for this task (UI wiring composing existing services).

### T5: CHANGELOG + Pre-PR matrix + PR merge

**Files:** `CHANGELOG.md`

Single-line entry under a new `## 2026-05-10 — Stock Y-model: gap closures` heading citing #287/#288/#289 follow-ups + the 3 gaps closed.

Run Pre-PR matrix (backend vitest + e2e + shared vitest + 3 builds + lab unit/api). Open PR, merge on green, cleanup.

## Sizing

~150 LOC across ~8 files. T1+T2 parallel-safe. T3 depends on T1. T4 depends on T3.
