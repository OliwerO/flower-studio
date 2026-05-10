import { useMemo, useState } from 'react';

/**
 * WriteOffBatchPicker — form-card for writing off stems from a specific Batch.
 *
 * Demand Entries (current_quantity < 0) are excluded from the picker.
 * Default selection = oldest Batch by date (FIFO).
 * Owner can override by clicking a different Batch option.
 *
 * Props:
 *   variety   — { rows: [{ id, current_quantity, date }], ... }
 *   reasons   — [{ value, label }]
 *   t         — { writeOffPickerTitle, writeOffQty, writeOffReason, writeOffBatch,
 *                 writeOffConfirm, cancel, stems }
 *   onConfirm — ({ stockId, qty, reason }) => void
 *   onCancel  — () => void
 */
export default function WriteOffBatchPicker({ variety, reasons, t, onConfirm, onCancel }) {
  // Sort batches ascending by date; exclude Demand Entries (qty < 0).
  const batches = useMemo(() => {
    const rows = (variety?.rows ?? []).filter(
      (r) => (Number(r.current_quantity) || 0) >= 0,
    );
    return [...rows].sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
  }, [variety]);

  // Default = oldest batch (first after asc sort).
  const [selectedId, setSelectedId] = useState(() => batches[0]?.id ?? null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');

  const selectedBatch = batches.find((r) => r.id === selectedId) ?? null;
  const qtyNum = parseInt(qty, 10);
  const isValid =
    qtyNum > 0 &&
    !!reason &&
    selectedBatch !== null &&
    qtyNum <= (Number(selectedBatch?.current_quantity) || 0);

  function handleConfirm() {
    if (!isValid) return;
    onConfirm({ stockId: selectedId, qty: qtyNum, reason });
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-4">
      {/* Title */}
      <h3 className="text-sm font-semibold text-gray-900">{t.writeOffPickerTitle}</h3>

      {/* Batch selector */}
      <div className="space-y-1">
        <span className="block text-xs font-medium text-gray-700">{t.writeOffBatch}</span>
        <div className="flex flex-wrap gap-2">
          {batches.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <button
                key={row.id}
                type="button"
                data-testid="writeoff-batch-option"
                data-stock-id={row.id}
                onClick={() => setSelectedId(row.id)}
                className={[
                  'px-3 py-1.5 rounded-lg border text-xs transition-colors',
                  isSelected
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-900 font-medium'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {isSelected && (
                  <span
                    data-testid="writeoff-batch-option-selected"
                    data-stock-id={row.id}
                    className="sr-only"
                  />
                )}
                ({row.date}) {Number(row.current_quantity)} {t.stems}
              </button>
            );
          })}
        </div>
      </div>

      {/* Qty input */}
      <div className="space-y-1">
        <label htmlFor="writeoff-qty" className="block text-xs font-medium text-gray-700">
          {t.writeOffQty}
        </label>
        <input
          id="writeoff-qty"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
        />
      </div>

      {/* Reason select */}
      <div className="space-y-1">
        <label htmlFor="writeoff-reason" className="block text-xs font-medium text-gray-700">
          {t.writeOffReason}
        </label>
        <select
          id="writeoff-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
        >
          <option value="" />
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!isValid}
          className="flex-1 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t.writeOffConfirm}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
