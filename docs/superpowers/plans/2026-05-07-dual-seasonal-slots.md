# Dual Seasonal Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the storefront from one seasonal category slot to two independent variable slots — slot 1 (auto-schedule or manual) and slot 2 (manual only) — so the owner can show zero, one, or two seasonal categories on the website at a time without touching Wix.

**Architecture:** `configService` owns the `slots` array in `storefrontCategories` config and exports `getActiveSeasonalSlots()`. `wixProductSync` iterates over both slots to fill or empty their Wix collections. `public.js /categories` exposes `seasonal2` alongside the existing `seasonal` field. The dashboard UI replaces the two flat controls (auto-schedule toggle + manual override dropdown) with two slot sub-sections. `masterPage.js` in Blossom-Wix handles `seasonal2` and explicitly removes null-slot nav items.

**Tech Stack:** Node.js / Express (backend), React + Tailwind (dashboard), Vitest (tests), Vite (build), Wix Velo JS (masterPage)

**Spec:** `docs/superpowers/specs/2026-05-07-dual-seasonal-slots-design.md`
**Issues:** #251 (config), #252 (sync + API), #253 (UI), #254 (Wix setup HITL), #255 (masterPage)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/services/configService.js` | Update DEFAULTS, add migration fn, add `getActiveSeasonalSlots()`, update `getActiveSeasonalCategory()` |
| `backend/src/__tests__/configService.test.js` | **Create** — unit tests for slot resolution and backward compat |
| `backend/src/routes/public.js` | Import `getActiveSeasonalSlots`, add `seasonal2` + update `all` in `/categories` response |
| `backend/src/services/wixProductSync.js` | Import `getActiveSeasonalSlots`, replace single-slot block with slot loop |
| `apps/dashboard/src/components/settings/StorefrontCategoriesSection.jsx` | Two-slot UI: derive `slots`, update row badges, replace controls |
| `apps/dashboard/src/translations.js` | Update `sfSeasonal`/`sfSeasonalHint`, add `sfSlot1`, `sfSlot2`, `sfSlot2Hint`, `sfSlot1Active`, `sfSlot2Active` (EN + RU) |
| `src/pages/masterPage.js` *(Blossom-Wix repo)* | Handle `seasonal2`, explicit null-slot nav removal for both slots |

---

## Phase 1 — Backend: config model + service functions (closes #251)

### Task 1: DEFAULTS + migration + getActiveSeasonalSlots + tests

**Files:**
- Modify: `backend/src/services/configService.js`
- Create: `backend/src/__tests__/configService.test.js`

- [ ] **Step 1: Update DEFAULTS in configService.js**

In `backend/src/services/configService.js`, replace the two flat fields inside `storefrontCategories` DEFAULTS:

```js
// REMOVE these two lines:
    autoSchedule: true,
    manualOverride: null,

// ADD after the closing bracket of the auto: [...] array:
    slots: [
      { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null },
      { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
    ],
```

The `storefrontCategories` block in DEFAULTS should now end with:
```js
    wixCategoryMap: {},
    slots: [
      { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null },
      { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
    ],
  },
```

- [ ] **Step 2: Add migrateSeasonalSlots function (after migrateFloristRates)**

Add this function in `configService.js` after `migrateFloristRates()`:

```js
function migrateSeasonalSlots() {
  const sc = config.storefrontCategories;
  if (!sc || sc.slots) return; // already migrated

  console.log('[SETTINGS] Migrating seasonal config: flat autoSchedule/manualOverride → slots array');
  sc.slots = [
    {
      id: 'slot1',
      wixSlug: 'seasonal',
      autoSchedule: sc.autoSchedule !== false,
      manualOverride: sc.manualOverride || null,
    },
    { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
  ];
  delete sc.autoSchedule;
  delete sc.manualOverride;
  saveConfig().catch(err => console.error('[SETTINGS] Slot migration save failed:', err.message));
}
```

- [ ] **Step 3: Call migrateSeasonalSlots in loadConfig**

In `loadConfig()`, add the call after the existing migration calls:

```js
      migrateSeasonalDates();
      migrateCategoryObjects();
      migrateAutoCategoryTranslations();
      migrateFloristRates();
      migrateSeasonalSlots();   // ← add this line
```

