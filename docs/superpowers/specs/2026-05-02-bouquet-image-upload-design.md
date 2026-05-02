# Bouquet Image Upload + Driver Display — Design Spec

**Date:** 2026-05-02
**Status:** Draft, awaiting owner review
**Scope:** Owner + florist can attach a photo to a bouquet from the florist app or dashboard. Photo is stored in Wix Media, surfaces on the Wix storefront, and renders on the driver's `DeliveryCard` so the driver knows which physical bouquet to grab.

---

## 1. Goals

- Owner pastes (clipboard) or picks (phone library / desktop file dialog) a photo for any bouquet from the florist app **or** dashboard.
- Photo replaces the current bouquet image on the Wix product listing and on the driver's view of any pending order containing that bouquet.
- Owner can remove a photo (return to no-image state). Florists can upload and replace, but cannot remove.
- Architecture survives the Phase 6 (Product Config → PG) and Phase 7 (Airtable retirement) migrations without re-design.

## 2. Non-goals

- Per-variant images. One image per bouquet group; all variants of that bouquet share the URL.
- Image gallery. Single main image only — gallery may be added later if Wix listing polish needs it.
- Custom per-order photos (florist photographing the actual composed bouquet). Can be added later as a separate "order attachment" feature.
- Image editing (crop, rotate, filters) inside the apps.

## 3. Architecture

```
[Florist app]                 [Dashboard app]
BouquetCard                   ProductCard
  └─ <BouquetImageEditor>  (shared component) ──┐
                                                │
                                       POST multipart
                                                │
                                                ▼
                              Backend  /products/:wixProductId/image
                                 1. Validate (size, MIME, role)
                                 2. Wix Media: Generate File Upload URL
                                 3. PUT bytes to signed URL
                                 4. Wix Media: poll for ready
                                 5. Wix Stores: clear existing media + POST /products/:id/media
                                 6. productRepo.setImage(wixProductId, url)
                                       → today: Airtable Product Config rows (all variants of group)
                                       → Phase 6: PG product_config.image_url
                                 7. SSE 'product_image_changed' { wixProductId, imageUrl }
                                 8. audit_log entry

[Delivery app]
DeliveryCard
  └─ <BouquetImageView>  (shared, read-only)
        Source: delivery.bouquetSummary[i].imageUrl
        (resolved server-side from order line → bouquet group → first variant Image URL)
```

### Key invariants

- **File of record = Wix Media.** The local DB (Airtable today, PG tomorrow) only caches the URL string. Migration-safe by construction.
- **Single repo abstraction** (`productRepo.setImage` / `getImage` / `getImagesBatch`) hides the Airtable→PG swap. Matches existing `stockRepo` / `orderRepo` pattern.
- **All variants of one bouquet group share the URL.** `groupByProduct` already uses the first variant's image — keep that contract; write the same URL to every variant row of the group on update.
- **Driver image read uses existing `GET /orders/:id` and `GET /deliveries` endpoints.** Backend joins order line → bouquet group → image URL once per response. No extra Wix calls on the driver path.
- **Phase 7 retirement:** zero changes. Wix Media + PG remain. URL string survives.

## 4. Data flow

### 4.1 Upload (florist or owner)

1. User pastes (Cmd/Ctrl+V on focused card) **or** taps the image slot → file picker opens (`<input type="file" accept="image/*" capture>`).
2. Frontend reads the file → resizes client-side via canvas to max 1200px long edge, JPEG quality 0.85 → typical payload <500KB.
3. POST `/api/products/:wixProductId/image` (multipart). Role gate: `florist` or `owner`.
4. Backend pipeline:
   1. MIME guard (`image/jpeg`, `image/png`, `image/webp`), size <5MB.
   2. `wixMediaClient.generateUploadUrl({ mimeType, fileName })` → signed `uploadUrl`.
   3. `wixMediaClient.uploadFile(uploadUrl, buffer, mimeType)`.
   4. `wixMediaClient.pollForReady(fileId, { timeoutMs: 10000 })`.
   5. If existing image present on the product: `wixMediaClient.deleteFiles([oldFileId])` (best-effort, log on fail).
   6. `wixProductSync.attachMediaToProduct(wixProductId, fileUrl)` — wrapper around `POST /stores/v1/products/:id/media`. Replaces all existing media so single-image semantic holds.
   7. `productRepo.setImage(wixProductId, fileUrl)` — patches `Image URL` on every Product Config row whose `Wix Product ID` equals `wixProductId`.
   8. SSE `broadcast({ type: 'product_image_changed', wixProductId, imageUrl: fileUrl })`.
   9. `audit_log` row: `entity_type='product'`, `action='image_set'`, `diff: { before: oldUrl, after: fileUrl }`.
