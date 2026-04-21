// Horizontal scrolling chip row for filters.
// Each chip is a 36 px-tall button; active chip gets the brand pink treatment.
// Used on OrderList, Bouquets, Waste Log and anywhere a list has named filters.
//
// Props:
//   chips       - [{ value, label, count? }]
//   value       - currently selected value (or array if multi=true)
//   onChange    - fn(value)
//   multi       - boolean; if true, value is an array and chips toggle individually
//   className   - extra classes merged onto the wrapping div

export default function FilterBar({ chips, value, onChange, multi = false, className = '' }) {
  function isSelected(v) {
    if (multi) return Array.isArray(value) && value.includes(v);
    return value === v;
  }

  function handleTap(v) {
    if (multi) {
      const current = Array.isArray(value) ? value : [];
      const next = current.includes(v)
        ? current.filter(x => x !== v)
        : [...current, v];
      onChange(next);
    } else {
      onChange(v);
    }
  }

  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar py-1 ${className}`}>
      {chips.map(chip => {
        const sel = isSelected(chip.value);
        return (
          <button
            key={String(chip.value)}
            onClick={() => handleTap(chip.value)}
            className={`shrink-0 px-3 py-2 min-h-[36px] rounded-full text-xs font-semibold
                        transition-colors active-scale
                        ${sel
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 dark:bg-dark-card text-ios-label dark:text-dark-label'}`}
          >
            {chip.label}
            {typeof chip.count === 'number' && (
              <span className={`ml-1.5 text-[11px] ${sel ? 'text-white/80' : 'text-ios-tertiary dark:text-dark-tertiary'}`}>
                {chip.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
