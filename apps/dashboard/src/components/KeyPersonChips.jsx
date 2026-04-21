// KeyPersonChips — slot-based UI over the flat `Key person 1` / `Key person 2`
// fields. Renders up to two chips; an "+ Add" button appears when a slot is
// empty. This UI deliberately behaves like N slots so a future Postgres
// migration to a proper many-to-many key_people table doesn't require a
// frontend rewrite.

import { useState } from 'react';
import t from '../translations.js';
import InlineEdit from './InlineEdit.jsx';

const SLOTS = [
  { nameField: 'Key person 1', dateField: 'Key person 1 (important DATE)' },
  { nameField: 'Key person 2', dateField: 'Key person 2 (important DATE)' },
];

export default function KeyPersonChips({ cust, onPatch }) {
  // Index of the slot currently being filled via the "+ Add" button.
  const [addingSlot, setAddingSlot] = useState(null);

  const filledCount = SLOTS.filter(s => cust[s.nameField]).length;
  const allFilled = filledCount >= SLOTS.length;

  function handleAdd() {
    const firstEmpty = SLOTS.findIndex(s => !cust[s.nameField]);
    if (firstEmpty !== -1) setAddingSlot(firstEmpty);
  }

  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.keyPeople}
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
              autoFocus={isAdding}
              onDone={() => setAddingSlot(null)}
            />
          );
        })}

        <button
          onClick={handleAdd}
          disabled={allFilled}
          title={allFilled ? t.keyPersonLimit : undefined}
          className={`text-xs px-2.5 py-1.5 rounded-lg border border-dashed ${
            allFilled
              ? 'border-gray-200 text-gray-300 cursor-not-allowed'
              : 'border-brand-300 text-brand-700 hover:bg-brand-50'
          }`}
        >
          + {t.addKeyPerson}
        </button>
      </div>
    </div>
  );
}

function KeyPersonSlot({ slot, cust, onPatch, autoFocus, onDone }) {
  const name = cust[slot.nameField];
  const date = cust[slot.dateField];

  function clearSlot() {
    onPatch(slot.nameField, null);
    onPatch(slot.dateField, null);
    onDone?.();
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
            placeholder={t.keyPersonNamePlaceholder}
          />
        </div>
        {name && (
          <button
            onClick={clearSlot}
            aria-label={t.remove}
            className="text-ios-tertiary hover:text-ios-red text-sm leading-none w-4 h-4 flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-1">
        <p className="text-[10px] text-ios-tertiary mb-0.5">{t.importantDate}</p>
        <InlineEdit
          value={date || ''}
          onSave={v => onPatch(slot.dateField, v || null)}
          placeholder="—"
        />
      </div>
    </div>
  );
}
