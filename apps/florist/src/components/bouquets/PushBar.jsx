import { Upload, Loader2 } from 'lucide-react';
import t from '../../translations.js';

// Sticky bar that appears when there are pending changes to push to Wix.
// Manual-only by owner's choice (no auto-debounce) — one deliberate tap
// synchronizes everything.

export default function PushBar({ count, pushing, onPush }) {
  if (count === 0) return null;
  const label = count === 1 ? t.changeQueued : t.changesQueued;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-30 px-3 pb-2 pointer-events-none safe-area-bottom">
      <button
        onClick={onPush}
        disabled={pushing}
        className="pointer-events-auto w-full h-14 rounded-2xl bg-brand-600 text-white shadow-lg
                   flex items-center justify-between px-5 active:bg-brand-700 active-scale
                   disabled:opacity-70"
      >
        <span className="text-sm font-semibold tabular-nums">
          {count} {label}
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          {pushing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          {pushing ? t.pushing : t.pushToWix}
        </span>
      </button>
    </div>
  );
}
