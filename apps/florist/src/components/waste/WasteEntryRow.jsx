import { useLongPress, reasonLabel, reasonBadgeClass } from '@flower-studio/shared';
import t from '../../translations.js';

// A single entry in the waste log list.
// Long-press opens the action sheet (Edit / Delete / Cancel).
// Tap without long-press does nothing — the owner's primary interactions are
// "scan the list" and "long-press to manage."

export default function WasteEntryRow({ entry, onLongPress }) {
  const bind = useLongPress(() => onLongPress(entry));
  const cost = Number(entry.Quantity || 0) * Number(entry.costPrice || 0);
  const reason = entry.Reason || 'Other';

  return (
    <div
      {...bind}
      className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 dark:border-dark-separator
                 active:bg-gray-50 dark:active:bg-dark-card/60 select-none"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ios-label dark:text-dark-label truncate">
            {entry.flowerName || '—'}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${reasonBadgeClass(reason)}`}>
            {reasonLabel(t, reason)}
          </span>
        </div>
        {entry.Notes && (
          <p className="text-xs text-ios-tertiary dark:text-dark-tertiary truncate mt-0.5">
            {entry.Notes}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums text-ios-label dark:text-dark-label">
          {entry.Quantity} {t.stems}
        </div>
        {cost > 0 && (
          <div className="text-xs tabular-nums text-ios-red mt-0.5">
            {cost.toFixed(0)} zł
          </div>
        )}
      </div>
    </div>
  );
}
