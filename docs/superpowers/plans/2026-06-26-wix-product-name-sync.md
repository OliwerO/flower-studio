# Wix Product Name Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flower-studio the source of truth for Product names in all languages (EN/PL/RU/UK) so renaming a Product in the Dashboard and pushing shows the new name on the live Wix storefront in every language.

**Architecture:** Model B (ADR-0008). `product_config.translations` (`{en:{title},pl:{title},ru:{title},uk:{title}}`) owns names; `product_name` mirrors `en.title`. **Push** writes `en.title` → Wix Stores product name and `pl/ru/uk` → Wix Multilingual Translation Content API. **Pull** stops importing names for Products that already have a local English name. A one-time seed imports current Wix names so nothing is lost.

**Tech Stack:** Node + Express + Drizzle/Postgres backend; React (Vite) dashboard; Vitest; Wix Stores REST + Wix Multilingual Translation Content API.

## Global Constraints

- ES modules, `async/await`, no callbacks. Comments in English.
- Backend logic in `services/`; routes stay thin. Stock-style repos for data access.
- New backend logic must have a Vitest test (`backend/src/__tests__/`). Mock Wix — never real network calls in tests.
- Wix verification gate (CLAUDE.md): PR body names the automated proof (the Vitest specs below) or is prefixed `[unverified]`.
- PRD: GitHub issue #436. Decision record: ADR-0008. Diagnosis: memory `project_wix_name_translation_gap_2026_06_26`.
- Prod writes (the seed script) require explicit Owner approval before running.

---

## File Structure

- `backend/src/services/wixProductSync.js` — add `fetchProductTranslations`, `localNameOwned`, `buildProductContentPush`; wire Pull-guard + Push mapper. Update the "Wix owns names" header comment.
- `backend/src/services/wixNameSeed.js` *(new)* — pure mapper `buildSeedUpdatesForProduct`. Kept separate so the seed logic is unit-tested without the 1200-line sync file.
- `backend/scripts/backfill-wix-name-translations.js` *(new, DESTRUCTIVE)* — thin orchestration: read Wix, call `buildSeedUpdatesForProduct`, write `product_config`.
- `backend/src/routes/products.js` — add `'Product Name'` to `EDITABLE_FIELDS`.
- `backend/src/repos/productConfigRepo.js` — add `'Product Name'` to `EDITABLE_FIELD_MAP`.
- `apps/dashboard/src/components/products/ProductCard.jsx` — editable EN name; Translate uses edited title; Save mirrors `Product Name`.
- `backend/src/__tests__/wixProductSync.names.test.js` *(new)* — helpers + push mapper, mocked fetch.
- `backend/src/__tests__/wixNameSeed.test.js` *(new)* — seed mapper.
- `backend/src/__tests__/productConfig.editableName.integration.test.js` *(new)* — PATCH accepts Product Name.
- Docs: `CLAUDE.md`, `backend/CLAUDE.md`, `apps/dashboard/CLAUDE.md` comment/table touch-ups; `CHANGELOG.md`.

---

## Task 1: `fetchProductTranslations` helper (read Wix Multilingual per Product)

**Files:**
- Modify: `backend/src/services/wixProductSync.js`
- Test: `backend/src/__tests__/wixProductSync.names.test.js`

