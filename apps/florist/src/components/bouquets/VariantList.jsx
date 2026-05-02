import { useState, useEffect } from 'react';
import t from '../../translations.js';

// Expanded per-variant editor for a bouquet card.
// Inline price edit mirrors the dashboard's products/ProductCard.jsx VariantRow:
// local draft state, commits on blur/Enter, optimistic + dirty-marked at the
// page level so the change picks up the next push to Wix.

function PriceInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const next = Number(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    else setDraft(value);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min="0"
        value={draft}
        onChange={e => setDraft(e.target.value === '' ? '' : Number(e.target.value))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } }}
        onClick={e => e.stopPropagation()}
        className="w-16 text-right tabular-nums text-sm rounded-lg border border-gray-200
                   dark:border-dark-separator bg-white dark:bg-dark-elevated
                   text-ios-label dark:text-dark-label px-2 py-1 outline-none
                   focus:border-brand-400"
      />
      <span className="text-sm text-ios-tertiary">zł</span>
    </div>
  );
}

export default function VariantList({ variants, onToggleVariant, onUpdatePrice }) {
  return (
    <div className="border-t border-gray-100 dark:border-dark-separator">
      <p className="px-4 pt-3 text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
        {t.bouquetVariants}
      </p>
      <div>
        {variants.map(v => {
          const size = v['Variant Name'] || v['Size'] || '—';
          const price = Number(v.Price || 0);
          const active = Boolean(v.Active);
          return (
            <div
              key={v.id}
              className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 dark:border-dark-separator"
            >
              <input
                type="checkbox"
                checked={active}
                onChange={e => onToggleVariant(v, e.target.checked)}
                className="w-5 h-5 accent-brand-600"
              />
              <span className="flex-1 text-sm text-ios-label dark:text-dark-label">{size}</span>
              <PriceInput value={price} onCommit={next => onUpdatePrice(v, next)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
