import { Loader2 } from 'lucide-react';
import t from '../../translations.js';

// Passive "you have N unsaved changes" banner at the bottom of the bouquets page.
// Renders only when count > 0. Not a button — the actual Push trigger lives in
// the page header next to Pull (see BouquetsPage.jsx). This banner exists so a
// scrolled-down owner still sees the pending-change indicator without scrolling
// back up.

export default function PushBar({ count, pushing }) {
  if (count === 0) return null;
  const label = count === 1 ? t.changeQueued : t.changesQueued;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-30 px-3 pb-2 pointer-events-none safe-area-bottom">
      <div
        role="status"
        aria-live="polite"
        className="w-full h-11 rounded-2xl bg-ios-fill2 dark:bg-dark-elevated
                   border border-gray-200 dark:border-dark-separator shadow-sm
                   flex items-center justify-between px-4"
      >
        <span className="text-sm font-semibold tabular-nums text-ios-label dark:text-dark-label">
          {count} {label}
        </span>
        {pushing && (
          <span className="inline-flex items-center gap-2 text-sm text-ios-secondary">
            <Loader2 size={16} className="animate-spin" />
            {t.pushing}
          </span>
        )}
      </div>
    </div>
  );
}
