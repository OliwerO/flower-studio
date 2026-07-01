export { default as useOrderEditing } from './hooks/useOrderEditing.js';
export { default as useOrderPatching } from './hooks/useOrderPatching.js';
export { default as useLongPress } from './hooks/useLongPress.js';
export { default as useDebouncedValue } from './hooks/useDebouncedValue.js';
export { default as parseBatchName } from './utils/parseBatchName.js';
export { formatDateDMY } from './utils/formatDate.js';
export { getAvailableSlots, getCourierSlots } from './utils/timeSlots.js';
export { renderStockName, stockBaseName, renderDateTag } from './utils/stockName.jsx';
export { ToastProvider, useToast } from './context/ToastContext.jsx';
export { default as Toast } from './components/Toast.jsx';
export { default as ErrorBoundary } from './components/ErrorBoundary.jsx';
export { default as DissolvePremadesDialog } from './components/DissolvePremadesDialog.jsx';
export { computePremadeShortfalls } from './utils/dissolvePremades.js';
export { default as apiClient, setClientPin, getClientPin, cachedGet, clearCachedGetCache } from './api/client.js';
export { LanguageProvider, useLanguage, LangToggle } from './context/LanguageContext.jsx';
export { AuthProvider, useAuth } from './context/AuthContext.jsx';
export { default as CallButton } from './components/CallButton.jsx';
export { default as NavButtons } from './components/NavButtons.jsx';
export { cleanPhone, telHref } from './utils/phone.js';
export { googleMapsUrl, wazeUrl, appleMapsUrl } from './utils/navigation.js';

// New mobile-UX primitives (2026-04)
export { default as Sheet } from './components/Sheet.jsx';
export { default as ListItem } from './components/ListItem.jsx';
export { default as EmptyState } from './components/EmptyState.jsx';
export { default as FilterBar } from './components/FilterBar.jsx';
export { default as IconButton } from './components/IconButton.jsx';
export { default as WixPushModal } from './components/WixPushModal.jsx';

// New utils
export {
  groupByProduct,
  parseCats,
  activeCount,
  allActive,
  anyActive,
  priceRange,
  groupCategories,
} from './utils/productGroup.js';
export {
  LOSS_REASONS,
  REASON_KEYS,
  reasonLabel,
  REASON_COLORS,
  reasonBadgeClass,
} from './utils/lossReasons.js';
export { getEffectiveStock, hasStockShortfall, getVarietyTotals, getVarietyAvailability, arrivalsForVariety, allocateVarietyCoverage, allocateLinesAgainstVariety, varietyGroupMatchesView } from './utils/stockMath.js';
export { resolveStockLinePrice, resolveVarietySell } from './utils/stockLinePrice.js';
export { shouldShowBouquetSection } from './utils/bouquetVisibility.js';
export { getStatusOptions, ALL_ORDER_STATUSES, isStatusAllowedForFulfillment } from './utils/orderStatusOptions.js';
export {
  matchesSearch,
  matchesFilters,
  EMPTY_FILTERS,
  serializeFilters,
  deserializeFilters,
  activeFilterCount,
} from './utils/customerFilters.js';
export {
  EMPTY_ORDER_FILTER,
  clearOrderFilter,
  buildOrderQueryParams,
  orderMatchesClientFilter,
  activeOrderFilterCount,
  buildCrossTabNavFilter,
} from './utils/orderFilters.js';
export {
  EMPTY_STOCK_FILTER,
  clearStockFilter,
  stockRowMatchesFilter,
  activeStockFilterCount,
} from './utils/stockFilters.js';
export {
  EMPTY_VARIETY_FILTER,
  clearVarietyFilter,
  varietyMatchesFilter,
  activeVarietyFilterCount,
} from './utils/varietyFilters.js';
// Header-anchored per-column filter popover shell — funnel button + panel.
// Shared so both the Orders table and the Y-model Stock Flat table use one shell.
export { default as ColumnFilterPopover } from './components/ColumnFilterPopover.jsx';

// Bouquet image upload (Wix-backed)
export { default as BouquetImageEditor } from './components/BouquetImageEditor.jsx';
export { default as BouquetImageView }   from './components/BouquetImageView.jsx';

// Shared product name + translation editor (florist + dashboard). ADR-0008.
export { default as ProductTranslationEditor } from './components/ProductTranslationEditor.jsx';
export { resizeImageBlob }               from './utils/imageResize.js';
export { uploadBouquetImage, removeBouquetImage } from './api/uploadImage.js';
export { publishFeedback } from './api/feedback.js';
export { default as BatchPickerModal } from './components/BatchPickerModal.jsx';
export { default as TierSwitchChip } from './components/TierSwitchChip.jsx';
export { findAllMatchingVariety } from './hooks/useOrderEditing.js';
export { default as FeedbackModal } from './components/FeedbackModal.jsx';

// Order termination seam (cancel + delete shared hook + confirm UI)
export { default as useOrderTerminationFlow } from './hooks/useOrderTerminationFlow.js';
export { default as OrderTerminationConfirm } from './components/OrderTerminationConfirm.jsx';

