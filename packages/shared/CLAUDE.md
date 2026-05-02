# Shared Package — CLAUDE.md

Cross-app utilities shared by all three frontend apps. Anything used by 2+ apps belongs here. Source of truth for the export contract: `packages/shared/index.js`.

## Structure
```
api/
  client.js                   → Axios instance with auto-attached PIN header (VITE_BACKEND_URL)
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
  DissolvePremadesDialog.jsx  → Confirm modal for dissolving premade bouquets in an order
  WixPushModal.jsx            → Async-job progress modal for /products/push (florist + dashboard)
hooks/
  useOrderEditing.js          → Shared bouquet editing logic (stock filtering, line management)
  useOrderPatching.js         → Shared order/delivery PATCH helpers (patchOrder, patchDelivery)
  useDebouncedValue.js        → Standard debounce-state hook
  useLongPress.js             → Long-press gesture detection
utils/
  parseBatchName.js           → Extracts date from batch names like "Rose (14.Mar.)"
  stockName.jsx               → Formats stock display names with age/date labels
  stockMath.js                → getEffectiveStock(qty), hasStockShortfall — LOAD-BEARING per root pitfall #7
  timeSlots.js                → Time slot generation with lead-time filtering
  customerFilters.js          → Customer search + filter predicates (matchesSearch/Filters, EMPTY_FILTERS)
  productGroup.js             → Storefront product grouping (groupByProduct, parseCats, priceRange, ...)
  lossReasons.js              → Stock-loss reason taxonomy + badge colors
  dissolvePremades.js         → computePremadeShortfalls — used by DissolvePremadesDialog
  navigation.js               → googleMapsUrl, wazeUrl, appleMapsUrl
  phone.js                    → cleanPhone, telHref
```

## Rules
- New utilities and hooks here **must** have tests in `packages/shared/test/` (root CLAUDE.md Testing Rules). CI enforces 80% line coverage on `utils/` and `hooks/`.
- Keep dependencies minimal — this package is imported by all three apps.
- No app-specific logic — if it's only used by one app, it belongs in that app.
- Update this file's structure block when adding/removing exports — mismatch with `index.js` makes future Claude sessions write duplicate code.

## Notable invariants
- `getEffectiveStock(qty)` is the **only** correct way to compute available stock anywhere in the codebase (florist `StockItem.jsx`, dashboard `StockTab.jsx`). Never inline `qty - committed` — see root CLAUDE.md pitfall #7 for the painful history.
