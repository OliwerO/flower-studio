import { useState, useRef, useEffect } from 'react';

// Header-anchored filter popover. The column passes its own control(s) as
// children; this shell owns only open/close + the active-state affordance.
// The trigger is a defined chip-button carrying the universal "filter"
// (decreasing-bars) icon — deliberately NOT a triangle/caret, so it can never be
// mistaken for the sort arrow on the header label. To keep the header clean it
// stays hidden at rest and reveals on column hover (the parent header cell owns
// the `group`); it stays visible whenever that column is actively filtered or
// its popover is open. Space is reserved (opacity, not display) so the label
// never shifts when the chip appears.
// `align="right"` anchors the panel to the button's right edge — use it on
// right-aligned columns (Status / Total / Fulfilment) so the panel doesn't
// spill past the viewport edge.
export default function ColumnFilterPopover({ active, title, align = 'left', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pinned = active || open; // always-visible states

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`relative ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-md border transition-all ${
          pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        } ${
          active
            ? 'bg-brand-50 border-brand-300 text-brand-600'
            : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
        title={title}
        aria-label={title}
      >
        {/* Filter icon (decreasing horizontal bars) — never reads as a sort caret */}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="7" x2="21" y2="7" />
          <line x1="6.5" y1="12" x2="17.5" y2="12" />
          <line x1="10" y1="17" x2="14" y2="17" />
        </svg>
        {active && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-brand-600 ring-2 ring-white" />}
      </button>
      {open && (
        <div className={`absolute top-6 z-30 min-w-[180px] bg-white rounded-xl shadow-2xl border border-gray-200 p-3 space-y-2 ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}>
          {title && <p className="text-[11px] font-semibold text-ios-tertiary tracking-wide">{title}</p>}
          {children}
        </div>
      )}
    </span>
  );
}
