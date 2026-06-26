import { useState, useEffect } from 'react';
import { suggestedMonoPrice } from '@flower-studio/shared';
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

// Numeric input that commits on blur/Enter.
// empty string = untracked (commits null); never coerces empty → 0.
function NumericInput({ value, onCommit, placeholder = '—', className = '' }) {
  // value may be null/undefined (untracked) → show as empty string
  const toDisplay = (v) => (v === null || v === undefined || v === '') ? '' : String(v);
  const [draft, setDraft] = useState(toDisplay(value));
  useEffect(() => { setDraft(toDisplay(value)); }, [value]);

  function commit() {
    if (draft === toDisplay(value)) return; // no change
    const next = draft === '' ? null : Number(draft);
    onCommit(next);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } }}
      onClick={e => e.stopPropagation()}
      placeholder={placeholder}
      className={`text-right tabular-nums text-sm rounded-lg border border-gray-200
                 dark:border-dark-separator bg-white dark:bg-dark-elevated
                 text-ios-label dark:text-dark-label px-2 py-1 outline-none
                 focus:border-brand-400 ${className}`}
    />
  );
}

export default function VariantList({ variants, onToggleVariant, onUpdatePrice, productType, stockMap = {}, onUpdate }) {
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
          const lt = Number(v['Lead Time Days'] ?? 1);
          const rawQty = v['Quantity'];
          const qty = (rawQty === undefined || rawQty === null || rawQty === '') ? null : Number(rawQty);
          const minStems = Number(v['Min Stems'] || 0);
          const suggested = productType && onUpdate ? suggestedMonoPrice(v, stockMap, productType) : null;

          return (
            <div
              key={v.id}
              className="px-4 py-2.5 border-t border-gray-50 dark:border-dark-separator"
            >
              {/* Row 1: checkbox + size name + active toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={e => onToggleVariant(v, e.target.checked)}
                  className="w-5 h-5 accent-brand-600 shrink-0"
                />
                <span className="flex-1 text-sm text-ios-label dark:text-dark-label">
                  {size}
                  {minStems > 0 && (
                    <span className="text-xs text-ios-tertiary ml-1.5">({minStems} {t.prodStems})</span>
                  )}
                </span>
                <PriceInput value={price} onCommit={next => onUpdatePrice(v, next)} />
              </div>

              {/* Row 2: lead time + quantity + suggested price — only when onUpdate available */}
              {onUpdate && (
                <div className="mt-1.5 ml-8 flex items-center gap-3 flex-wrap">
                  {/* Lead Time Days */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-ios-tertiary">{t.prodLeadTime}:</span>
                    <NumericInput
                      value={lt}
                      onCommit={val => onUpdate(v.id, 'Lead Time Days', val === null ? 0 : val)}
                      className="w-12 text-center"
                    />
                  </div>

                  {/* Quantity — empty = untracked */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-ios-tertiary">{t.prodQuantity}:</span>
                    <NumericInput
                      value={qty}
                      onCommit={val => onUpdate(v.id, 'Quantity', val)}
                      placeholder="—"
                      className="w-12 text-center"
                    />
                  </div>

                  {/* Suggested price hint (mono only) */}
                  {productType === 'mono' && suggested !== null && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-ios-tertiary">{t.prodSuggested}:</span>
                      <span className={`text-xs font-medium ${Math.abs(price - suggested) < 1 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {Math.round(suggested)} zł {Math.abs(price - suggested) < 1 ? '✓' : '⚠'}
                      </span>
                      {Math.abs(price - suggested) >= 1 && (
                        <button
                          onClick={() => onUpdate(v.id, 'Price', Math.round(suggested))}
                          title={t.prodApplySuggested}
                          className="text-xs text-ios-blue active-scale"
                        >
                          ←
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
