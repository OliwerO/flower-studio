import t from '../../translations.js';

// Tap-to-toggle category chips for a bouquet group. Mirrors the dashboard's
// ProductCard checkbox row but rendered as iOS-style pill chips so it's
// thumb-friendly on tablet/phone. Categories live per-variant in Airtable
// but are conceptually a bouquet-level field, so the parent applies the
// new array to every variant.
//
// Common case this fixes: deactivating a bouquet (e.g. ran out of stems)
// auto-clears its "Available Today" tag. Re-activating from the florist
// app left no way to put the tag back without opening the dashboard.

export default function CategoryChips({ categories, selected, onChange }) {
  const selectedSet = new Set(selected);

  function toggle(cat) {
    const next = selectedSet.has(cat)
      ? selected.filter(c => c !== cat)
      : [...selected, cat];
    onChange(next);
  }

  return (
    <div className="border-t border-gray-100 dark:border-dark-separator px-4 pt-3 pb-1">
      <p className="text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold mb-2">
        {t.bouquetCategoriesLabel}
      </p>
      {categories.length === 0 ? (
        <p className="text-xs text-ios-tertiary mb-2">{t.bouquetNoCategories}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {categories.map(cat => {
            const on = selectedSet.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggle(cat)}
                aria-pressed={on}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors active-scale ${
                  on
                    ? 'bg-brand-50 border-brand-300 text-brand-700 dark:bg-brand-900/20 dark:border-brand-600 dark:text-brand-300'
                    : 'bg-gray-50 border-gray-200 text-ios-tertiary dark:bg-dark-elevated dark:border-dark-separator dark:text-dark-tertiary'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
