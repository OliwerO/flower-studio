// InlineEdit — click text to edit, blur/enter to save.
// Like a paper form field: shows the current value, click to write over it.

import { useState, useEffect } from 'react';

export default function InlineEdit({ value, onSave, type = 'text', placeholder, multiline, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  // Sync draft when value changes externally
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (!editing) {
    return (
      <span
        onClick={() => !disabled && setEditing(true)}
        className={`text-sm cursor-pointer hover:bg-white/40 rounded px-1 -mx-1 transition-colors ${
          value ? 'text-ios-label' : 'text-ios-tertiary'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        {value || placeholder || '—'}
      </span>
    );
  }

  if (multiline) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        rows={2}
        className="field-input w-full resize-none"
      />
    );
  }

  return (
    <input
      autoFocus
      type={type}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
      className="field-input w-full"
    />
  );
}