5. Frontend optimistically swaps the preview before POST. Confirms on 200. Reverts and toasts on failure.

### 4.2 Remove (owner only)

1. Owner taps the remove control on the image → confirm dialog.
2. DELETE `/api/products/:wixProductId/image`.
3. Backend pipeline:
   1. Resolve current `Image URL` from `productRepo.getImage`.
   2. Wix product media delete (clear all media for product).
   3. `wixMediaClient.deleteFiles([fileId])` (best-effort).
   4. `productRepo.setImage(wixProductId, '')` for all variants.
   5. SSE broadcast `{ type: 'product_image_changed', wixProductId, imageUrl: '' }`.
   6. `audit_log`: `action='image_remove'`.

### 4.3 Driver read

- `GET /api/orders/:id`, `GET /api/orders` (florist+owner), `GET /api/deliveries` (driver) already resolve order lines and group them into `bouquetSummary`. Add `imageUrl` to each summary entry by batch-loading distinct `Wix Product ID`s through `productRepo.getImagesBatch(productIds)`.
- Delivery app subscribes to existing SSE channel; on `product_image_changed`, patches matching deliveries in the in-memory list (no full reload).

## 5. Components

### 5.1 New (shared, `packages/shared/`)

- `components/BouquetImageEditor.jsx` — image slot with paste handler, file picker, preview, upload state, remove control. Props: `{ wixProductId, currentUrl, canRemove, onChange }`. Used by both florist and dashboard.
- `components/BouquetImageView.jsx` — read-only thumbnail + tap-to-zoom modal. Used by delivery card.
- `utils/imageResize.js` — canvas-based downscale to max edge 1200px, JPEG quality 0.85. Tested.
- `api/uploadImage.js` — wraps multipart POST + progress event handler.

### 5.2 Modified — florist (`apps/florist/`)

- `components/bouquets/BouquetCard.jsx` — render `<BouquetImageEditor>` in the expanded view, above `<CategoryChips>`.
- `pages/BouquetsPage.jsx` — thread `onUpdateImage(productId, url)` handler that calls the shared upload helper, marks the product dirty (already exists), and refreshes the group on success.

### 5.3 Modified — dashboard (`apps/dashboard/`)

- `components/products/ProductCard.jsx` — same image slot.
- `components/ProductsTab.jsx` — same handler thread.

### 5.4 Modified — delivery (`apps/delivery/`)

- `components/DeliveryCard.jsx`:
  - Add a new section labeled "🌸 Букет" between driver instructions and address. Uses `<BouquetImageView>`. Hidden when `imageUrl` is empty.
  - Tighten address band: drop `space-y-3` → `space-y-2` on the outer `px-4 py-3` container; drop `divider`'s `pt-3` → `pt-2`. Visual goal: less dead space between address pin and the navigation pill row.
  - Investigate why the existing nav pills render as empty rounded rectangles in the driver's screenshot (Tailwind class purge or color/text contrast bug). Fix in the same PR.

### 5.5 Translations (each app's `src/translations.js`)

Keys (EN/RU pairs):
- `bouquetImage` — "Bouquet photo" / "Фото букета"
- `pasteOrPick` — "Paste or pick image" / "Вставьте или выберите фото"
- `removeImage` — "Remove" / "Удалить"
- `imageUploadFailed` — "Upload failed" / "Не удалось загрузить"
- `imageUploadSuccess` — "Photo updated" / "Фото обновлено"
- `imageInvalidType` — "JPG, PNG, or WebP only" / "Только JPG, PNG или WebP"
- `imageTooLarge` — "Max 5 MB" / "Максимум 5 МБ"
- `removeImageConfirm` — "Remove this photo?" / "Удалить это фото?"
- `bouquetSectionLabel` — "Bouquet" / "Букет" (delivery card section label)

## 6. Backend details

### 6.1 Auth and scopes

- Reuse the existing `WIX_API_KEY` env. Header: `Authorization: <key>`.
- **Required additional scope:** `Manage Media Manager` (`SCOPE.DC-MEDIA.MANAGE-MEDIAMANAGER` / permission `MEDIA.SITE_MEDIA_FILES_UPLOAD`). Existing `Manage Products` is already in place.
- **Owner pre-deploy action:** verify the production Wix API key has the Media scope. If missing, regenerate the key with both scopes and rotate `WIX_API_KEY` on Railway.

