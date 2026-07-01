import { useEffect } from 'react';
import BatchTracePanel from './BatchTracePanel.jsx';

/**
 * BatchTraceModal — thin modal wrapper around BatchTracePanel.
 * Used by the florist app where trace is shown in a modal overlay.
 * Dashboard uses BatchTracePanel directly (inline).
 *
 * Props:
 *   trail    — trace events array (passed through to BatchTracePanel)
 *   t        — translation strings (all BatchTracePanel keys + close, batchTraceTitle)
 *   onClose  — () => void
 */
export default function BatchTraceModal({ trail = [], t, onClose, onOrderClick }) {
  // Escape key listener
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="trace-modal-backdrop"
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        data-testid="trace-modal-content"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{t.batchTraceTitle}</h2>
        </div>

        {/* Trail */}
        <div className="px-4 py-3">
          <BatchTracePanel trail={trail} t={t} onOrderClick={onOrderClick} />
        </div>

        {/* Close button */}
        <div className="px-4 pb-4 pt-1 border-t border-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
