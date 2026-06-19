# Shared Package — CLAUDE.md

Cross-app utilities shared by all three frontend apps. Anything used by 2+ apps belongs here. Source of truth for the export contract: `packages/shared/index.js`.

## Structure
```
api/
  client.js                   → Axios instance with auto-attached PIN header + opt-in cachedGet/in-flight GET dedupe helper
  uploadImage.js              → uploadBouquetImage / removeBouquetImage (products) + uploadOrderImage / removeOrderImage (per-order override) — multipart wrappers
  feedback.js                 → publishFeedback({ sessionId, imageFile }) — multipart POST /feedback/publish. Resizes the screenshot client-side first (5MB multer cap) like uploadImage.js. Consumed by FeedbackModal.
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
  VarietyAllocationPicker.jsx → Variety picker. A single pre-chosen Variety opens straight at the allocation form (CR-24); multiple Varieties show a Stage-1 typeahead list (each row a `VarietyAvailabilityLine`) → tap to expand. The form = one source dropdown (`buildSources`: From stock [· sell tier] · Into committed <date> · From incoming PO · New demand) + amount field + live remaining; `onSelectStock(selection, amount)`. Owner-only "+ Create new Variety". Takes `pendingPO`. Behind `STOCK_Y_MODEL` in BouquetEditor / BouquetSection / Step2Bouquet (florist + dashboard)
  VarietyAvailabilityLine.jsx → One labelled availability line for a Variety (CR-23/28): On hand · Committed · Reserved · Net [ +Incoming <DateTag> · Effective ]. Default Tailwind palette only (used in both apps). Driven by `getVarietyAvailability`.
  VarietyIdentity.jsx         → Single source of truth for Variety 4-tuple typography (#311). Prominent mode (Type + Colour bold, Size small, Cultivar italic) for picker; compact mode (Type as tiny caption when shown, same Colour/Size/Cultivar hierarchy) for Stock list rows under TypeGroupHeader.
  TypeGroupHeader.jsx         → Sticky collapsible Type header for the Y-model stock list. Renders Type label, aggregate bucket totals, and expand/collapse chevron.
  VarietyListItem.jsx         → Variety row with 4-bucket header (onHand / planned / reserved / net), expand-to-Stock-Items, tap-on-reserved → premade list, tap-on-Batch → trace. Consumed by StockPanelPage (florist) and StockTab (dashboard) under `STOCK_Y_MODEL`.
  BatchTracePanel.jsx         → Inline per-Batch usage trace panel (florist uses this via BatchTraceModal; dashboard renders it directly as an inline panel).
  BatchTraceModal.jsx         → Modal wrapper around BatchTracePanel. Used by the florist app where trace opens over a sheet.
  VarietyTracePanel.jsx       → Per-Variety usage trail — unions events across every Batch + DE in a Variety (GET /stock/varieties/:key/usage). Renders the 4 event kinds + an "unaccounted stems" drift footer. Absorption events deferred (PRD #324 T5).
  WriteOffBatchPicker.jsx     → Batch-targeted write-off form. Excludes Demand Entries; defaults to oldest Batch by date. Behind `STOCK_Y_MODEL`.
  DissolvePremadesDialog.jsx  → Confirm modal for dissolving premade bouquets in an order
  WixPushModal.jsx            → Async-job progress modal for /products/push (florist + dashboard)
  BouquetImageEditor.jsx      → Click/paste image slot. Pass `wixProductId` for storefront product images OR `orderId` for per-order overrides. Owner-only remove via `canRemove`.
  BouquetImageView.jsx        → Read-only thumbnail with tap-to-zoom fullscreen modal for the driver delivery card
  FeedbackModal.jsx           → AI-assisted bug/feature report modal. Drives /feedback/start → /feedback/continue → /feedback/preview conversation, then publishes via the shared `publishFeedback` wrapper (api/feedback.js — resizes the screenshot before upload). Props: t, reporterRole, reporterName, appArea, onClose. Surfaces the backend error message on failure. Uses inline SVG icons (no lucide-react dep).
hooks/
  useOrderEditing.js          → Shared bouquet editing logic (stock filtering, line management)
  useOrderPatching.js         → Shared order/delivery PATCH helpers (patchOrder, patchDelivery)
  useDebouncedValue.js        → Standard debounce-state hook
  useLongPress.js             → Long-press gesture detection
  useStockYModelFlag.js       → Reads `stockYModelEnabled` from `/settings`. Single-flight cached.
utils/
  parseBatchName.js           → Extracts date from batch names like "Rose (14.Mar.)"
  stockName.jsx               → Formats stock display names with age/date labels
  stockMath.js                → getEffectiveStock(qty), hasStockShortfall — LOAD-BEARING per root pitfall #7. Also getVarietyTotals (onHand/planned/reserved/net), getVarietyAvailability(rows, reservations, arrivals) → labelled buckets {onHand, committed, reserved, incoming, net, effective, arrivals} for the picker (CR-23; effective = net + incoming, date-agnostic), arrivalsForVariety(rows, pendingPO) → [{date,qty}], allocateVarietyCoverage (date-aware shortfall netting, CR-39)
  stockLinePrice.js           → resolveStockLinePrice(stockItem, pendingEntry) → {costPricePerUnit, sellPricePerUnit}, and resolveVarietySell(rows, pendingMap) → number (representative sell for a grouped Variety picker row). A not-yet-arrived flower (qty ≤ 0) prices off its pending Stock Order, not the stale card sell; physical stock keeps the card price (#377). Single rule shared by every bouquet add/display/picker surface (Step2, useOrderEditing, OrderCard, OrderDetailPanel, BouquetEditor, BouquetSection). NOTE: the shared VarietyAllocationPicker Stage-2 tier display still reads card price — not yet pending-PO aware.
  bouquetVisibility.js        → shouldShowBouquetSection({hasLines, isTerminal, isOwner}) — single gate for whether an order's bouquet-composition section renders. Shows when the order has lines OR is still editable (non-terminal / owner), so an emptied order keeps its "Edit bouquet" entry point (Pitfall #4). Consumed by florist OrderCard / OrderDetailPage / OrderCardExpanded(→BouquetEditor) and dashboard OrderDetailPanel / BouquetSection.
  orderStatusOptions.js       → getStatusOptions({role, currentStatus, previousStatuses}) — single source of truth for which status pills a user may pick. Owner = any→any; florist/driver = forward map ∪ previously-held statuses (revert). Mirrors backend orderRepo.transitionStatus.
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
