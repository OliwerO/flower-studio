// InlineEdit — click text to edit, blur/enter to save.
// Like a paper form field: shows the current value, click to write over it.
// Optional `validate(draft)` returns an error string to block the save;
// the invalid draft is discarded and `onValidationError(msg)` is notified.

import { useState, useEffect } from 'react';

export default function InlineEdit({
  value, onSave, type = 'text', placeholder, multiline, disabled,
  validate, onValidationError,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  // Sync draft when value changes externally
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    if (draft === value) { setEditing(false); return; }
    if (validate) {
      const err = validate(draft);
      if (err) {
        onValidationError?.(err);
        setDraft(value);        // revert so the bad value doesn't persist in the input
        setEditing(false);
        return;
      }
    }
    setEditing(false);
    onSave(draft);
  }

  if (!editing) {
    return (
      <span
        onClick={() => !disabled && setEditing(true)}
        className={`text-sm cursor-pointer rounded px-1 -mx-1 transition-colors
          border-b border-dashed border-transparent hover:border-brand-300 hover:bg-brand-50/30 ${
          value ? 'text-ios-label' : 'text-ios-tertiary'
        } ${disabled ? 'cursor-not-allowed opacity-50 hover:border-transparent hover:bg-transparent' : ''}`}
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