### 6.2 New: `services/wixMediaClient.js`

Thin REST wrapper over `https://www.wixapis.com/site-media/v1/...`. Methods:

- `generateUploadUrl({ mimeType, fileName, parentFolderId })` → `{ uploadUrl }`. POST `/files/generate-upload-url`.
- `uploadFile(uploadUrl, buffer, mimeType)` → `{ file: { url, id, ... } }`. PUT `uploadUrl` with body=buffer.
- `pollForReady(fileId, { timeoutMs })` → resolves when file state is `OK`. GET `/files/:id` in a loop with backoff.
- `deleteFiles([fileId])` → POST `/bulk/files/delete-files`.

All methods reuse `wixHeaders()` style. Throws on non-2xx with response body in the error message (no silent catches).

### 6.3 New: `repos/productRepo.js`

Minimal repo, lives next to `stockRepo.js` / `orderRepo.js`:

```js
async function setImage(wixProductId, imageUrl) {
  // List all PRODUCT_CONFIG rows with 'Wix Product ID' == wixProductId
  // PATCH each with { 'Image URL': imageUrl } via p-queue
  // Return { updatedCount }
}
async function getImage(wixProductId) { /* read from first variant row */ }
async function getImagesBatch(productIds) { /* Map<productId, imageUrl> */ }
```

Today: airtable-only. Phase 6: dispatch to PG when `PRODUCT_BACKEND=postgres`.

### 6.4 Routes — `routes/products.js`

- `POST /products/:wixProductId/image` — multer, single file, 5MB cap. Role gate: `florist` or `owner`. Pipeline as in §4.1.
- `DELETE /products/:wixProductId/image` — role gate: `owner` only. Pipeline as in §4.2.

### 6.5 Bouquet summary enrichment

Two touchpoints, same change:
- `routes/orders.js` — wherever `bouquetSummary` is composed, call `productRepo.getImagesBatch(distinctProductIds)` once and attach `imageUrl` to each summary entry.
- `routes/deliveries.js` — same enrichment when composing the delivery payload.

### 6.6 Observability

Every `setImage` and `removeImage` writes an `audit_log` row with the URL diff. Wix Media partial failures (file uploaded, attach failed) write a `sync_log` row flagged `level='warn'` so the owner can see orphaned uploads in the existing sync history view.

## 7. Error handling

| Failure | UX | Backend cleanup |
|---|---|---|
| MIME or size invalid (client guard) | Toast "Файл должен быть JPG/PNG/WebP, до 5 МБ" | n/a |
| MIME or size invalid (server guard) | 400 + same toast | n/a |
| `generateUploadUrl` fails | 502, toast "Wix недоступен — попробуйте позже" | nothing uploaded |
| `uploadFile` PUT fails | 502, toast | no fileId yet |
| `pollForReady` timeout (>10s) | 504, toast | best-effort `deleteFiles([fileId])`; if delete fails, log; orphan file is owner-cleanable from Wix UI; tracked in `sync_log` |
| `attachMediaToProduct` fails | 500, toast "Загружено, но не прикрепилось" | best-effort delete; `sync_log` row for owner review |
| `productRepo.setImage` fails (Airtable down) | 500 after one auto-retry, toast "Прикреплено в Wix, не сохранено локально" | no rollback (Wix already updated); periodic Wix → Airtable sync repairs on next run |
| Concurrent uploads same product | Last-write-wins on Wix product media + Airtable URL. SSE broadcasts both events; the second URL persists. Acceptable for single-owner workflow. |
| SSE delivery fails to driver | Driver app polls every visit anyway; image appears on next list reload |

