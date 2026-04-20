// CustomerDrawer — narrow-viewport wrapper around CustomerDetailView.
// On <1280px screens the side-by-side split layout collapses: the list
// takes full width and the detail pane floats in from the right as a
// slide-over, mirroring HelpPanel.jsx. On desktop (xl+) this whole element
// is hidden via `xl:hidden` and the dashboard uses the inline split pane.
//
// Think of it as a production bay vs. an offsite satellite unit: on a wide
// factory floor you run both lines parallel; on a narrow floor you swap
// bays in and out as you need them.

import { useEffect } from 'react';
import CustomerDetailView from './CustomerDetailView.jsx';

export default function CustomerDrawer({ customerId, onUpdate, onNavigate, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!customerId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end xl:hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-[92vw] max-w-[560px] h-full bg-white shadow-2xl animate-slide-right overflow-y-auto">
        <button
          onClick={onClose}
          className="sticky top-3 ml-auto mr-3 z-10 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-tertiary text-sm hover:bg-gray-200 transition-colors float-right"
          aria-label="Close"
        >
          ✕
        </button>
        <CustomerDetailView
          customerId={customerId}
          onUpdate={onUpdate}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
