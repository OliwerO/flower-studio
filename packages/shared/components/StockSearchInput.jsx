import { useState, useEffect, useRef } from 'react';

/**
 * StockSearchInput — typeahead over loaded Stock Items, used by the Stock Order
 * line form.
 *
 * Lifted verbatim (bar the `t` prop) from the identical copies that had been
 * living in `apps/florist/.../PurchaseOrderPage.jsx` and
 * `apps/dashboard/.../StockOrderPanel.jsx`.
 *
 * `selectedRef` suppresses the blur callback after a dropdown pick: without it
 * the select and the blur both fire a save, and the blur — carrying the stale
 * typed query — lands second and overwrites the picked flower.
 *
 * @param {Array}    stock     Stock wire rows.
 * @param {string}   value     Current text.
 * @param {function} onChange  (text) => void — free typing, no selection made.
 * @param {function} onSelect  (stockItem) => void — a row was picked.
 * @param {function} [onBlur]  (text) => void — commit free text on blur.
 * @param {object}   t         Translations.
 */
export default function StockSearchInput({ stock, value, onChange, onSelect, onBlur: onBlurCb, t = {} }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(false);

  useEffect(() => { setQuery(value || ''); }, [value]);

  const needle = query.toLowerCase();
  const filtered = query
    ? (stock || [])
        .filter((s) => (s['Display Name'] || '').toLowerCase().includes(needle))
        .slice(0, 6)
    : [];

  const exactMatch = query && (stock || []).some(
    (s) => (s['Display Name'] || '').toLowerCase() === needle,
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (query) setOpen(true); }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 200);
          if (!selectedRef.current) onBlurCb?.(query);
          selectedRef.current = false;
        }}
        placeholder={t.po?.flowerSearch || 'Search...'}
        className="field-input w-full text-sm"
        data-testid="stock-search-input"
      />
      {open && query && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white dark:bg-dark-elevated border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => {
                selectedRef.current = true;
                onSelect(s);
                setQuery(s['Display Name']);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm active:bg-gray-50 dark:active:bg-gray-700 border-b border-gray-50 dark:border-gray-700"
            >
              <span className="font-medium">{s['Display Name']}</span>
              <span className="text-xs text-ios-secondary ml-1">({s['Current Quantity'] ?? 0})</span>
            </button>
          ))}
          {!exactMatch && query.length >= 2 && (
            <button
              type="button"
              onMouseDown={() => { selectedRef.current = true; onChange(query); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm border-t border-gray-100 dark:border-gray-700 text-brand-600 font-medium active:bg-brand-50"
            >
              + {t.po?.addNewFlower || 'Add'} &quot;{query}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
