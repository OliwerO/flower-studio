import { useMemo, useState } from 'react';

/**
 * WriteOffBatchPicker — form-card for writing off stems from a Variety's
 * physical buckets. Stems with the same Sell price collapse into one tier
 * option (matches the Stock-list merge rule, 2026-05-31). Demand Entries
 * are excluded.
 *
 * Default selection = the cheapest tier (lowest sell price); the host then
 * spreads the write-off across underlying stock_ids in FEFO order (oldest
 * first) by iterating the `stockIds` array.
 *
 * Props:
 *   variety   — { rows: [{ id, current_quantity, date, current_sell_price }], ... }
 *   reasons   — [{ value, label }]
 *   t         — { writeOffPickerTitle, writeOffQty, writeOffReason, writeOffBatch,
 *                 writeOffConfirm, cancel, stems, currency }
 *   onConfirm — ({ stockIds, qty, reason }) => void  — stockIds in FEFO order
 *   onCancel  — () => void
 */
export default function WriteOffBatchPicker({ variety, reasons, t, onConfirm, onCancel }) {
  // Merge stems by sell price; track FEFO-ordered underlying ids per tier.
  const tiers = useMemo(() => {
    const positiveRows = (variety?.rows ?? []).filter(
      (r) => (Number(r.current_quantity) || 0) > 0,
    );
    const byTier = new Map();
    for (const r of positiveRows) {
      const sellRaw = r['Current Sell Price'] ?? r.current_sell_price;
      const sell = sellRaw != null && sellRaw !== '' ? Number(sellRaw) : null;
      const tierKey = sell != null && isFinite(sell) ? sell.toFixed(2) : 'null';
      let m = byTier.get(tierKey);
      if (!m) {
        m = { key: tierKey, sell, rows: [], totalQty: 0 };
        byTier.set(tierKey, m);
      }
      m.rows.push(r);
      m.totalQty += Number(r.current_quantity) || 0;
    }
    // FEFO-sort rows inside each tier; sort tiers by sell asc.
    for (const m of byTier.values()) {
      m.rows.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
    }
    return [...byTier.values()].sort((a, b) => (a.sell ?? 0) - (b.sell ?? 0));
  }, [variety]);

  const [selectedKey, setSelectedKey] = useState(() => tiers[0]?.key ?? null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');

  const selectedTier = tiers.find((m) => m.key === selectedKey) ?? null;
  const qtyNum = parseInt(qty, 10);
  const isValid =
    qtyNum > 0 &&
    !!reason &&
    selectedTier !== null &&
    qtyNum <= (selectedTier?.totalQty || 0);

  function handleConfirm() {
    if (!isValid) return;
    onConfirm({
      stockIds: selectedTier.rows.map(r => r.id),
      qty:      qtyNum,
      reason,
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-4">
      {/* Title */}
      <h3 className="text-sm font-semibold text-gray-900">{t.writeOffPickerTitle}</h3>

      {/* Tier selector — one chip per sell price */}
      <div className="space-y-1">
        <span className="block text-xs font-medium text-gray-700">{t.writeOffBatch}</span>
        <div className="flex flex-wrap gap-2">
          {tiers.map((tier) => {
            const isSelected = tier.key === selectedKey;
            const sellLabel = tier.sell != null
              ? `${tier.sell.toFixed(2)} ${t.currency ?? 'zł'}`
              : '—';
            return (
              <button
                key={tier.key}
                type="button"
                data-testid="writeoff-batch-option"
                data-tier-key={tier.key}
                data-stock-ids={tier.rows.map(r => r.id).join(',')}
                onClick={() => setSelectedKey(tier.key)}
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
                    data-tier-key={tier.key}
                    className="sr-only"
                  />
                )}
                {sellLabel} · {tier.totalQty} {t.stems}
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
