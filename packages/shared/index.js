export { default as useOrderEditing } from './hooks/useOrderEditing.js';
export { default as useOrderPatching } from './hooks/useOrderPatching.js';
export { default as useLongPress } from './hooks/useLongPress.js';
export { default as useDebouncedValue } from './hooks/useDebouncedValue.js';
export { default as parseBatchName } from './utils/parseBatchName.js';
export { getAvailableSlots } from './utils/timeSlots.js';
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
export { getEffectiveStock, hasStockShortfall } from './utils/stockMath.js';
export {
  matchesSearch,
  matchesFilters,
  EMPTY_FILTERS,
  serializeFilters,
  deserializeFilters,
  activeFilterCount,
} from './utils/customerFilters.js';

// Bouquet image upload (Wix-backed)
export { default as BouquetImageEditor } from './components/BouquetImageEditor.jsx';
export { default as BouquetImageView }   from './components/BouquetImageView.jsx';
export { resizeImageBlob }               from './utils/imageResize.js';
export { uploadBouquetImage, removeBouquetImage } from './api/uploadImage.js';
