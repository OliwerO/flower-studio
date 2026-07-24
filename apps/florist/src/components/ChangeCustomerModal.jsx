// ChangeCustomerModal — owner-only reassignment of an order's linked customer
// (#389). Reuses the same search-first mechanics as the new-order wizard's
// Step1Customer (GET /customers?search=), but as a lightweight standalone
// modal since it's invoked from an already-existing order, not order
// creation — no Key Person / create-new-customer flow here, just search →
// pick → PATCH.

import { useState, useEffect, useRef } from 'react';
import client from '../api/client.js';
import t from '../translations.js';

export default function ChangeCustomerModal({ currentName, onClose, onSelect }) {
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
      } catch { /* ignore — transient search failure, user can retry the query */ }
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
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal — slides up from bottom, like iOS sheet (matches TextImportModal) */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-t-3xl shadow-2xl px-5 pt-4 pb-8 max-h-[85vh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-ios-label">{t.changeCustomerTitle}</h2>
          <button onClick={onClose} className="text-ios-tertiary text-2xl leading-none px-1">×</button>
        </div>
        {currentName && (
          <p className="text-xs text-ios-tertiary mb-3">{t.customerName}: {currentName}</p>
        )}

        {/* Search */}
        <div className="ios-card overflow-hidden mb-3 shrink-0">
          <div className="flex items-center px-4 gap-3">
            <span className="text-ios-tertiary text-lg">🔍</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary"
              autoFocus
            />
            {query.length > 0 && (
              <button onClick={() => { setQuery(''); setResults([]); }} className="text-ios-tertiary text-sm">✕</button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {searching && (
            <p className="text-ios-tertiary text-sm text-center py-4">{t.loading}</p>
          )}
          {!searching && query.length >= 2 && results.length === 0 && (
            <p className="text-ios-tertiary text-sm text-center py-4">{t.noCustomersFound}</p>
          )}
          {results.length > 0 && (
            <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
              {results.map(c => (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  disabled={applying}
                  className="w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-ios-fill disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                    <span className="text-brand-600 font-semibold text-base">
                      {(c['Name'] || c['Nickname'] || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ios-label">{c['Name']}</div>
                    <div className="text-sm text-ios-tertiary truncate">
                      {[c['Phone'], c['Nickname']].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="text-ios-tertiary text-lg">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