**Interfaces:**
- Produces: `export async function fetchProductTranslations(entityId)` → `{ [locale]: { title?: string, description?: string } }`, reading the `product-name` / `product-description` fields from `translation-content/v1/contents/query`. Throws on non-2xx.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/__tests__/wixProductSync.names.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('fetchProductTranslations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WIX_API_KEY', 'k');
    vi.stubEnv('WIX_SITE_ID', 's');
  });

  it('maps Wix translation-content rows to {locale:{title,description}}', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ contents: [
        { locale: 'pl', fields: { 'product-name': { textValue: 'Bukiet dnia 1 - XL' }, 'product-description': { textValue: '<p>Opis</p>' } } },
        { locale: 'ru', fields: { 'product-name': { textValue: 'Микс дня 1 - XL' } } },
      ] }),
    });
    const { fetchProductTranslations } = await import('../services/wixProductSync.js');
    const out = await fetchProductTranslations('prod-1');
    expect(out.pl).toEqual({ title: 'Bukiet dnia 1 - XL', description: '<p>Opis</p>' });
    expect(out.ru).toEqual({ title: 'Микс дня 1 - XL' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wixapis.com/translation-content/v1/contents/query',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"entityId":"prod-1"') }),
    );
  });

  it('throws on non-2xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const { fetchProductTranslations } = await import('../services/wixProductSync.js');
    await expect(fetchProductTranslations('p')).rejects.toThrow(/500|boom|translation/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js`
Expected: FAIL — `fetchProductTranslations is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/services/wixProductSync.js` (near `pushProductTranslations`, reusing `WIX_API_URL` + `wixHeaders`):

```js
/**
 * Read the PL/RU/UK/EN name + description translations Wix holds for one
 * Stores product. Inverse of pushProductTranslations — used by the one-time
 * seed (ADR-0008) and available to Pull. Returns {} when the product has no
 * translation content.
 */
export async function fetchProductTranslations(entityId) {
  const res = await fetch(`${WIX_API_URL}/translation-content/v1/contents/query`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({ query: { filter: { entityId }, cursorPaging: { limit: 50 } } }),
  });
  if (!res.ok) {
    throw new Error(`Product translation read failed for ${entityId}: ${res.status} ${await res.text()}`);
  }
  const out = {};
  for (const c of (await res.json()).contents || []) {
    const name = c.fields?.['product-name']?.textValue;
    const desc = c.fields?.['product-description']?.textValue;
    const entry = {};
    if (name) entry.title = name;
    if (desc) entry.description = desc;
    if (Object.keys(entry).length) out[c.locale] = entry;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixProductSync.js backend/src/__tests__/wixProductSync.names.test.js
git commit -m "feat(wix): add fetchProductTranslations reader for Multilingual product names (#436)"
```

---

## Task 2: Pull-guard — don't overwrite a Product Name we own

**Files:**
- Modify: `backend/src/services/wixProductSync.js` (add `localNameOwned`; wire into `runPull` ~line 698)
- Test: `backend/src/__tests__/wixProductSync.names.test.js` (append)

**Interfaces:**
- Consumes: existing wire-format row (has `'Translations'` object, `'Product Name'`).
- Produces: `export function localNameOwned(existing)` → `boolean` (true when `Translations.en.title` is set).

- [ ] **Step 1: Write the failing test (append to the names test file)**

```js
describe('localNameOwned', () => {
  it('true when a local English title exists', async () => {
    const { localNameOwned } = await import('../services/wixProductSync.js');
    expect(localNameOwned({ 'Translations': { en: { title: 'Pink Peonies' } } })).toBe(true);
  });
  it('false when translations empty or no en.title', async () => {
    const { localNameOwned } = await import('../services/wixProductSync.js');
    expect(localNameOwned({ 'Translations': {} })).toBe(false);
    expect(localNameOwned({ 'Translations': { pl: { title: 'x' } } })).toBe(false);
    expect(localNameOwned({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js -t localNameOwned`
Expected: FAIL — `localNameOwned is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add near the top helpers of `wixProductSync.js`:

```js
// ADR-0008: flower-studio owns Product names. Once a row carries a local
// English name (Translations.en.title), Pull must NOT overwrite Product Name
// from Wix — the owner renames in the Dashboard now and Push is authoritative.
export function localNameOwned(existing) {
  const t = existing?.['Translations'];
  const tr = typeof t === 'string' ? (() => { try { return JSON.parse(t); } catch { return {}; } })() : (t || {});
  return Boolean(tr?.en?.title);
}
```

Then change the Pull update line (currently `wixProductSync.js:698`):

```js
// before:
//   if (existing['Product Name'] !== productName) updates['Product Name'] = productName;
// after:
if (!localNameOwned(existing) && existing['Product Name'] !== productName) {
  updates['Product Name'] = productName;
}
```

(Leave the new-row branch at ~line 676 unchanged: a newly-discovered Product still seeds its name from Wix once.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js`
Expected: PASS (all names tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixProductSync.js backend/src/__tests__/wixProductSync.names.test.js
git commit -m "feat(wix): Pull no longer overwrites owned Product names (ADR-0008, #436)"
```

---

## Task 3: Seed mapper + one-time backfill script

**Files:**
- Create: `backend/src/services/wixNameSeed.js`
- Create: `backend/scripts/backfill-wix-name-translations.js` (DESTRUCTIVE)
- Test: `backend/src/__tests__/wixNameSeed.test.js`

**Interfaces:**
- Produces: `export function buildSeedUpdatesForProduct(wixProduct, localeTranslations)` → `{ 'Product Name': string, 'Translations': object }`. `wixProduct` = `{ name, description? }` (Wix Stores product); `localeTranslations` = output of `fetchProductTranslations`. EN title is always the Wix Stores name (canonical); PL/RU/UK titles/descriptions come from `localeTranslations`; EN description from the Stores product description when present.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/__tests__/wixNameSeed.test.js
import { describe, it, expect } from 'vitest';
import { buildSeedUpdatesForProduct } from '../services/wixNameSeed.js';

describe('buildSeedUpdatesForProduct', () => {
  it('uses Wix Stores name as canonical en.title and folds in locale translations', () => {
    const out = buildSeedUpdatesForProduct(
      { name: 'Mix of the Day 1 - XL', description: 'Daily mix' },
      { pl: { title: 'Bukiet dnia 3 - M' }, ru: { title: 'Микс дня 3 - M' } },
    );
    expect(out['Product Name']).toBe('Mix of the Day 1 - XL');
    expect(out['Translations'].en.title).toBe('Mix of the Day 1 - XL');
    expect(out['Translations'].en.description).toBe('Daily mix');
    // stale locale names are seeded verbatim so the owner sees + fixes them
    expect(out['Translations'].pl.title).toBe('Bukiet dnia 3 - M');
    expect(out['Translations'].ru.title).toBe('Микс дня 3 - M');
  });

  it('omits en.description when the Stores product has none', () => {
    const out = buildSeedUpdatesForProduct({ name: 'Pink Peonies' }, {});
    expect(out['Translations'].en).toEqual({ title: 'Pink Peonies' });
    expect(out['Translations'].pl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixNameSeed.test.js`
Expected: FAIL — cannot find module `wixNameSeed.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/wixNameSeed.js
// ADR-0008 one-time seed mapper. Builds the product_config updates that import
// current Wix names into flower-studio ownership. Pure — unit-tested without I/O.

const SECONDARY = ['pl', 'ru', 'uk'];

export function buildSeedUpdatesForProduct(wixProduct, localeTranslations = {}) {
  const name = wixProduct?.name || '';
  const translations = { en: { title: name } };
  if (wixProduct?.description) translations.en.description = wixProduct.description;
  for (const locale of SECONDARY) {
    const t = localeTranslations[locale];
    if (!t) continue;
    const entry = {};
    if (t.title) entry.title = t.title;
    if (t.description) entry.description = t.description;
    if (Object.keys(entry).length) translations[locale] = entry;
  }
  return { 'Product Name': name, 'Translations': translations };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/wixNameSeed.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the backfill script (orchestration only)**

```js
// backend/scripts/backfill-wix-name-translations.js
// DESTRUCTIVE: writes prod product_config. ADR-0008 one-time seed — imports
// current Wix names (EN Stores name + PL/RU/UK Multilingual product-name) into
// product_config.translations so flower-studio owns Product names going forward.
//
// Run once, with Owner approval, from backend/ with prod creds in env:
//   railway run --service flower-studio-backend node scripts/backfill-wix-name-translations.js
//
// Idempotent: re-running re-seeds the same values (safe). It seeds ALL variant
// rows of each Wix product so the per-variant Translations stay consistent.

import { fetchAllProducts, fetchProductTranslations } from '../src/services/wixProductSync.js';
import * as productConfigRepo from '../src/repos/productConfigRepo.js';
import { buildSeedUpdatesForProduct } from '../src/services/wixNameSeed.js';

if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
  console.error('[seed] WIX_API_KEY / WIX_SITE_ID not set. Aborting.');
  process.exit(1);
}

const products = await fetchAllProducts();
console.log(`[seed] ${products.length} Wix products`);
const rows = await productConfigRepo.list();
let seeded = 0;
for (const p of products) {
  let locales = {};
  try { locales = await fetchProductTranslations(p.id); }
  catch (e) { console.warn(`[seed] translations read failed for ${p.name}: ${e.message}`); }
  const updates = buildSeedUpdatesForProduct(p, locales);
  const variantRows = rows.filter(r => r['Wix Product ID'] === p.id);
  for (const r of variantRows) {
    await productConfigRepo.update(r.id, updates);
    seeded++;
  }
  console.log(`[seed] ${p.name}: ${variantRows.length} rows`);
}
console.log(`[seed] done — ${seeded} variant rows seeded`);
process.exit(0);
```

> If `fetchAllProducts` is not already exported from `wixProductSync.js`, export the existing internal product-fetch helper (the one used by `fetchWixData`) under that name in this task. Verify the name first: `grep -n "async function fetch.*[Pp]roducts" backend/src/services/wixProductSync.js`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/wixNameSeed.js backend/scripts/backfill-wix-name-translations.js backend/src/__tests__/wixNameSeed.test.js
git commit -m "feat(wix): one-time seed mapper + backfill script for Product names (ADR-0008, #436)"
```

---

## Task 4: Allow editing `Product Name` via PATCH /products/:id

**Files:**
- Modify: `backend/src/routes/products.js` (`EDITABLE_FIELDS`, ~line 142)
- Modify: `backend/src/repos/productConfigRepo.js` (`EDITABLE_FIELD_MAP`, ~line 203)
- Test: `backend/src/__tests__/productConfig.editableName.integration.test.js`

**Interfaces:**
- Produces: PATCH `/products/:id` accepts `{ "Product Name": string }` and persists it (mirrors `en.title`). The Dashboard Save (Task 5) sends `Product Name` + `Translations` together.

- [ ] **Step 1: Write the failing test**

Follow the existing pglite integration pattern (see other `*.integration.test.js`). Minimal shape:

```js
// backend/src/__tests__/productConfig.editableName.integration.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import * as productConfigRepo from '../repos/productConfigRepo.js';

describe('productConfig accepts Product Name edits', () => {
  it('update persists Product Name', async () => {
    const created = await productConfigRepo.create({
      'Product Name': 'Old Name', 'Variant Name': 'L',
      'Wix Product ID': 'p1', 'Wix Variant ID': 'v1',
    });
    const updated = await productConfigRepo.update(created.id, { 'Product Name': 'New Name' });
    expect(updated['Product Name']).toBe('New Name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/productConfig.editableName.integration.test.js`
Expected: FAIL — `Product Name` filtered out by `EDITABLE_FIELD_MAP`, value unchanged (`'Old Name'`).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/repos/productConfigRepo.js` `EDITABLE_FIELD_MAP` (~line 203) add:

```js
  'Product Name': true,
```

In `backend/src/routes/products.js` `EDITABLE_FIELDS` (~line 142) add `'Product Name'`:

```js
const EDITABLE_FIELDS = [
  'Product Name',
  'Price', 'Quantity', 'Lead Time Days', 'Active', 'Visible in Wix',
  'Category', 'Key Flower', 'Product Type', 'Min Stems',
  'Sort Order', 'Available From', 'Available To',
  'Description', 'Translations',
];
```

Confirm `fromFields` in `productConfigRepo.js` already maps `'Product Name' → productName` (it does, ~line 81). No mapper change needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/productConfig.editableName.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/products.js backend/src/repos/productConfigRepo.js backend/src/__tests__/productConfig.editableName.integration.test.js
git commit -m "feat(products): allow editing Product Name via PATCH (ADR-0008, #436)"
```

---

## Task 5: Dashboard — editable EN name, fixed Translate, Save mirror

**Files:**
- Modify: `apps/dashboard/src/components/products/ProductCard.jsx`

**Interfaces:**
- Consumes: PATCH `/products/:id` with `Product Name` (Task 4); Push picks up `en.title` (Task 6).
- Produces: the owner can rename a Product's English name, Translate to all locales, review, and Save — persisting `Product Name` + `Translations` across every variant.

> No TDD red phase — the dashboard has no Vitest runner; this is UI wiring (per workflow-config). The behavior is proven by the build + the end-to-end demo in Task 7 and the Push test in Task 6.

- [ ] **Step 1: Add an editable English-name field in `ProductDescriptionEditor`**

Inside the editing block of `ProductDescriptionEditor` (above the description textarea, ~line 118), add a name input bound to `draft.translations.en.title`:

```jsx
<input
  value={draft.translations.en?.title || ''}
  onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, en: { ...(d.translations.en || {}), title: e.target.value } } }))}
  placeholder={t.prodNamePlaceholder || 'Product name (English)'}
  className="w-full text-sm font-medium px-2 py-1 border rounded-lg mb-1"
/>
```

- [ ] **Step 2: Fix the Translate source (the bug)**

Change `handleTranslate` (`ProductCard.jsx:69-70`) to translate the *edited* English title, not the stale `group.name`:

```js
// before: if (group.name) { const titleRes = await client.post('/products/translate', { text: group.name, type: 'title' }); ... }
const sourceTitle = draft.translations?.en?.title || group.name;
if (sourceTitle) {
  const titleRes = await client.post('/products/translate', { text: sourceTitle, type: 'title' });
  for (const lang of ['en', 'pl', 'ru', 'uk']) {
    trans[lang] = { ...(trans[lang] || {}), title: titleRes.data[lang] || '' };
  }
}
```

Update the Translate button `disabled` guard (line 111) accordingly:

```jsx
disabled={translating || (!(draft.translations?.en?.title || group.name) && !draft.description)}
```

- [ ] **Step 3: Mirror Product Name on Save**

Extend `handleSave` (`ProductCard.jsx:88`) to persist the English title as `Product Name` too:

```js
function handleSave() {
  const enTitle = draft.translations?.en?.title?.trim();
  if (enTitle) onUpdateAll(group, 'Product Name', enTitle);
  onUpdateAll(group, 'Description', draft.description);
  onUpdateAll(group, 'Translations', JSON.stringify(draft.translations));
  setEditing(false);
}
```

(`onUpdateAll` → `updateAllVariants` in `ProductsTab.jsx` already PATCHes every variant and patches local rows in place, so the card header `group.name` refreshes.)

- [ ] **Step 4: Add the translation key**

In `apps/dashboard/src/translations.js` add `prodNamePlaceholder` (Russian UI), e.g. `prodNamePlaceholder: 'Название (английское)'`.

- [ ] **Step 5: Build to verify**

Run: `cd apps/dashboard && ./node_modules/.bin/vite build`
Expected: build succeeds, no missing-import / syntax errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/products/ProductCard.jsx apps/dashboard/src/translations.js
git commit -m "feat(dashboard): editable Product name + fix Translate source + Save mirror (ADR-0008, #436)"
```

---

## Task 6: Push EN name + translations (and stop empty-description clobber)

**Files:**
- Modify: `backend/src/services/wixProductSync.js` (add `buildProductContentPush`; wire into `runPush` description phase ~lines 1148-1193)
- Test: `backend/src/__tests__/wixProductSync.names.test.js` (append)

**Interfaces:**
- Produces: `export function buildProductContentPush(row)` → `{ name?: string, description?: string, translations: object }`. `name` = `translations.en.title` (omitted when empty). `description` = `translations.en.description || row['Description']` (omitted when empty — prevents clobbering the Wix description with `''`). `translations` = the parsed object passed to `pushProductTranslations`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('buildProductContentPush', () => {
  it('emits en name + translations, includes description when present', async () => {
    const { buildProductContentPush } = await import('../services/wixProductSync.js');
    const out = buildProductContentPush({
      'Translations': { en: { title: 'Pink Peonies', description: 'Lovely' }, pl: { title: 'Różowe piwonie' } },
      'Description': '',
    });
    expect(out.name).toBe('Pink Peonies');
    expect(out.description).toBe('Lovely');
    expect(out.translations.pl.title).toBe('Różowe piwonie');
  });

  it('omits description when EN description and row Description are both empty (no clobber)', async () => {
    const { buildProductContentPush } = await import('../services/wixProductSync.js');
    const out = buildProductContentPush({ 'Translations': { en: { title: 'Pink Peonies' } }, 'Description': '' });
    expect(out.name).toBe('Pink Peonies');
    expect(out.description).toBeUndefined();
  });

  it('omits name when there is no en.title', async () => {
    const { buildProductContentPush } = await import('../services/wixProductSync.js');
    const out = buildProductContentPush({ 'Translations': {}, 'Description': 'x' });
    expect(out.name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js -t buildProductContentPush`
Expected: FAIL — `buildProductContentPush is not a function`.

- [ ] **Step 3: Write minimal implementation + wire into runPush**

Add the mapper to `wixProductSync.js`:

```js
// ADR-0008: assemble the name/description/translations payload for one Product
// push. EN name goes to the Stores product; description is omitted when empty
// so Push never clobbers a Wix description with ''. translations → Multilingual.
export function buildProductContentPush(row) {
  const raw = row['Translations'];
  const translations = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return {}; } })()
    : (raw || {});
  const out = { translations };
  const name = translations?.en?.title?.trim();
  if (name) out.name = name;
  const desc = (translations?.en?.description || row['Description'] || '').trim();
  if (desc) out.description = textToHtml(desc);
  return out;
}
```

Then rewrite the `descByProduct` build + push loop (`runPush`, ~lines 1148-1193) to use it:

```js
const descRows = await productConfigRepo.list({ activeOnly: true });
const byProduct = new Map();
for (const row of descRows) {
  const pid = row['Wix Product ID'];
  if (!pid || byProduct.has(pid)) continue;
  const content = buildProductContentPush(row);
  if (content.name || content.description || Object.keys(content.translations).some(l => l !== 'en' && content.translations[l])) {
    byProduct.set(pid, content);
  }
}

const staleDescIds = new Set();
const descQueue = new PQueue({ concurrency: PUSH_CONCURRENCY });
await Promise.all([...byProduct.entries()].map(([productId, content]) => descQueue.add(async () => {
  try {
    await updateWixProductContent(productId, { name: content.name, description: content.description });
    stats.descriptionsSynced++;
  } catch (err) {
    if (err instanceof WixProductNotFoundError) { staleDescIds.add(productId); return; }
    stats.errors.push(`Description ${productId}: ${err.message}`);
  }
  try {
    await pushProductTranslations(productId, content.translations);
    if (Object.keys(content.translations).some(l => l !== 'en' && content.translations[l])) stats.translationsSynced++;
  } catch (err) {
    stats.errors.push(`Product translations ${productId}: ${err.message}`);
  }
})));
```

(`updateWixProductContent` already skips `name`/`description` when `undefined` — so an omitted description is a no-op, not a clobber.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/wixProductSync.names.test.js`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wixProductSync.js backend/src/__tests__/wixProductSync.names.test.js
git commit -m "feat(wix): Push EN name + PL/RU/UK translations, no empty-desc clobber (ADR-0008, #436)"
```

---

## Task 7: Docs, comments, summaries, full verification

**Files:**
- Modify: `backend/src/services/wixProductSync.js` (header comment lines 6-7)
- Modify: `CLAUDE.md` (Integrations / any "Wix owns product names" mention), `backend/CLAUDE.md` (products.js + wixProductSync.js rows), `apps/dashboard/CLAUDE.md` (Products tab note)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the ownership comments**

In `wixProductSync.js` replace the header (lines 6-7):

```js
// Wix owns: images, variant option names
// flower-studio owns: product NAMES (all locales — ADR-0008), prices, lead
//   times, stock, categories, active status
```

Grep for other stale claims and fix: `grep -rni "wix owns.*name" CLAUDE.md backend/CLAUDE.md backend/src`.

- [ ] **Step 2: Update CLAUDE.md docs**

Note in `backend/CLAUDE.md` (products.js row) that `Product Name` is now editable and that names are flower-studio-owned per ADR-0008. Add a one-line Known-Pitfall pointer: "Product names are owned by flower-studio (ADR-0008) — Pull must not overwrite a row whose `Translations.en.title` is set; see `localNameOwned`."

- [ ] **Step 3: CHANGELOG entry**

Add a dated entry summarizing: ownership reversal (ADR-0008), seed script (one-time, DESTRUCTIVE), Pull-guard, Push now sends names, Dashboard rename UX.

- [ ] **Step 4: Run the full backend verification matrix**

```bash
cd backend && npx vitest run
cd /Users/oliwer/Projects/flower-studio && npm run harness & sleep 4 && npm run test:e2e
cd apps/dashboard && ./node_modules/.bin/vite build
```

Expected: all green. Quote the output in the PR.

- [ ] **Step 5: End-to-end demo (Wix verification gate)**

Document the proof in the PR body: the new Vitest specs (`wixProductSync.names.test.js`, `wixNameSeed.test.js`, `productConfig.editableName.integration.test.js`). For the live round-trip, after the seed runs (Owner-approved), demo on one Product: rename in Dashboard → Translate → Save → Push → confirm the live PL/RU/UK page shows the new name (re-run the read-only Wix scan from the diagnosis to compare EN vs PL/RU/UK).

- [ ] **Step 6: Write summaries**

`dev-summary` (file paths + what to watch) and `owner-summary` (plain language: "Rename bouquets in the dashboard now; after Push all languages update on the website; don't rename in Wix directly anymore").

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md backend/CLAUDE.md apps/dashboard/CLAUDE.md backend/src/services/wixProductSync.js CHANGELOG.md
git commit -m "docs(wix): record Product-name ownership reversal (ADR-0008, #436)"
```

---

## Self-Review

**Spec coverage (PRD #436):**
- S1 seed → Task 3. Pull-guard → Task 2. `fetchProductTranslations` reader (needed by seed) → Task 1.
- S2 dashboard rename + Translate fix + Save mirror → Task 5; backend `Product Name` editable → Task 4.
- S3 push names + empty-desc guard → Task 6.
- ADR-0008 already written; ownership comments/doc sync → Task 7.
- Acceptance criteria 1 (dashboard shows names) → Tasks 3+5; 2 (round-trip) → Tasks 5+6 + demo; 3 (Pull no revert) → Task 2; 4 (Mix of the day fixed) → seed+translate+push demo; 5 (Wix downstream) → Task 6 + docs.
- Dropped scope: S4 florist parity, S5 cleanup — intentionally out (ADR-0008 / grill).

**Placeholder scan:** none — every code step has concrete code; the one verification note (`fetchAllProducts` export name) carries a grep to confirm before use.

**Type consistency:** `fetchProductTranslations` returns `{locale:{title,description}}` — consumed by `buildSeedUpdatesForProduct(wixProduct, localeTranslations)` (Task 3) in the same shape. `buildProductContentPush` returns `{name?,description?,translations}` — consumed by the runPush loop and `updateWixProductContent({name,description})` / `pushProductTranslations(translations)`, matching their existing signatures. `localNameOwned(existing)` reads `Translations.en.title`, the same field `buildProductContentPush` emits.