// Null-safe date comparators (CR-02 — never dereference null.localeCompare)
export { byDateAsc, byDateDesc } from './utils/sortByDate.js';

// Stock Y-model allocation engine (issue #287, PRD #283)
export { stockAllocationEngine } from './utils/stockAllocationEngine.js';

// Variety identity helpers per ADR-0006 (issue #288)
export { varietyKey, groupByVariety, varietyDisplayName } from './utils/varietyKey.js';

// Variety allocation picker — Stage 1 typeahead (issue #288)
export { default as VarietyAllocationPicker } from './components/VarietyAllocationPicker.jsx';

// Shared typographic hierarchy for the 4-tuple (#311). Reused by picker + Stock list.
export { default as VarietyIdentity } from './components/VarietyIdentity.jsx';

// Type group sticky collapsible header for Y-model Stock list (issue #289)
export { default as TypeGroupHeader } from './components/TypeGroupHeader.jsx';

// Single coloured date chip for every Y-model stock surface (decision D6, 2026-06-12)
export { default as DateTag } from './components/DateTag.jsx';
export { default as VarietyAvailabilityLine } from './components/VarietyAvailabilityLine.jsx';

// Variety row with 4-bucket header for Y-model Stock list (issue #289, pitfall #8)
export { default as VarietyListItem } from './components/VarietyListItem.jsx';

// Date-grouped shortfall summary panel — surfaces all negative-qty Demand Entries
// above the Variety list so the owner can see when each missing variety is due.
export { default as ShortfallSummary } from './components/ShortfallSummary.jsx';

// Batch-arrival view of the Stock list — flat Batches grouped by date desc.
// Owner toggles between Variety view (consumption-centric) and Batch view
// (arrival-centric: "what came in when").
export { default as BatchArrivalList } from './components/BatchArrivalList.jsx';

// Y-native incoming-arrivals panel — pending PO lines grouped by Variety
// 4-tuple with per-date pills. Replaces the legacy per-stockId Planned
// table; matches the Y-model visual language of ShortfallSummary.
export { default as PendingArrivalsPanel } from './components/PendingArrivalsPanel.jsx';

// STOCK_Y_MODEL feature flag hook (Task 6)
export { default as useStockYModelFlag } from './hooks/useStockYModelFlag.js';
export { useVarietyTraceExpand } from './hooks/useVarietyTraceExpand.js';

// Step-chart balance trace — shared by BatchTracePanel and VarietyTracePanel (S7)
export { default as BalanceSparkline } from './components/BalanceSparkline.jsx';

// Per-batch trace UX seam — panel (inline, dashboard) + modal wrapper (florist) (issue #289)
export { default as BatchTracePanel } from './components/BatchTracePanel.jsx';
export { default as BatchTraceModal } from './components/BatchTraceModal.jsx';

// Per-Variety trace panel — unions usage across every Batch + DE in a Variety,
// surfaces drift via an "unaccounted stems" footer (PRD #324 T5).
export { default as VarietyTracePanel } from './components/VarietyTracePanel.jsx';

// Read-only order preview shown OVER the Variety trace — tapping a trace order
// opens this popup instead of navigating away (owner feedback, round-2).
export { default as OrderQuickViewModal } from './components/OrderQuickViewModal.jsx';

// Write-off Batch picker — Demand Entries excluded, default oldest, FIFO (issue #289)
export { default as WriteOffBatchPicker } from './components/WriteOffBatchPicker.jsx';

// CR-05: canonical dashboard stock-row grid — identical track list to BatchArrivalList
// so Type/Variety/amount land in the same column across all three sections.
// Pass splitType to ShortfallSummary and PendingArrivalsPanel for dashboard mode;
// omit for mobile (flex layout, no grid).
export { STOCK_GRID_FULL } from './components/stockRowGrid.js';

// CR-05 follow-on: per-Variety financials for stock cards (Cost/Sell/Markup/Supplier).
export { varietyFinancials } from './utils/varietyFinancials.js';
// Y-model New-PO-form pre-fill: netted per-Variety shortfall suggestions (nets all open POs).
export { buildPoSuggestions } from './utils/buildPoSuggestions.js';

// Mono bouquet suggested price = minStems × key-flower sell price. Shared by
// dashboard ProductCard and florist VariantList so the math can't drift.
export { suggestedMonoPrice } from './utils/productPricing.js';

// Ask Blossom — AI assistant chat panel (markdown render, session continuity)
export { default as AskBlossomPanel } from './components/AskBlossomPanel.jsx';
export { default as AskBlossomLauncher } from './components/AskBlossomLauncher.jsx';

// Explorer — read-only linked-record grid over query_records (ADR-0010, PRD #485)
export {
  EXPLORER_ROW_CAP,
  EMPTY_EXPLORER_SPEC,
  activeExplorerFilterCount,
  resolveColumns,
  buildDrillSpec,
  formatExplorerValue,
  toggleSort,
  getSortDir,
  applyColumnFilter,
  columnFilterValues,
  explorerRowsToCsv,
} from './utils/explorerSpec.js';
export { default as useExplorerQuery } from './hooks/useExplorerQuery.js';