- [ ] **Step 4: Write the failing tests**

Create `backend/src/__tests__/configService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/appConfigRepo.js', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  nextOrderId: vi.fn().mockResolvedValue('202605-001'),
}));
vi.mock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
vi.mock('./telegram.js', () => ({ sendAlert: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

import { getActiveSeasonalSlots, getActiveSeasonalCategory, updateConfig, getConfig } from '../services/configService.js';

const SEASONAL_LIBRARY = [
  { name: "Mother's Day", slug: 'mothers-day', from: '04-20', to: '05-26', description: '', translations: {} },
  { name: 'Christmas',    slug: 'christmas',   from: '12-01', to: '12-26', description: '', translations: {} },
  { name: 'Easter',       slug: 'easter',      from: '03-28', to: '04-15', description: '', translations: {} },
];

function setSlots(slot1Overrides = {}, slot2Overrides = {}) {
  const sc = getConfig('storefrontCategories');
  updateConfig('storefrontCategories', {
    ...sc,
    seasonal: SEASONAL_LIBRARY,
    slots: [
      { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null, ...slot1Overrides },
      { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null, ...slot2Overrides },
    ],
  });
}

beforeEach(() => {
  vi.useRealTimers();
  setSlots();
});

describe('getActiveSeasonalSlots', () => {
  it('returns two entries, one per slot', () => {
    const result = getActiveSeasonalSlots();
    expect(result).toHaveLength(2);
    expect(result[0].slot.id).toBe('slot1');
    expect(result[1].slot.id).toBe('slot2');
  });

  it('slot1 auto-schedules within Mother\'s Day range', () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    const result = getActiveSeasonalSlots();
    expect(result[0].category?.slug).toBe('mothers-day');
    expect(result[1].category).toBeNull();
  });

  it('slot1 returns null when date is outside all ranges', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
    expect(result[1].category).toBeNull();
  });

  it('slot1 manualOverride wins over date-based auto', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    setSlots({ manualOverride: 'christmas' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category?.slug).toBe('christmas');
  });

  it('slot2 manualOverride activates independently of slot1', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    setSlots({}, { manualOverride: 'easter' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
    expect(result[1].category?.slug).toBe('easter');
  });

  it('slot2 autoSchedule:false never auto-activates even when date matches', () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    // slot2 has autoSchedule:false (default in setSlots)
    const result = getActiveSeasonalSlots();
    expect(result[1].category).toBeNull();
  });

  it('manualOverride with unknown slug returns null', () => {
    setSlots({ autoSchedule: false, manualOverride: 'does-not-exist' });
    const result = getActiveSeasonalSlots();
    expect(result[0].category).toBeNull();
  });
});

describe('getActiveSeasonalCategory (backward compat wrapper)', () => {
  it('returns the slot1 category', () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    expect(getActiveSeasonalCategory()?.slug).toBe('mothers-day');
  });

  it('returns null when slot1 has no active category', () => {
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(getActiveSeasonalCategory()).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests — confirm they FAIL (missing exports)**

```bash
cd backend && npx vitest run src/__tests__/configService.test.js 2>&1 | tail -20
```

Expected: FAIL — `getActiveSeasonalSlots is not a function` or similar import error.

- [ ] **Step 6: Add resolveSlot + getActiveSeasonalSlots + update getActiveSeasonalCategory**

Replace the `getActiveSeasonalCategory` export at the bottom of `configService.js` with:

```js
function resolveSlot(slot, seasonal) {
  if (!slot) return null;
  if (slot.manualOverride) {
    const found = seasonal.find(s => s.slug === slot.manualOverride);
    if (found) return { name: found.name, slug: found.slug, description: found.description || '', translations: found.translations || {} };
  }
  if (slot.autoSchedule) {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const found = seasonal.find(s => mmdd >= s.from && mmdd <= s.to);
    if (found) return { name: found.name, slug: found.slug, description: found.description || '', translations: found.translations || {} };
  }
  return null;
}

