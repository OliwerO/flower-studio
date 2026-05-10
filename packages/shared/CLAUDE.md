# Shared Package — CLAUDE.md

Cross-app utilities shared by all three frontend apps. Anything used by 2+ apps belongs here. Source of truth for the export contract: `packages/shared/index.js`.

## Structure
```
api/
  client.js                   → Axios instance with auto-attached PIN header + opt-in cachedGet/in-flight GET dedupe helper
  uploadImage.js              → uploadBouquetImage / removeBouquetImage (products) + uploadOrderImage / removeOrderImage (per-order override) — multipart wrappers
context/
  AuthContext.jsx             → PIN, role, login/logout — wraps all apps
  ToastContext.jsx            → showToast(msg, type) — success/error toasts
  LanguageContext.jsx         → EN/RU toggle, translation sync
components/
  ErrorBoundary.jsx           → React error boundary with fallback UI
  Toast.jsx                   → Toast notification renderer
  CallButton.jsx              → tel:-link button with phone formatting
  NavButtons.jsx              → Google Maps / Waze / Apple Maps quick links
  IconButton.jsx              → Square icon button primitive
  ListItem.jsx                → Tap-target list-row primitive
  Sheet.jsx                   → Bottom-sheet modal primitive (mobile UX)
  EmptyState.jsx              → Empty-list illustration + CTA
  FilterBar.jsx               → Search + filter chips composite
  BatchPickerModal.jsx        → Disambiguation modal shown when a flower variety has multiple Stock Items (Batches + Demand Entry). Used by BouquetEditor (florist) and BouquetSection (dashboard). Receives `t` prop for bilingual strings. DEPRECATED — see #288
  VarietyAllocationPicker.jsx → Hybrid two-stage Variety picker — Stage 1 typeahead, Stage 2 engine options, Owner-only "+ Create new Variety". Behind `STOCK_Y_MODEL` in BouquetEditor / BouquetSection / Step2Bouquet (florist + dashboard)
  TypeGroupHeader.jsx         → Sticky collapsible Type header for the Y-model stock list. Renders Type label, aggregate bucket totals, and expand/collapse chevron.
  VarietyListItem.jsx         → Variety row with 4-bucket header (onHand / planned / reserved / net), expand-to-Stock-Items, tap-on-reserved → premade list, tap-on-Batch → trace. Consumed by StockPanelPage (florist) and StockTab (dashboard) under `STOCK_Y_MODEL`.
  BatchTracePanel.jsx         → Inline per-Batch usage trace panel (florist uses this via BatchTraceModal; dashboard renders it directly as an inline panel).
  BatchTraceModal.jsx         → Modal wrapper around BatchTracePanel. Used by the florist app where trace opens over a sheet.
  WriteOffBatchPicker.jsx     → Batch-targeted write-off form. Excludes Demand Entries; defaults to oldest Batch by date. Behind `STOCK_Y_MODEL`.
  DissolvePremadesDialog.jsx  → Confirm modal for dissolving premade bouquets in an order
  WixPushModal.jsx            → Async-job progress modal for /products/push (florist + dashboard)
  BouquetImageEditor.jsx      → Click/paste image slot. Pass `wixProductId` for storefront product images OR `orderId` for per-order overrides. Owner-only remove via `canRemove`.
  BouquetImageView.jsx        → Read-only thumbnail with tap-to-zoom fullscreen modal for the driver delivery card
  FeedbackModal.jsx           → AI-assisted bug/feature report modal. Drives /feedback/start → /feedback/continue → /feedback/preview → /feedback/publish conversation. Props: t, apiClient, reporterRole, reporterName, appArea, onClose. Uses inline SVG icons (no lucide-react dep).
hooks/
  useOrderEditing.js          → Shared bouquet editing logic (stock filtering, line management)
  useOrderPatching.js         → Shared order/delivery PATCH helpers (patchOrder, patchDelivery)
  useDebouncedValue.js        → Standard debounce-state hook
  useLongPress.js             → Long-press gesture detection
  useStockYModelFlag.js       → Reads `stockYModelEnabled` from `/settings`. Single-flight cached.
utils/
  parseBatchName.js           → Extracts date from batch names like "Rose (14.Mar.)"
  stockName.jsx               → Formats stock display names with age/date labels
  stockMath.js                → getEffectiveStock(qty), hasStockShortfall — LOAD-BEARING per root pitfall #7
  stockAllocationEngine.js    → stockAllocationEngine(rows, reservations, requiredBy, qty) — Y-model ranked allocation options for one order line (issue #287, PRD #283)
  varietyKey.js               → 4-tuple identity helpers — `varietyKey`, `groupByVariety`, `varietyDisplayName`. NULL-aware per ADR-0006.
  timeSlots.js                → Time slot generation with lead-time filtering
  customerFilters.js          → Customer search + filter predicates (matchesSearch/Filters, EMPTY_FILTERS)
  productGroup.js             → Storefront product grouping (groupByProduct, parseCats, priceRange, ...)
  lossReasons.js              → Stock-loss reason taxonomy + badge colors
  dissolvePremades.js         → computePremadeShortfalls — used by DissolvePremadesDialog
  navigation.js               → googleMapsUrl, wazeUrl, appleMapsUrl
  phone.js                    → cleanPhone, telHref
  imageResize.js              → resizeImageBlob — canvas-based client-side downscale + JPEG re-encode for bouquet uploads
```

## Rules
- New utilities and hooks here **must** have tests in `packages/shared/test/` (root CLAUDE.md Testing Rules). CI enforces 80% line coverage on `utils/` and `hooks/`.
- Keep dependencies minimal — this package is imported by all three apps.
- No app-specific logic — if it's only used by one app, it belongs in that app.
- Update this file's structure block when adding/removing exports — mismatch with `index.js` makes future Claude sessions write duplicate code.

## Notable invariants
- `getEffectiveStock(qty)` is the **only** correct way to compute available stock anywhere in the codebase (florist `StockItem.jsx`, dashboard `StockTab.jsx`). Never inline `qty - committed` — see root CLAUDE.md pitfall #7 for the painful history.

## Skill Triggers

See root CLAUDE.md "Skill Quick-Reference" for the full table. Shared-package defaults:
- **New util or hook** → `tdd` / `superpowers:test-driven-development` (tests are mandatory, CI enforces 80% coverage)
- **Refactor or dependency change** → `improve-codebase-architecture` first, then build all three apps locally before committing (`vite build` in florist, dashboard, delivery)