**Optimistic UI:** preview swap before POST → revert + toast on error. **No silent catches** (per root CLAUDE.md pitfall #5). Every catch toasts the backend message via `err.response?.data?.error || t.imageUploadFailed`.

## 8. Testing

### 8.1 Unit (vitest)

- `packages/shared/test/imageResize.test.js` — canvas mock; verifies max-edge clamp + JPEG quality.
- `backend/src/__tests__/wixMediaClient.test.js` — mock fetch; verifies URL/headers/body for each method; covers error paths.
- `backend/src/__tests__/productRepo.test.js` — mock `airtable.list` / `airtable.update`; verifies it patches all variant rows for a given Wix Product ID.

### 8.2 Integration (vitest, against pglite + mock Wix)

- `backend/src/__tests__/products.image.integration.test.js` — POST happy path: upload → repo updated → audit row written → SSE event emitted. Tests delete path. Tests partial failure (Wix attach fails after upload) → backend returns 500, fileId logged in `sync_log`.

### 8.3 E2E (`scripts/e2e-test.js`)

New section: owner uploads PNG bouquet image → GET `/orders/:id` for an order with that bouquet → response includes `bouquetSummary[0].imageUrl == uploadedUrl`. Driver-role GET `/deliveries` returns same. Wix Media calls are intercepted by the harness's existing mock-Wix layer; the harness records the upload byte length and the attach call.

### 8.4 Component (jsdom)

- `BouquetImageEditor.test.jsx` — paste handler ingests Clipboard image, file picker handler ingests File, calls `onChange` with resized blob. Verify remove control is hidden for florist role and shown for owner role.

### 8.5 Manual verification (owner runs after deploy)

- [ ] Upload from clipboard on dashboard (desktop) → image visible on Wix storefront within 30s.
- [ ] Upload from phone library on florist app → image visible on driver delivery card after refresh.
- [ ] Remove (owner role) → image gone from Wix storefront and from driver card.
- [ ] Florist role → no remove control visible.
- [ ] Concurrent owner+florist upload to same bouquet → final image is whichever finished last; no broken state.

### 8.6 Pre-PR matrix (per root CLAUDE.md)

- [ ] Build all 3 apps locally (`apps/florist`, `apps/dashboard`, `apps/delivery`).
- [ ] `cd backend && npx vitest run` (unit + integration).
- [ ] `cd packages/shared && ../../backend/node_modules/.bin/vitest run` (98+ tests pass).
- [ ] `npm run harness && npm run test:e2e` (153+ assertions pass).

## 9. Files to create / modify

**New:**
- `packages/shared/components/BouquetImageEditor.jsx`
- `packages/shared/components/BouquetImageView.jsx`
- `packages/shared/utils/imageResize.js`
- `packages/shared/test/imageResize.test.js`
- `packages/shared/test/BouquetImageEditor.test.jsx`
- `packages/shared/api/uploadImage.js`
- `backend/src/services/wixMediaClient.js`
- `backend/src/repos/productRepo.js`
- `backend/src/__tests__/wixMediaClient.test.js`
- `backend/src/__tests__/productRepo.test.js`
- `backend/src/__tests__/products.image.integration.test.js`

**Modified:**
- `packages/shared/index.js` (exports)
- `packages/shared/CLAUDE.md` (structure block)
- `apps/florist/src/components/bouquets/BouquetCard.jsx`
- `apps/florist/src/pages/BouquetsPage.jsx`
- `apps/florist/src/translations.js`
- `apps/dashboard/src/components/products/ProductCard.jsx`
- `apps/dashboard/src/components/ProductsTab.jsx`
- `apps/dashboard/src/translations.js`
- `apps/delivery/src/components/DeliveryCard.jsx` (image section + address-band tightening + nav-pill render fix)
- `apps/delivery/src/translations.js`
- `backend/src/routes/products.js` (POST + DELETE image endpoints)
- `backend/src/routes/orders.js` (bouquet summary enrichment)
- `backend/src/routes/deliveries.js` (bouquet summary enrichment)
- `backend/CLAUDE.md` (mention productRepo + wixMediaClient in services/repos tables)
- `BACKLOG.md` (mark feature shipped under Phase 2 — Florist App / Phase 3 — Delivery App parity item)
- `CHANGELOG.md` (env scope note for `WIX_API_KEY`; new endpoints; `audit_log` action types)

## 10. Open items / risks

- **Wix scope rotation:** if the production `WIX_API_KEY` lacks the Media scope, owner must regenerate the key. Worth verifying before merge.
- **Wix Media file readiness latency:** `pollForReady` timeout is 10s. Wix sometimes takes longer in burst. If we see 504s in practice, raise to 20s and consider returning 202 Accepted with a follow-up SSE event.
- **Phase 6 productRepo dispatch:** today's repo is airtable-only. The repo file should be structured so the Phase 6 PG branch is a one-line dispatch (matching `stockRepo` / `orderRepo`). Confirm shape during implementation.
- **Nav-pill rendering bug** in delivery card is unrelated to images but caught here. Document the root cause in the PR description; if it's a Tailwind purge issue, fix the safelist or class name.
- **`Premade Bouquets` table** is not covered. The premade bouquet flow uses its own composition and does not currently render an image. If owner later wants premade-bouquet identification photos for the driver, that is a separate spec.
