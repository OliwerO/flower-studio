import { useState, useRef, useEffect } from 'react';

// Header-anchored filter popover. The column passes its own control(s) as
// children; this shell owns only open/close + the active-state affordance.
// The trigger is an explicit funnel button (not a bare ▾ glyph) so it reads as
// "filter this column" and gives a real tap target — header text itself is now
// the sort control, so the two affordances must be visually distinct.
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

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`relative ml-1 inline-flex items-center justify-center w-5 h-5 rounded-md border transition-colors ${
          active
            ? 'bg-brand-50 border-brand-300 text-brand-600'
            : 'border-transparent text-ios-tertiary hover:bg-gray-100 hover:text-ios-secondary'
        }`}
        title={title}
        aria-label={title}
      >
        {/* Funnel / filter icon */}
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {active && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-brand-600" />}
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
