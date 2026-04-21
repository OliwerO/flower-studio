import t from '../../translations.js';

// Summary header for the waste log page.
// Shows total stems and total cost impact for the currently filtered entries.

export default function WasteSummary({ entries, periodLabel }) {
  const totalQty = entries.reduce((s, e) => s + Number(e.Quantity || 0), 0);
  const totalCost = entries.reduce(
    (s, e) => s + Number(e.Quantity || 0) * Number(e.costPrice || 0),
    0
  );

  return (
    <div className="rounded-2xl bg-white dark:bg-dark-card border border-gray-100 dark:border-dark-separator p-4 mb-3">
      <p className="text-[11px] uppercase tracking-wide text-ios-tertiary dark:text-dark-tertiary font-semibold">
        {periodLabel}
      </p>
      <div className="flex items-baseline gap-4 mt-1">
        <div>
          <span className="text-2xl font-bold tabular-nums text-ios-label dark:text-dark-label">{totalQty}</span>
          <span className="ml-1.5 text-xs text-ios-tertiary dark:text-dark-tertiary">{t.wasteTotalQty}</span>
        </div>
        <div className="h-6 w-px bg-gray-200 dark:bg-dark-separator" />
        <div>
          <span className="text-xs text-ios-tertiary dark:text-dark-tertiary mr-1">{t.wasteTotalCost}:</span>
          <span className="text-xl font-semibold tabular-nums text-ios-red">
            {totalCost.toFixed(0)} zł
          </span>
        </div>
      </div>
    </div>
  );
}
