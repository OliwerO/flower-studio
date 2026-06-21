/**
 * InlinePriceField — tap-to-edit price input.
 *
 * Tap the displayed value → number input appears → blur or Enter commits.
 * `onSave(numericValue)` is called with a parsed float (0 when blank/NaN).
 * All click/blur events stopPropagation so the host row's expand handler
 * is never triggered by a price interaction.
 *
 * Props:
 *   value   — current numeric price (null/undefined → shows "—")
 *   onSave  — (number) => void
 *   testid  — data-testid for the button (input gets `${testid}-input`)
 *   suffix  — optional node appended after the value in display mode (e.g. a "·mix" badge)
 */
import { useState } from 'react';

export default function InlinePriceField({ value, onSave, testid, suffix }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit(e) {
    e.stopPropagation();
    setDraft(value != null ? String(value) : '');
    setEditing(true);
  }
  function commit(e) {
    e.stopPropagation();
    setEditing(false);
    const num = parseFloat(draft);
    const next = isNaN(num) ? 0 : num;
    onSave(next);
  }
  if (editing) {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false); }}
        className="w-14 text-right text-sm tabular-nums border border-brand-300 rounded px-1 py-0 bg-white outline-none"
        data-testid={`${testid}-input`}
      />
    );
  }
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={startEdit}
      className="tabular-nums text-gray-700 underline decoration-dotted underline-offset-2 hover:text-gray-900"
    >
      {value != null ? value.toFixed(2) : '—'}{suffix}
    </button>
  );
}
