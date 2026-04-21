import t from '../../translations.js';

// Expanded per-variant editor for a bouquet card.
// Read-only for price; only the active checkbox is interactive on mobile.
// Editing prices is a desktop-class operation — the owner opens the dashboard.

export default function VariantList({ variants, onToggleVariant }) {
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
            <label
              key={v.id}
              className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 dark:border-dark-separator
                         active:bg-gray-50 dark:active:bg-dark-card/60 select-none"
            >
              <input
                type="checkbox"
                checked={active}
                onChange={e => onToggleVariant(v, e.target.checked)}
                className="w-5 h-5 accent-brand-600"
              />
              <span className="flex-1 text-sm text-ios-label dark:text-dark-label">{size}</span>
              <span className="text-sm tabular-nums text-ios-tertiary">{price.toFixed(0)} zł</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
