// ChangeCustomerModal — reassign an order's linked customer (#389). Dashboard
// is owner-only end to end (PIN-gated at login, no role concept), so this
// modal has no additional gate of its own — the trigger button in
// OrderDetailPanel is what matters.
//
// Reuses the same search-first mechanics as the new-order wizard's
// Step1Customer (GET /customers?search=), but as a lightweight standalone
// modal since it's invoked from an already-existing order, not order
// creation — no Key Person / create-new-customer flow here, just search →
// pick → PATCH. Centered dialog (not a bottom sheet) to match the desktop
// modal style used elsewhere on the dashboard (PremadeBouquetCreateModal).

import { useState, useEffect, useRef } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

export default function ChangeCustomerModal({ currentName, onClose, onSelect }) {
  const { showToast }             = useToast();
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying]   = useState(false);
  const debounceRef               = useRef(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/customers', { params: { search: query } });
        setResults(res.data);
      } catch (err) {
        console.error('Customer search failed:', err);
        showToast(err.response?.data?.error || t.error, 'error');
      }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function pick(customer) {
    if (applying) return;
    setApplying(true);
    try {
      await onSelect(customer);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ios-label">{t.changeCustomerTitle}</h2>
          <button onClick={onClose} className="text-ios-tertiary hover:text-ios-label text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-2 flex-1 overflow-y-auto">
          {currentName && (
            <p className="text-xs text-ios-tertiary mb-3">
              {t.customer}: <span className="font-medium text-ios-label">{currentName}</span>
            </p>
          )}

          <div className="ios-card flex items-center px-4 mb-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 py-3 text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50"
              autoFocus
            />
          </div>

          {searching && (
            <p className="text-ios-tertiary text-sm text-center py-4">{t.loading}</p>
          )}
          {!searching && query.length >= 2 && results.length === 0 && (
            <p className="text-ios-tertiary text-sm text-center py-4">{t.noCustomersFound}</p>
          )}
          {results.length > 0 && (
            <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
              {results.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c)}
                  disabled={applying}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                    <span className="text-brand-600 font-semibold text-sm">
                      {(c['Name'] || c['Nickname'] || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ios-label text-sm">{c['Name']}</div>
                    <div className="text-xs text-ios-tertiary truncate">
                      {[c['Phone'], c['Nickname']].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium disabled:opacity-30"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
