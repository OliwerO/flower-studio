import { useState, useRef, useEffect } from 'react';

// Header-anchored filter popover. The column passes its own control(s) as
// children; this shell owns only open/close + the active-state affordance.
export default function ColumnFilterPopover({ active, title, children }) {
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
        className={`ml-0.5 text-[10px] leading-none px-0.5 rounded transition-colors ${
          active ? 'text-brand-600' : 'text-ios-tertiary hover:text-ios-secondary'
        }`}
        title={title}
      >
        ▾{active ? <span className="ml-0.5 inline-block w-1 h-1 rounded-full bg-brand-600 align-middle" /> : null}
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-30 min-w-[180px] bg-white rounded-xl shadow-2xl border border-gray-200 p-3 space-y-2">
          {title && <p className="text-[11px] font-semibold text-ios-tertiary uppercase tracking-wide">{title}</p>}
          {children}
        </div>
      )}
    </span>
  );
}
