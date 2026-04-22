// KeyPersonChips — slot-based UI over the flat `Key person 1` / `Key person 2`
// fields. Renders up to two chips; an "+ Add" button appears when a slot is
// empty AND the viewer can edit.
//
// Ported 2026-04-22 from apps/dashboard/src/components/KeyPersonChips.jsx
// with one addition for the florist app: a `canEdit` prop gates every
// edit affordance. When canEdit is false (florist role), the chips render
// as static text — no "+ Add" button, no "×" clear, no inline edit on
// the name or the date. Prevents accidental CRM overwrites during a
// delivery rush by someone who wasn't supposed to touch these fields.
//
// The UI deliberately behaves like N slots so a future Postgres migration
// to a proper many-to-many key_people table doesn't require a frontend
// rewrite.

import { useState } from 'react';
import t from '../translations.js';
import InlineEdit from './InlineEdit.jsx';

const SLOTS = [
  { nameField: 'Key person 1', dateField: 'Key person 1 (important DATE)' },
  { nameField: 'Key person 2', dateField: 'Key person 2 (important DATE)' },
];

export default function KeyPersonChips({ cust, onPatch, canEdit = false }) {
  // Index of the slot currently being filled via the "+ Add" button.
  const [addingSlot, setAddingSlot] = useState(null);

  const filledCount = SLOTS.filter(s => cust[s.nameField]).length;
  const allFilled = filledCount >= SLOTS.length;

  function handleAdd() {
    const firstEmpty = SLOTS.findIndex(s => !cust[s.nameField]);
    if (firstEmpty !== -1) setAddingSlot(firstEmpty);
  }

  // Nothing to render at all when there are no filled slots AND the viewer
  // can't add one. Keeps the section from showing an empty skeleton for
  // florists looking at a customer who never had key people recorded.
  if (filledCount === 0 && !canEdit) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.keyPeople || 'Key people'}
      </p>
      <div className="flex flex-wrap gap-2">
        {SLOTS.map((slot, i) => {
          const hasName = !!cust[slot.nameField];
          const isAdding = addingSlot === i;
          if (!hasName && !isAdding) return null;
          return (
            <KeyPersonSlot
              key={i}
              slot={slot}
              cust={cust}
              onPatch={onPatch}
              canEdit={canEdit}
              autoFocus={isAdding}
              onDone={() => setAddingSlot(null)}
            />
          );
        })}

        {canEdit && (
          <button
            onClick={handleAdd}
            disabled={allFilled}
            title={allFilled ? (t.keyPersonLimit || 'Both slots filled') : undefined}
            className={`text-xs px-2.5 py-1.5 rounded-lg border border-dashed ${
              allFilled
                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                : 'border-brand-300 text-brand-700 hover:bg-brand-50'
            }`}
          >
            + {t.addKeyPerson || 'Add'}
          </button>
        )}
      </div>
    </div>
  );
}

function KeyPersonSlot({ slot, cust, onPatch, canEdit, autoFocus, onDone }) {
  const name = cust[slot.nameField];
  const date = cust[slot.dateField];

  function clearSlot() {
    onPatch(slot.nameField, null);
    onPatch(slot.dateField, null);
    onDone?.();
  }

  // View-only branch: render a read-only chip with the name + date. No
  // clickable affordances, no × button. Inline edit is deliberately not
  // wired, so a role=florist view can't produce a PATCH call.
  if (!canEdit) {
    return (
      <div className="bg-white/60 border border-gray-200 rounded-xl px-3 py-2 min-w-[180px]">
        <p className="text-sm font-medium text-ios-label truncate">{name || '—'}</p>
        <div className="mt-1">
          <p className="text-[10px] text-ios-tertiary mb-0.5">{t.importantDate || 'Important date'}</p>
          <p className="text-xs text-ios-label">{date || '—'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/60 border border-gray-200 rounded-xl px-3 py-2 min-w-[180px]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={name || ''}
            onSave={v => {
              onPatch(slot.nameField, v || null);
              if (v) onDone?.(); else clearSlot();
            }}
            placeholder={t.keyPersonNamePlaceholder || 'Name + contact'}
            autoFocus={autoFocus}
          />
        </div>
        {name && (
          <button
            onClick={clearSlot}
            aria-label={t.remove || 'Remove'}
            className="text-ios-tertiary hover:text-ios-red text-sm leading-none w-4 h-4 flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-1">
        <p className="text-[10px] text-ios-tertiary mb-0.5">{t.importantDate || 'Important date'}</p>
        <InlineEdit
          value={date || ''}
          onSave={v => onPatch(slot.dateField, v || null)}
          placeholder="—"
        />
      </div>
    </div>
  );
}
