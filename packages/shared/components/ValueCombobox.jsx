import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ValueCombobox — pick one of the values you already use, or deliberately add
 * a new one.
 *
 * This exists because `<input list>` + `<datalist>` is a suggestion, not a
 * picker. It renders as a plain text box (the owner reported all four Variety
 * fields as "type fields"), on some browsers it never opens at all (#587),
 * and — the part that corrupts data — text that matches nothing is committed
 * the moment you look away. For a Variety attribute that is fatal: the 4-tuple
 * IS the identity, so `dahlia` beside `Dahlia` or `Dark pink` beside
 * `Dark Pink` splits one flower's stock across two cards, and neither shows the
 * true count (the #562 / #558 shape).
 *
 * So the rules here are:
 *   - the list opens on demand and shows everything, so you can look first;
 *   - an existing value snaps to its stored casing, always;
 *   - an unknown value is committed only by a deliberate act — clicking the
 *     create row, or Enter while it is highlighted. Leaving the field reverts.
 *
 * With no options to offer, it degrades to an honest plain text box: there is
 * nothing to pick, so typing is the only thing left.
 *
 * The server-side door (`POST /api/stock`, #603) still matches case- and
 * whitespace-insensitively — this is the screen half of the same rule, and it
 * catches what the server cannot: a value the owner invented because she never
 * saw the list.
 *
 * Props:
 *   value       committed value (string; '' is a real, distinct identity per ADR-0006)
 *   onChange    (next: string) => void — called only on a deliberate commit
 *   options     string[] of known values, already de-duplicated and ordered
 *   placeholder input placeholder
 *   testId      testid of the input; the parts hang off it (`-toggle`, `-list`,
 *               `-option`, `-create`, `-empty`)
 *   t           translations (uses `varietyValueCreate`)
 *   numeric     render a number field (Size) — still picks from `options`
 *   allowCreate false forbids inventing a value; unknown text then reverts
 *   disabled    pass-through
 *   className   pass-through, so hosts keep owning the field's look
 */

const norm = (v) => String(v ?? '').trim().toLowerCase();

export default function ValueCombobox({
  value = '',
  onChange,
  options = [],
  placeholder,
  testId = 'combobox',
  t = {},
  numeric = false,
  allowCreate = true,
  disabled = false,
  className = '',
}) {
  const [query, setQuery] = useState(String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);   // filter only once she starts typing
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);

  // The parent owns the value; follow it when it changes underneath us (a form
  // reset, or a card adopted by the caller). Keyed on `value` so it never
  // clobbers half-typed text on an unrelated re-render.
  useEffect(() => { setQuery(String(value ?? '')); }, [value]);

  const hasOptions = options.length > 0;

  const filtered = useMemo(() => {
    if (!typed) return options;
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) => norm(o).includes(q));
  }, [options, query, typed]);

  const trimmed = String(query ?? '').trim();
  const exact = useMemo(
    () => options.find((o) => norm(o) === norm(trimmed)) ?? null,
    [options, trimmed],
  );
  const canCreate = allowCreate && typed && trimmed !== '' && !exact;

  function commit(next) {
    setOpen(false);
    setTyped(false);
    setHighlight(-1);
    setQuery(String(next ?? ''));
    if (String(next ?? '') !== String(value ?? '')) onChange?.(String(next ?? ''));
  }

  function revert() {
    setOpen(false);
    setTyped(false);
    setHighlight(-1);
    setQuery(String(value ?? ''));
  }

  // Closing the field is not a commit — except where there is nothing to choose
  // from and typing is all there is, or where the text names a value we already
  // have (snap it), or where she cleared the field (a blank attribute is real).
  function handleBlur() {
    if (!hasOptions) { commit(trimmed); return; }
    if (trimmed === '') { commit(''); return; }
    if (exact) { commit(exact); return; }
    revert();
  }

  function handleKeyDown(e) {
    if (!hasOptions) return;
    if (e.key === 'Escape') { e.preventDefault(); revert(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (filtered.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = highlight < 0
        ? (step === 1 ? 0 : filtered.length - 1)
        : (highlight + step + filtered.length) % filtered.length;
      setHighlight(next);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && filtered[highlight]) { commit(filtered[highlight]); return; }
      if (exact) { commit(exact); return; }
      if (canCreate) { commit(trimmed); return; }
      if (trimmed === '') commit('');
    }
  }

  const cls = className
    || 'w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none';

  const field = (
    <input
      type={numeric ? 'number' : 'text'}
      inputMode={numeric ? 'numeric' : undefined}
      value={query}
      disabled={disabled}
      placeholder={placeholder}
      className={hasOptions ? `${cls} pr-7` : cls}
      data-testid={testId}
      autoComplete="off"
      {...(hasOptions ? { role: 'combobox', 'aria-expanded': open, 'aria-autocomplete': 'list' } : {})}
      onChange={(e) => { setQuery(e.target.value); setTyped(true); setOpen(true); setHighlight(-1); }}
      onClick={() => { if (hasOptions && !disabled) setOpen(true); }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );

  if (!hasOptions) return field;

  return (
    <div className="relative" ref={wrapRef}>
      {field}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={placeholder}
        data-testid={`${testId}-toggle`}
        className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-gray-400 hover:text-gray-600"
        // Keep the field focused so opening the list never triggers the blur revert.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          data-testid={`${testId}-list`}
          // mousedown fires before blur — without this, choosing a row would
          // first revert the query and then click nothing.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 left-0 right-0 mt-1 max-h-52 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1"
        >
          {filtered.map((o, i) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={norm(o) === norm(value)}
              data-testid={`${testId}-option`}
              className={`block w-full text-left text-sm px-2 py-1.5 ${
                i === highlight ? 'bg-gray-100' : 'hover:bg-gray-50'
              } ${norm(o) === norm(value) ? 'font-medium' : ''}`}
              onClick={() => commit(o)}
            >
              {o}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              data-testid={`${testId}-create`}
              className="block w-full text-left text-sm px-2 py-1.5 border-t border-gray-100 text-pink-600 hover:bg-pink-50"
              onClick={() => commit(trimmed)}
            >
              + {t.varietyValueCreate ?? 'Create'} «{trimmed}»
            </button>
          )}

          {filtered.length === 0 && !canCreate && (
            <div data-testid={`${testId}-empty`} className="px-2 py-1.5 text-sm text-gray-400">
              —
            </div>
          )}
        </div>
      )}
    </div>
  );
}
