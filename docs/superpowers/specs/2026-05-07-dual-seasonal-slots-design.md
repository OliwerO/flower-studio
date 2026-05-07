# Dual Seasonal Slots — Design Spec

**Date:** 2026-05-07  
**Feature:** Extend the storefront seasonal category system from one slot to two independent variable slots.

---

## Problem

The owner can currently activate one seasonal category at a time (e.g., Mother's Day). She wants two independent variable slots so she can show two concurrent seasonal categories — or one, or none — without ever touching Wix to add or remove collections.

---

## Behavior

| Slot 1 | Slot 2 | Website shows |
|--------|--------|---------------|
| Active | Active | Both nav items visible, both Wix collections populated |
| Active | None   | Slot 1 nav item visible, slot 2 nav item removed from menu |
| None   | Active | Slot 1 nav item removed, slot 2 visible |
| None   | None   | Both nav items removed |

- **Slot 1** supports auto-schedule (date-based) or manual override — same behavior as today.
- **Slot 2** is always manual: owner explicitly picks a category or leaves it empty.
- Hiding is enforced client-side in masterPage.js (same pattern as "Available Today").
- Wix Store collections always exist (`seasonal`, `seasonal-2`); the backend empties them when a slot is inactive.

---

## Data Model

### Config shape (after migration)

```js
storefrontCategories: {
  seasonal: [
    // Shared library — owner defines seasons here once.
    // Either slot can reference any entry.
    { name: "Valentine's Day", slug: 'valentines-day', from: '01-25', to: '02-15', translations: {...} },
    { name: "Mother's Day",    slug: 'mothers-day',    from: '04-20', to: '05-26', translations: {...} },
    // ...
  ],
  slots: [
    { id: 'slot1', wixSlug: 'seasonal',   autoSchedule: true,  manualOverride: null },
    { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
  ],
  wixCategoryMap: {
    'seasonal':   '<wix-collection-id-1>',   // existing
    'seasonal-2': '<wix-collection-id-2>',   // new — owner pastes after Wix setup
  },
}
```

### Migration (automatic, on first load)

configService reads existing `autoSchedule` and `manualOverride` flat fields and writes them into `slots[0]`. Old fields are dropped. Existing saved configs require no manual intervention.

```js
// Migration pseudocode inside configService loadConfig()
// sc = saved.storefrontCategories at this point
if (!sc.slots) {
  sc.slots = [
    { id: 'slot1', wixSlug: 'seasonal', autoSchedule: sc.autoSchedule !== false, manualOverride: sc.manualOverride || null },
    { id: 'slot2', wixSlug: 'seasonal-2', autoSchedule: false, manualOverride: null },
  ];
  delete sc.autoSchedule;
  delete sc.manualOverride;
}
```

---

## Backend Changes

### `backend/src/services/configService.js`

- Add `slots` to `DEFAULTS.storefrontCategories` (replacing flat `autoSchedule`/`manualOverride`).
- Add migration in `loadConfig()` (see above).
- Add `getActiveSeasonalSlots()` — returns `[{ slot, category }, { slot, category }]`. `category` is `null` when the slot has no active category.
- Keep `getActiveSeasonalCategory()` as a thin wrapper returning `getActiveSeasonalSlots()[0]?.category ?? null` for backward compatibility with any existing callers.

Resolution logic per slot:
```js
function resolveSlot(slot, seasonalLibrary, mmdd) {
  if (slot.manualOverride) return seasonalLibrary.find(s => s.slug === slot.manualOverride) || null;
  if (slot.autoSchedule)   return seasonalLibrary.find(s => mmdd >= s.from && mmdd <= s.to) || null;
  return null;
}
```

### `backend/src/services/wixProductSync.js`

Replace the single-seasonal sync block with a loop over both slots:

```js
const activeSlots = getActiveSeasonalSlots();

for (const { slot, category } of activeSlots) {
  const wixId = catMap[category?.slug] || catMap[slot.wixSlug];
  if (!wixId) {
    log('warn', `No Wix collection mapped for ${slot.wixSlug} — skipping`);
    continue;
  }
  if (!category) {
    await setWixCategoryProducts(wixId, []);
    log('item', `${slot.id}: no active category → Wix collection emptied`);
    continue;
  }
  const productIds = [...new Set(
    allConfigRows
      .filter(r => parseCategoryField(r['Category']).includes(category.name))
      .map(r => r['Wix Product ID'])
      .filter(Boolean)
  )];
  await setWixCategoryProducts(wixId, productIds);
  // Only rename if using the generic slot (dedicated slug collections keep their own name)
  if (!catMap[category.slug]) {
    const enTitle = category.translations?.en?.title;
    const enDesc  = category.translations?.en?.description;
    if (enTitle || enDesc) await updateWixCategory(wixId, { name: enTitle || category.name, description: enDesc });
    await pushCollectionTranslations(wixId, category.translations);
  }
  log('item', `${slot.id} («${category.name}»): ${productIds.length} products`);
}
```

### `backend/src/routes/public.js` — `GET /api/public/categories`

Keep `seasonal` = slot 1 result (exact same shape as today — backward compat for Wix Velo code that already calls this).  
Add `seasonal2` = slot 2 result (`null` when inactive).

```js
const [slot1, slot2] = getActiveSeasonalSlots();

res.json({
  // ...existing fields unchanged...
  seasonal: slot1.category
    ? { name: slot1.category.name, slug: slot1.category.slug, description: slot1.category.description || '', translations: slot1.category.translations || {} }
    : { active: null, slug: null },
  seasonal2: slot2.category
    ? { name: slot2.category.name, slug: slot2.category.slug, description: slot2.category.description || '', translations: slot2.category.translations || {} }
    : null,
  seasonalSlugs,  // unchanged — all slugs from the library
});
```

---

## Dashboard UI Changes

### `apps/dashboard/src/components/settings/StorefrontCategoriesSection.jsx`

Replace the single auto-schedule toggle + single manual override dropdown with two slot sub-sections rendered from `sc.slots`.

**Slot 1 — Primary**
- Auto-schedule toggle (same as today)
- Manual override dropdown (None + all seasonal categories)

**Slot 2 — Secondary**
- Manual override dropdown only (no auto-schedule toggle — slot 2 is always manual)
- Helper text: "Select a category to show a second seasonal slot on the website"

Each seasonal category row in the library gains a per-slot badge:
```
Mother's Day    Apr 20 → May 26    [Slot 1]    [edit] [×]
Easter          Mar 28 → Apr 15               [edit] [×]
Christmas       Dec 01 → Dec 26    [Slot 2]    [edit] [×]
```

Slot badges are computed client-side using the same `resolveSlot` logic as configService (date check + override check).

**Update handler** for each slot: `onUpdate({ storefrontCategories: { ...sc, slots: updatedSlots } })`.

### `apps/dashboard/src/translations.js`

Add keys (English + Russian):
```js
sfSlot1:           'Primary seasonal slot',
sfSlot2:           'Secondary seasonal slot',
sfSlot2Hint:       'Pick a category to show a second seasonal section on the website. Leave empty to hide it.',
sfSlot1Active:     'Slot 1',
sfSlot2Active:     'Slot 2',
```

---

## Wix Changes

### One-time setup (owner, done once)

1. In Wix Stores dashboard: create a new collection named `seasonal-2` (or any name — the slug must be `seasonal-2`).
2. In Wix Editor: add a nav menu item linking to `/category/seasonal-2` in all 4 language menus (PL/EN/UK/RU).
3. In Blossom dashboard Settings → Storefront Categories → Wix Category Map: paste the new collection's ID as the value for key `seasonal-2`.

After this, the backend controls everything.

### `src/pages/masterPage.js` (Blossom-Wix repo)

Two additions to the existing logic:

**1. Resolve slot 2 title** (same as slot 1 logic):
```js
var seasonal2 = categories.seasonal2;
var title2 = null;
if (seasonal2 && seasonal2.name) {
  var t2 = seasonal2.translations || {};
  title2 = (t2[lang] && t2[lang].title) || (t2.en && t2.en.title) || seasonal2.name;
}
var menuLabel2 = title2 ? title2.toUpperCase() : null;
var activeSeasonalLink2 = '/category/seasonal-2';
```

**2. In `transformMenuItems`** — extend to handle slot 2 items + explicit removal for both slots when null:
```js
function isSeasonalLink2(link) {
  return link && link.indexOf('/category/seasonal-2') !== -1;
}

// In the map pass:
if (isSeasonalLink2(item.link)) {
  if (!menuLabel2) return null;  // mark for removal
  return Object.assign({}, item, { label: menuLabel2, link: activeSeasonalLink2 });
}
if (isSeasonalLink(item.link) || isSeasonalLabel(label)) {
  if (!menuLabel) return null;   // mark for removal when slot 1 is also inactive
  return Object.assign({}, item, { label: menuLabel, link: activeSeasonalLink });
}

// After map, filter out nulls:
renamed = renamed.filter(Boolean);
```

Note: slot 1 removal (when `menuLabel` is null) is a behavior improvement over today — currently inactive slot 1 leaves a ghost nav item. This fix brings slot 1 in line with slot 2's behavior.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/configService.js` | DEFAULTS, migration, `getActiveSeasonalSlots()`, keep `getActiveSeasonalCategory()` as wrapper |
| `backend/src/services/wixProductSync.js` | Single-slot sync → loop over slots |
| `backend/src/routes/public.js` | Add `seasonal2` to `/categories` response |
| `apps/dashboard/src/components/settings/StorefrontCategoriesSection.jsx` | Two-slot UI replacing single toggle+dropdown |
| `apps/dashboard/src/translations.js` | New slot UI keys |
| `src/pages/masterPage.js` (Blossom-Wix) | Handle `seasonal2`, explicit removal for null slots |

---

## What Does Not Change

- `seasonal[]` library shape — owner edits seasonal categories exactly as today
- Permanent, auto, and Available Today categories — untouched
- `/api/public/products` endpoint — untouched
- `wixCategoryMap` structure — one new key (`seasonal-2`) added by owner, no code change needed
- Florist app — no changes (seasonal categories are owner-only config)

---

## Known Risks

- **wixCategoryMap missing `seasonal-2`**: If the owner hasn't completed Wix setup yet, `wixId` will be undefined for slot 2. The sync logs a warning and skips — no crash, no data loss. Slot 2 stays empty/hidden.
- **Both slots assigned the same category**: Technically possible via two manual overrides. The backend would sync the same products to both Wix collections. Not harmful but redundant. No validation is added — the owner is expected to pick distinct categories.
- **Auto-schedule for slot 1 when a date range overlaps with slot 2's manual override**: The same category could appear in slot 1 (auto) and slot 2 (manual) simultaneously if the owner doesn't notice. Same as above — redundant but harmless.