export function getActiveSeasonalSlots() {
  const sc = config.storefrontCategories;
  const seasonal = sc.seasonal || [];
  const slots = sc.slots || [];
  return slots.map(slot => ({ slot, category: resolveSlot(slot, seasonal) }));
}

export function getActiveSeasonalCategory() {
  return getActiveSeasonalSlots()[0]?.category ?? null;
}
```

- [ ] **Step 7: Run tests — confirm they PASS**

```bash
cd backend && npx vitest run src/__tests__/configService.test.js 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Run full backend suite — confirm no regressions**

```bash
cd backend && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/configService.js \
        backend/src/__tests__/configService.test.js
git commit -m "feat(seasonal): slots array in config, getActiveSeasonalSlots(), migration from flat fields"
```

---

## Phase 2 — Backend: public API + Wix sync (closes #252)

### Task 2: public.js — add seasonal2 to /categories

**Files:**
- Modify: `backend/src/routes/public.js`

- [ ] **Step 1: Update import in public.js**

Change line 9 in `backend/src/routes/public.js`:

```js
// BEFORE
import { getConfig, getActiveSeasonalCategory } from '../services/configService.js';

// AFTER
import { getConfig, getActiveSeasonalCategory, getActiveSeasonalSlots } from '../services/configService.js';
```

- [ ] **Step 2: Update /categories route**

In the `/categories` route handler (starting at line 199), replace:

```js
router.get('/categories', (_req, res) => {
  const sc = getConfig('storefrontCategories') || {};
  const seasonal = getActiveSeasonalCategory();
```

With:

```js
router.get('/categories', (_req, res) => {
  const sc = getConfig('storefrontCategories') || {};
  const activeSlots = getActiveSeasonalSlots();
  const seasonal  = activeSlots[0]?.category || null;
  const seasonal2 = activeSlots[1]?.category || null;
```

- [ ] **Step 3: Update the `all` array to include slot2 active category**

Find the line (currently around line 209):
```js
  const all = [...permanentNames, ...(seasonal ? [seasonal.name] : [])];
```

Replace with:
```js
  const all = [
    ...permanentNames,
    ...(seasonal  ? [seasonal.name]  : []),
    ...(seasonal2 ? [seasonal2.name] : []),
  ];
```

- [ ] **Step 4: Add seasonal2 to the res.json() call**

In the `res.json({...})` call, after the `seasonal:` field add `seasonal2:`:

```js
  res.json({
    permanent: permanentNames,
    seasonal: seasonal
      ? { name: seasonal.name, slug: seasonal.slug, description: seasonal.description || '', translations: seasonal.translations || {} }
      : { active: null, slug: null },
    seasonal2: seasonal2
      ? { name: seasonal2.name, slug: seasonal2.slug, description: seasonal2.description || '', translations: seasonal2.translations || {} }
      : null,
    auto: autoObjects,
    all,
    allCategories,
    categoryMap,
    seasonalSlugs,
  });
```

- [ ] **Step 5: Verify with E2E suite**

```bash
npm run harness &
sleep 3
curl -s http://localhost:3001/api/public/categories | python3 -m json.tool | grep -A2 "seasonal"
```

Expected: response includes both `"seasonal"` and `"seasonal2": null` fields.

```bash
npm run test:e2e 2>&1 | tail -10
```

Expected: 153 assertions pass.

Kill the harness: `pkill -f start-test-backend`

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/public.js
git commit -m "feat(seasonal): add seasonal2 field to GET /api/public/categories"
```

---

### Task 3: wixProductSync — loop over both slots

**Files:**
- Modify: `backend/src/services/wixProductSync.js`

- [ ] **Step 1: Update import on line 14**

```js
// BEFORE
import { getActiveSeasonalCategory, getConfig, updateConfig } from './configService.js';

