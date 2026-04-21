# Available Today — multilingual playbook

End-to-end reference for how the **Available Today** nav link and category
page render across EN / PL / RU / UK, and what to do if it silently
disappears on one of the non-primary languages again.

## The short version

Three independent systems write a label for this category. If any of them
drifts, the visible result drifts too.

| Layer | Source | Rendered on |
|---|---|---|
| **Velo override** | `/api/public/categories` → `auto[slug=available-today].translations` | Nav menu (`masterPage.js`) and the category page heading (`Category Page.qyxgv.js`) |
| **Wix Multilingual Translation Content** | Owner in Airtable → pushed by `pushCollectionTranslations()` on each sync | Breadcrumbs, Wix Stores native UI, and anywhere Velo doesn't override |
| **Wix Stores collection native name** | `updateWixCategory(id, { name, description })` on each sync — EN only | Wix Editor menu preview and the EN site when nothing else overrides |

All three ultimately originate from the Blossom App (Airtable) translations
for the auto-category entry. Keep edits in one place; don't edit in the
Wix Translation Manager manually or the next sync will reconcile back.

## How to edit a translation

1. Open the Blossom app → settings → storefront categories → Available
   Today → edit title/description for PL / RU / UK.
2. Save. `backend/src/routes/settings.js` persists to Airtable App Config.
3. Within ~5 minutes: `masterPage.js` picks up the new string because it
   fetches `/api/public/categories` fresh each page load (5-min Wix-side
   cache). Nav + category-page heading update without a site publish.
4. At the next scheduled `runPush` (or a manual trigger): the backend's
   `pushCollectionTranslations()` writes PL / RU / UK to Wix Multilingual
   Translation Content. Breadcrumbs and native Wix Stores UI update.
5. Republish the site only if you want the Wix Editor preview to match
   (editor doesn't run Velo, so it shows the native Wix Store collection
   name — which only updates when EN changes).

## The fix path, layered

Historical reference — each layer was a necessary step and the earlier
ones don't substitute for the later ones.

1. **Seed the backend defaults** (1fffa70): filled in real EN / PL / RU /
   UK translation strings in `DEFAULTS.storefrontCategories.auto` so
   `applyLang()` in `docs/wix-velo-categories.js` doesn't fall through to
   the hardcoded English `cat.name` on secondary languages. Added a
   `migrateAutoCategoryTranslations()` backfill so existing Airtable
   configs catch up on next restart.
2. **Push EN collection name to Wix** (1fffa70 + f191de5): mirrored the
   seasonal path by calling `updateWixCategory(availTodayId, { name,
   description })` with the EN translation, so the Wix-native collection
   label matches the owner's configured name.
3. **Push PL / RU / UK to Wix Multilingual** (`pushCollectionTranslations`
   in `backend/src/services/wixProductSync.js`): without a published
   translation per locale, Wix Stores strips the collection link from the
   non-primary-language menus entirely. Writes to the Translation Content
   API with `published: true`. Query-then-create-or-update so re-runs are
   idempotent; skips any locale whose config has blank title + description
   to preserve hand-typed Translation Manager edits.
4. **Synthesize the nav item in Velo when missing** (blossom-wix
   `src/pages/masterPage.js`): the horizontal menu's items are
   per-language in the Wix Editor, and the owner only configured Available
   Today for the EN menu. When `menuItems` on the current language doesn't
   contain a link matching `/category/available-today`, `masterPage.js`
   constructs a fresh item `{ label, link: '/category/available-today' }`
   instead of silently dropping the entry. Still driven by `productCount`
   so zero qualifying products hides it.

## Known-good reference IDs

Useful when calling the Wix REST API directly (one-shot fixes via the
Wix MCP or a backfill script).

| Name | Value |
|---|---|
| Blossom site ID | `f4c4624f-6142-4b4c-a629-312adfb37faf` |
| Wix Stores Collection translation schema ID | `5b35dfe1-da21-4071-aab5-2cec870459c0` |
| Schema key (for Published Content queries) | `appId=1380b703-ce81-ff05-f115-39571d94dfcd`, `entityType=collection` (singular!), `scope=GLOBAL` |
| Translation field keys | `collection-name`, `category-description` |
| Site locale codes | `en`, `pl`, `ru`, `uk` (short form, no regional variants) |
| Available Today collection ID | `0c66971a-d341-9a59-1b89-57bfaecb702e` |
| Peonies (currently active seasonal) collection ID | `bd8e21a0-e41a-be29-67d5-5dd1b19fcd37` |

## Diagnostic checklist when the nav link disappears

1. **Is `productCount > 0`?** `curl https://flower-studio-backend-production.up.railway.app/api/public/categories | jq '.auto[] | select(.slug=="available-today").productCount'`. Zero means no Lead-Time-0 products in stock — expected hide.
2. **Are backend translations non-empty?** Same endpoint, check `auto[…].translations.pl.title` is set. If blank, owner never filled them in — fix in Blossom app.
3. **Does the live site's `masterPage.js` log `synthesized` or `existing`?** Open DevTools Console on `/pl/` → look for `[masterPage] Available Today: showing (N products, …)`. `hidden` means productCount 0; nothing logged at all means masterPage.js crashed earlier — check the first `[masterPage] …` line.
4. **Are Wix Multilingual translations published?** Query
   ```
   POST /translation-published-content/v3/published-contents/query
   { "query": { "filter": {
       "schemaKey.appId":{"$eq":"1380b703-ce81-ff05-f115-39571d94dfcd"},
       "schemaKey.entityType":{"$eq":"collection"},
       "schemaKey.scope":{"$eq":"GLOBAL"},
       "entityId":{"$eq":"0c66971a-d341-9a59-1b89-57bfaecb702e"}
   }}}
   ```
   Should return three entries (`pl`, `ru`, `uk`) with `collection-name` and `category-description` fields populated.
5. **Did the backend actually run `pushCollectionTranslations`?** Check server logs for `Available Today translations:` or `Seasonal translations:` in `stats.errors`. An empty translations config silently skips.
6. **Does the owner need a republish?** For Velo-driven layers (nav + category heading) no. For breadcrumb / Wix-native UI that reads from Wix Multilingual Published Content: yes, republish the site.

## Source files in this repo

- `backend/src/routes/settings.js` — `DEFAULTS.storefrontCategories.auto` + `migrateAutoCategoryTranslations()`.
- `backend/src/routes/public.js` — `/api/public/categories` endpoint shape.
- `backend/src/services/wixProductSync.js` — `updateWixCategory()`, `pushCollectionTranslations()`, `STORES_COLLECTION_SCHEMA_ID`.
- `docs/wix-velo-categories.js` — Velo helpers + `masterPage.js` example (reference implementation).

## Source files in blossom-wix

- `src/pages/masterPage.js` — nav rename + synthesize for Available Today and seasonal.
- `src/pages/Category Page.qyxgv.js` — category page heading override.
- `src/backend/products.jsw` — Wix-side fetch wrapper around `/api/public/categories`.
