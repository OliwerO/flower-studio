import { useEffect } from 'react';

// Generic slide-up bottom sheet with backdrop.
// Factored out of apps/delivery/src/components/DeliverySheet.jsx so any app
// can open a sheet without re-implementing the backdrop + animation chrome.
//
// Props:
//   open          - boolean; render & animate in/out
//   onClose       - fn; called on backdrop tap or close button
//   title         - optional string rendered in the header bar
//   children      - sheet body content
//   maxHeight     - CSS height (default '85vh')
//   closeLabel    - button text; defaults to Russian "Закрыть" via t prop
//   t             - translations object (optional; for close button label)

export default function Sheet({ open, onClose, title, children, maxHeight = '85vh', t }) {
  // Lock background scroll while open
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const closeLabel = (t && t.close) || 'Закрыть';

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-dark-card
                   rounded-t-3xl shadow-2xl overflow-y-auto animate-slide-up
                   safe-area-bottom"
        style={{ maxHeight }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-ios-separator dark:bg-dark-separator" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 pb-2">
            <h2 className="text-lg font-semibold text-ios-label dark:text-dark-label">{title}</h2>
            <button
              onClick={onClose}
              className="text-ios-tertiary dark:text-dark-tertiary text-sm font-medium"
            >
              {closeLabel}
            </button>
          </div>
        )}
        <div className="px-5 pb-6">
          {children}
        </div>
      </div>
    </>
  );
}