// AFTER
import { getActiveSeasonalSlots, getActiveSeasonalCategory, getConfig, updateConfig } from './configService.js';
```

- [ ] **Step 2: Replace the single-slot seasonal block**

Find this block (around line 1016–1052):

```js
      // Seasonal category
      const seasonal = getActiveSeasonalCategory();
      // Prefer a dedicated Wix collection matching the seasonal slug (e.g. 'mothers-day').
      // Fall back to the generic 'seasonal' slot for categories without their own collection.
      const seasonalWixId = catMap[seasonal?.slug] || catMap['seasonal'];
      const seasonalUsesGenericSlot = seasonal && !catMap[seasonal.slug];
      if (seasonal && seasonalWixId) {
        const seasonalProductIds = [...new Set(
          allConfigRows.filter(r => parseCategoryField(r['Category']).includes(seasonal.name))
            .map(r => r['Wix Product ID']).filter(Boolean)
        )];
        catTasks.push(async () => {
          try {
            await setWixCategoryProducts(seasonalWixId, seasonalProductIds);
            const enTitle = seasonal.translations?.en?.title;
            const enDesc = seasonal.translations?.en?.description;
            if (seasonalUsesGenericSlot && (enTitle || enDesc)) {
              await updateWixCategory(seasonalWixId, {
                name: enTitle || seasonal.name,
                description: enDesc || '',
              });
            }
            try {
              await pushCollectionTranslations(seasonalWixId, seasonal.translations);
            } catch (err) {
              stats.errors.push(`Seasonal translations: ${err.message}`);
            }
            stats.categoriesSynced++;
            log('item', `Сезонные («${seasonal.name}»): ${seasonalProductIds.length} товаров`);
          } catch (err) {
            stats.errors.push(`Seasonal: ${err.message}`);
            log('item', `Ошибка сезонной категории: ${err.message}`, 'error');
          }
        });
      }
```

Replace entirely with:

```js
      // Seasonal slots — iterate over both configured slots independently.
      // Each slot fills its Wix collection when active, or empties it when inactive.
      const activeSlots = getActiveSeasonalSlots();
      for (const { slot, category } of activeSlots) {
        const wixId = catMap[category?.slug] || catMap[slot.wixSlug];
        if (!wixId) {
          log('item', `Слот ${slot.id} (${slot.wixSlug}): Wix-коллекция не настроена — пропуск`);
          continue;
        }
        const slotProductIds = category
          ? [...new Set(
              allConfigRows.filter(r => parseCategoryField(r['Category']).includes(category.name))
                .map(r => r['Wix Product ID']).filter(Boolean)
            )]
          : [];
        catTasks.push(async () => {
          try {
            await setWixCategoryProducts(wixId, slotProductIds);
            if (category) {
              // Only rename/retranslate when using the generic slot — dedicated
              // slug collections (e.g. 'mothers-day') already have their correct name.
              const usesGenericSlot = !catMap[category.slug];
              if (usesGenericSlot) {
                const enTitle = category.translations?.en?.title;
                const enDesc  = category.translations?.en?.description;
                if (enTitle || enDesc) {
                  await updateWixCategory(wixId, { name: enTitle || category.name, description: enDesc || '' });
                }
                try {
                  await pushCollectionTranslations(wixId, category.translations);
                } catch (err) {
                  stats.errors.push(`Slot ${slot.id} translations: ${err.message}`);
                }
              }
              stats.categoriesSynced++;
              log('item', `Слот ${slot.id} («${category.name}»): ${slotProductIds.length} товаров`);
            } else {
              log('item', `Слот ${slot.id}: нет активной категории → коллекция очищена`);
            }
          } catch (err) {
            stats.errors.push(`Slot ${slot.id}: ${err.message}`);
            log('item', `Ошибка слота ${slot.id}: ${err.message}`, 'error');
          }
        });
      }
```

- [ ] **Step 3: Run backend tests**

```bash
cd backend && npx vitest run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/wixProductSync.js
git commit -m "feat(seasonal): wixProductSync loops over both slots, empties collection when slot inactive"
```

---

## Phase 3 — Dashboard UI (closes #253)

### Task 4: StorefrontCategoriesSection + translations

**Files:**
- Modify: `apps/dashboard/src/components/settings/StorefrontCategoriesSection.jsx`
- Modify: `apps/dashboard/src/translations.js`

TDD red phase skipped — this is pure UI wiring reading existing config shape. Verification is visual build + browser check.

- [ ] **Step 1: Update sfSeasonal + sfSeasonalHint in translations.js**

In `apps/dashboard/src/translations.js`, find and update (English block, around line 706):

```js
  sfSeasonal:               'Seasonal (variable slots)',
  sfSeasonalHint:           'Define seasonal categories here — assign them to slots below',
