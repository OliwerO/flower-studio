import { useState, useMemo, useEffect } from 'react';
import { Search, Minus, Plus } from 'lucide-react';
import {
  Sheet,
  LOSS_REASONS,
  reasonLabel,
  stockBaseName,
} from '@flower-studio/shared';
import t from '../../translations.js';

// Bottom sheet for creating or editing a waste log entry.
// Props:
//   open     - show/hide
//   onClose  - dismiss handler
//   onSave   - fn({ stockItemId, quantity, reason, notes }) → returns promise
//   stock    - list of stock items available for search
//   entry    - optional existing entry to pre-populate (edit mode)
//
// We reuse the same sheet for add + edit to keep the florist's muscle memory
// identical — just the title and submit button wording change.

export default function WasteAddSheet({ open, onClose, onSave, stock, entry }) {
  const editing = Boolean(entry);
  const [stockItemId, setStockItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('Wilted');
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset/seed form whenever the sheet opens or switches entry
  useEffect(() => {
    if (!open) return;
    if (entry) {
      setStockItemId(entry['Stock Item']?.[0] || '');
      setQuantity(Number(entry.Quantity || 1));
      setReason(entry.Reason || 'Wilted');
      setNotes(entry.Notes || '');
      setQuery('');
    } else {
      setStockItemId('');
      setQuantity(1);
      setReason('Wilted');
      setNotes('');
      setQuery('');
    }
  }, [open, entry]);

  const selectedStock = stock.find(s => s.id === stockItemId);

  // Search results — limited to 20 so long lists stay scannable on mobile.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stock.slice(0, 20);
    return stock
      .filter(s => {
        const n = (s['Display Name'] || s['Purchase Name'] || '').toLowerCase();
        const sup = (s.Supplier || '').toLowerCase();
        return n.includes(q) || sup.includes(q);
      })
      .slice(0, 20);
  }, [stock, query]);

  async function handleSave() {
    if (!stockItemId || quantity < 1) return;
    setSaving(true);
    try {
      await onSave({ stockItemId, quantity: Number(quantity), reason, notes });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? t.wasteEditTitle : t.wasteAddTitle;

  return (
    <Sheet open={open} onClose={onClose} title={title} t={t}>
      <div className="space-y-4">
        {/* Flower search + selection */}
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
            {t.wasteFlowerSearch}
          </label>
          <div className="mt-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-tertiary" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.wasteFlowerSearch}
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-dark-separator
                         bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                         focus:border-brand-400"
            />
          </div>
          {selectedStock && !query && (
            <div className="mt-2 px-3 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/30 text-sm text-brand-700 dark:text-brand-200">
              {stockBaseName(selectedStock)}
            </div>
          )}
          {query && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 dark:border-dark-separator">
              {results.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setStockItemId(s.id); setQuery(''); }}
                  className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 border-gray-100 dark:border-dark-separator
                             active:bg-gray-50 dark:active:bg-dark-card
                             ${stockItemId === s.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
                >
                  <div className="text-ios-label dark:text-dark-label">{stockBaseName(s)}</div>
                  <div className="text-[11px] text-ios-tertiary">
                    {s.Supplier || ''} · {s['Current Quantity'] || 0} {t.stems}
                  </div>
                </button>
              ))}
              {results.length === 0 && (
                <div className="px-3 py-4 text-xs text-ios-tertiary text-center">
                  {t.noResults || 'No results'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quantity stepper */}
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
            {t.wasteQuantityLabel}
          </label>
          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={() => setQuantity(q => Math.max(1, Number(q) - 1))}
              className="w-11 h-11 rounded-full bg-gray-100 dark:bg-dark-elevated text-ios-label dark:text-dark-label
                         flex items-center justify-center active-scale"
            >
              <Minus size={18} />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={e => setQuantity(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1))}
              onBlur={() => setQuantity(q => Math.max(1, Number(q) || 1))}
              onFocus={e => e.target.select()}
              className="flex-1 h-11 text-center text-lg font-semibold rounded-xl border border-gray-200 dark:border-dark-separator
                         bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                         focus:border-brand-400 tabular-nums"
            />
            <button
              onClick={() => setQuantity(q => Number(q) + 1)}
              className="w-11 h-11 rounded-full bg-gray-100 dark:bg-dark-elevated text-ios-label dark:text-dark-label
                         flex items-center justify-center active-scale"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Reason chips */}
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
            {t.wasteReasonLabel}
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {LOSS_REASONS.map(r => {
              const sel = reason === r;
              return (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`px-3 py-2 min-h-[36px] rounded-full text-xs font-semibold active-scale
                             ${sel
                               ? 'bg-brand-600 text-white'
                               : 'bg-gray-100 dark:bg-dark-elevated text-ios-label dark:text-dark-label'}`}
                >
                  {reasonLabel(t, r)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
            {t.notes || 'Notes'}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t.wasteNotesPlaceholder}
            rows={2}
            className="mt-1 w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-dark-separator
                       bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                       focus:border-brand-400 resize-none"
          />
        </div>

        {/* Save CTA — pinned-ish near bottom via sheet flow. Stays tappable because
            Sheet container is scrollable if content is too tall. */}
        <button
          onClick={handleSave}
          disabled={saving || !stockItemId || Number(quantity) < 1}
          className="w-full h-12 rounded-2xl bg-brand-600 text-white text-base font-semibold
                     disabled:opacity-50 active:bg-brand-700 active-scale shadow-md"
        >
          {saving ? t.pushing : t.wasteSave}
        </button>
      </div>
    </Sheet>
  );
}