```

Russian block (around line 1620):

```js
  sfSeasonal:               'Сезонные (переменные слоты)',
  sfSeasonalHint:           'Определите сезонные категории здесь — назначьте их слотам ниже',
```

- [ ] **Step 2: Add new slot keys after sfManualOverrideHint in translations.js**

English block (after line ~715, after `sfManualOverrideHint`):

```js
  sfSlot1:                  'Primary seasonal slot',
  sfSlot2:                  'Secondary seasonal slot',
  sfSlot2Hint:              'Select a category to show a second seasonal section. Leave empty to hide it.',
  sfSlot1Active:            'Slot 1',
  sfSlot2Active:            'Slot 2',
```

Russian block (after `sfManualOverrideHint` RU, around line ~1629):

```js
  sfSlot1:                  'Основной сезонный слот',
  sfSlot2:                  'Дополнительный сезонный слот',
  sfSlot2Hint:              'Выберите категорию, чтобы показать второй сезонный раздел. Оставьте пустым, чтобы скрыть.',
  sfSlot1Active:            'Слот 1',
  sfSlot2Active:            'Слот 2',
```

- [ ] **Step 3: Add slots derivation in StorefrontCategoriesSection.jsx**

In `StorefrontCategoriesSection.jsx`, after the existing `const permanentList = ...` and `const autoList = ...` lines, add:

```js
  const slots = sc.slots || [
    { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null },
    { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
  ];
```

- [ ] **Step 4: Update renderCategoryRow to use activeSlot instead of highlight**

Replace the existing `renderCategoryRow` function:

```jsx
  function renderCategoryRow(cat, type, i, extra) {
    const isActive = extra?.activeSlot != null;
    return (
      <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${isActive ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'}`}>
        <span className="flex-1 font-medium text-gray-700">{cat.name}</span>
        {cat.description && <span className="text-xs text-gray-400 truncate max-w-[120px]" title={cat.description}>{cat.description}</span>}
        {extra?.dates && <span className="text-xs text-gray-400">{toDisplay(cat.from)} → {toDisplay(cat.to)}</span>}
        {cat.translations?.pl?.title && <span className="text-xs text-blue-500 font-medium">{t.sfTranslated}</span>}
        {extra?.activeSlot === 'slot1' && <span className="text-xs text-green-600 font-medium">{t.sfSlot1Active}</span>}
        {extra?.activeSlot === 'slot2' && <span className="text-xs text-blue-600 font-medium">{t.sfSlot2Active}</span>}
        <button onClick={() => startEdit(type, i)} className="text-xs text-brand-600">{t.edit}</button>
        {type !== 'auto' && <button onClick={() => removeCategory(type, i)} className="text-xs text-red-400 hover:text-red-600">✕</button>}
      </div>
    );
  }
```

- [ ] **Step 5: Update the seasonal rows map in the return JSX**

Find the seasonal rows section (currently):
```jsx
          {(sc.seasonal || []).map((s, i) => {
            const isActive = sc.manualOverride === s.slug
              || (sc.autoSchedule && !sc.manualOverride && mmdd >= s.from && mmdd <= s.to);
            return renderCategoryRow(s, 'seasonal', i, { dates: true, highlight: isActive });
          })}
```

Replace with:
```jsx
          {(sc.seasonal || []).map((s, i) => {
            const isSlot1Active = slots[0]?.manualOverride === s.slug
              || (slots[0]?.autoSchedule && !slots[0]?.manualOverride && mmdd >= s.from && mmdd <= s.to);
            const isSlot2Active = slots[1]?.manualOverride === s.slug;
            const activeSlot = isSlot1Active ? 'slot1' : isSlot2Active ? 'slot2' : null;
            return renderCategoryRow(s, 'seasonal', i, { dates: true, activeSlot });
          })}
```

- [ ] **Step 6: Replace the two control rows at the bottom with slot sub-sections**

Find and replace the auto-schedule toggle div + manual override div (the last two `<div>` blocks before `</Section>`):

```jsx
      {/* Slot 1 — Primary */}
      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfSlot1}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfAutoScheduleHint}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={slots[0]?.autoSchedule !== false}
            onChange={e => onUpdate({ storefrontCategories: { ...sc, slots: slots.map((s, i) => i === 0 ? { ...s, autoSchedule: e.target.checked } : s) } })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-brand-600 rounded-full transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfManualOverride}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfManualOverrideHint}</p>
        </div>
        <select
          value={slots[0]?.manualOverride || ''}
          onChange={e => onUpdate({ storefrontCategories: { ...sc, slots: slots.map((s, i) => i === 0 ? { ...s, manualOverride: e.target.value || null } : s) } })}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1"
        >
          <option value="">{t.sfNone}</option>
          {(sc.seasonal || []).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </div>

      {/* Slot 2 — Secondary */}
      <div className="flex items-center justify-between py-3">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfSlot2}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfSlot2Hint}</p>
        </div>
        <select
          value={slots[1]?.manualOverride || ''}
          onChange={e => onUpdate({ storefrontCategories: { ...sc, slots: slots.map((s, i) => i === 1 ? { ...s, manualOverride: e.target.value || null } : s) } })}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1"
        >
          <option value="">{t.sfNone}</option>
          {(sc.seasonal || []).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </div>
```

- [ ] **Step 7: Build all three apps**

```bash
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/florist   && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/delivery  && ./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: all three succeed with no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/settings/StorefrontCategoriesSection.jsx \
        apps/dashboard/src/translations.js
git commit -m "feat(seasonal): dashboard two-slot UI — Slot 1 auto/manual + Slot 2 manual, per-slot row badges"
```

---

## Phase 4 — Wix (closes #255, after HITL #254 is done)

### Task 5: masterPage.js — dual seasonal nav + null-slot removal

**Files:**
- Modify: `src/pages/masterPage.js` *(in the Blossom-Wix repo — separate git repo)*

**Note:** This task edits the Blossom-Wix repo. Clone it locally or use `gh api` to update the file. Work in the Blossom-Wix directory, not this repo. Do not mix commits.

- [ ] **Step 1: Clone or pull Blossom-Wix repo**

```bash
# If not cloned yet:
gh repo clone OliwerO/Blossom-Wix /tmp/blossom-wix
cd /tmp/blossom-wix && git checkout Master && git pull
```

- [ ] **Step 2: Replace only the opening lines of the main try block**

In `/tmp/blossom-wix/src/pages/masterPage.js`, find exactly these 9 lines at the top of the main try block:

```js
    var categories = await getCategories();
    var seasonal = categories.seasonal;
    if (!seasonal || !seasonal.name) return;

    var lang = 'en';
    try { lang = wixWindowFrontend.multilingual.currentLanguage || 'en'; } catch (e) {}

    var t = seasonal.translations || {};
    var title = (t[lang] && t[lang].title) || (t.en && t.en.title) || seasonal.name;
    var menuLabel = title.toUpperCase();

    try { $w('#button7').label = menuLabel; } catch (e) {}
```

Replace them with:

```js
    var categories = await getCategories();
    var seasonal  = categories.seasonal;
    var seasonal2 = categories.seasonal2;

    var lang = 'en';
    try { lang = wixWindowFrontend.multilingual.currentLanguage || 'en'; } catch (e) {}

    // Slot 1 — resolve title and update homepage button if active
    var menuLabel = null;
    if (seasonal && seasonal.name) {
      var t = seasonal.translations || {};
      var title = (t[lang] && t[lang].title) || (t.en && t.en.title) || seasonal.name;
      menuLabel = title.toUpperCase();
      try { $w('#button7').label = menuLabel; } catch (e) {}
    }

    // Slot 2 — resolve title only (no homepage button for slot 2)
    var menuLabel2 = null;
    if (seasonal2 && seasonal2.name) {
      var t2 = seasonal2.translations || {};
      var title2 = (t2[lang] && t2[lang].title) || (t2.en && t2.en.title) || seasonal2.name;
      menuLabel2 = title2.toUpperCase();
    }
```

Everything after the `try { $w('#button7') ... } catch (e) {}` line (CMS image loading, Available Today logic, `seasonalSlugs`, `activeSeasonalLink`, `seasonalLabelStems`, contact labels, `transformMenuItems`, and the menu application loop) remains **unchanged** in this step.

- [ ] **Step 3: Add activeSeasonalLink2 variable**

Find the line:
```js
    var activeSeasonalLink = '/category/seasonal';
```

Add immediately after it:
```js
    var activeSeasonalLink2 = '/category/seasonal-2';
```

- [ ] **Step 4: Add isSeasonalLink2 helper after isSeasonalLink**

Find `function isSeasonalLink(link) {` and add immediately after its closing `}`:

```js
    function isSeasonalLink2(link) {
      return link && link.indexOf('/category/seasonal-2') !== -1;
    }
```

- [ ] **Step 5: Update the transformMenuItems map pass to handle slot2 + null-slot removal**

Inside `transformMenuItems`, find the `.map(function (item) {` block:

```js
      var renamed = (sourceItems || []).map(function (item) {
        var label = (item.label || '').toUpperCase();
        if (isSeasonalLabel(label) || isSeasonalLink(item.link)) {
          return Object.assign({}, item, { label: menuLabel, link: activeSeasonalLink });
        }
        if (isContactLabel(label)) {
          return Object.assign({}, item, { label: contactLabel });
        }
        return item;
      });
```

Replace with:

```js
      var renamed = (sourceItems || []).map(function (item) {
        var label = (item.label || '').toUpperCase();
        if (isSeasonalLink2(item.link)) {
          if (!menuLabel2) return null;  // slot2 inactive — remove from menu
          return Object.assign({}, item, { label: menuLabel2, link: activeSeasonalLink2 });
        }
        if (isSeasonalLabel(label) || isSeasonalLink(item.link)) {
          if (!menuLabel) return null;   // slot1 inactive — remove from menu
          return Object.assign({}, item, { label: menuLabel, link: activeSeasonalLink });
        }
        if (isContactLabel(label)) {
          return Object.assign({}, item, { label: contactLabel });
        }
        return item;
      });
      renamed = renamed.filter(Boolean);
```

Also add `var activeSeasonalLink2 = '/category/seasonal-2';` alongside the existing `var activeSeasonalLink = '/category/seasonal';` line.

- [ ] **Step 6: Add slot2 deduplication after existing slot1 dedup**

Find the slot1 dedup block:

```js
      var seenActiveSeasonal = false;
      renamed = renamed.filter(function (item) {
        if ((item.link || '') === activeSeasonalLink) {
          if (seenActiveSeasonal) return false;
          seenActiveSeasonal = true;
        }
        return true;
      });
```

Add immediately after it:

```js
      var seenActiveSeasonal2 = false;
      renamed = renamed.filter(function (item) {
        if ((item.link || '') === activeSeasonalLink2) {
          if (seenActiveSeasonal2) return false;
          seenActiveSeasonal2 = true;
        }
        return true;
      });
```

- [ ] **Step 7: Commit and push to Blossom-Wix repo**

```bash
cd /tmp/blossom-wix
git add src/pages/masterPage.js
git commit -m "feat(seasonal): handle seasonal2 slot, explicit null-slot nav removal for both slots"
git push origin Master
```

- [ ] **Step 8: Confirm push succeeded**

```bash
gh api repos/OliwerO/Blossom-Wix/commits/Master -q '.sha' 2>/dev/null
```

---

## Pre-PR Verification

- [ ] **Backend tests**

```bash
cd backend && npx vitest run 2>&1 | tail -5
```

Expected: all pass.

- [ ] **E2E suite**

```bash
npm run harness &
sleep 3
npm run test:e2e 2>&1 | tail -5
pkill -f start-test-backend
```

Expected: 153/153.

- [ ] **Build all three apps**

```bash
cd apps/florist   && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -3
cd apps/delivery  && ./node_modules/.bin/vite build 2>&1 | tail -3
```

Expected: all succeed.

- [ ] **CHANGELOG.md** — add entry: new `slots` config shape, deprecated `autoSchedule`/`manualOverride` flat fields (auto-migrated).

- [ ] **BACKLOG.md** — check off issues #251, #252, #253, #255.
