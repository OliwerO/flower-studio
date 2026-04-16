// DissolvePremadesDialog — confirmation modal shown when saving a bouquet
// would push a flower's stock below zero AND one or more premade bouquets
// hold stems of that flower. The owner picks which premades to dissolve
// (returns remaining stems to stock, deletes the bouquet) before the save
// proceeds.
//
// Pre-selects the minimum combination of premades needed to cover each
// shortfall — greedy by smallest qty first — so the default answer is the
// safest. Owner can uncheck or add more freely.
//
// Dialog is translation-agnostic: all visible text is passed in via props.

import { useMemo, useState } from 'react';

/**
 * @param {Object}   p
 * @param {Object}   p.candidates - { shortfalls: [{ stockId, name, shortage, available, need, bouquets: [{bouquetId, name, qty}] }] }
 * @param {boolean}  p.saving
 * @param {Function} p.onConfirm  - (bouquetIds: string[]) => Promise
 * @param {Function} p.onCancel
 * @param {Object}   p.labels     - { title, intro, headerNeed, headerCover, cancel, confirm, stems, bouquet }
 */
export default function DissolvePremadesDialog({ candidates, saving, onConfirm, onCancel, labels }) {
  // Minimum-coverage preselection per shortfall: sort bouquets by qty asc,
  // greedily take until cumulative qty covers the shortage. Union across
  // shortfalls so one bouquet covering multiple flowers is only counted once.
  const preselected = useMemo(() => {
    const picked = new Set();
    if (!candidates?.shortfalls) return picked;
    for (const sf of candidates.shortfalls) {
      const sorted = [...sf.bouquets].sort((a, b) => a.qty - b.qty);
      let covered = 0;
      for (const b of sorted) {
        if (covered >= sf.shortage) break;
        picked.add(b.bouquetId);
        covered += Number(b.qty) || 0;
      }
    }
    return picked;
  }, [candidates]);

  const [selected, setSelected] = useState(preselected);

  function toggle(bouquetId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(bouquetId)) next.delete(bouquetId);
      else next.add(bouquetId);
      return next;
    });
  }

  // Dedup bouquets across shortfalls for the rendered list, while keeping
  // track of which shortfall(s) each bouquet helps cover for display.
  const rows = useMemo(() => {
    const byId = {};
    if (!candidates?.shortfalls) return [];
    for (const sf of candidates.shortfalls) {
      for (const b of sf.bouquets) {
        if (!byId[b.bouquetId]) byId[b.bouquetId] = { id: b.bouquetId, name: b.name, contributions: [] };
        byId[b.bouquetId].contributions.push({ flower: sf.name, qty: b.qty });
      }
    }
    return Object.values(byId);
  }, [candidates]);

  if (!candidates) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-dark-elevated rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-ios-label dark:text-dark-label">
            {labels.title}
          </h2>
          <p className="text-xs text-ios-tertiary mt-1">{labels.intro}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {/* Shortfall summary — one row per flower */}
          <div className="space-y-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {candidates.shortfalls.map(sf => (
              <div key={sf.stockId} className="flex items-center justify-between text-xs">
                <span className="font-medium text-amber-900">{sf.name}</span>
                <span className="text-amber-800">
                  {labels.headerNeed}: {sf.need} · {labels.headerAvail}: {sf.available} · {labels.headerShort}: {sf.shortage}
                </span>
              </div>
            ))}
          </div>

          {/* Bouquet checkboxes */}
          <div className="space-y-1.5">
            {rows.map(row => {
              const isChecked = selected.has(row.id);
              return (
                <label
                  key={row.id}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    isChecked
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-dark-bg'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(row.id)}
                    className="mt-0.5 w-4 h-4 accent-brand-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ios-label dark:text-dark-label">{row.name}</p>
                    <p className="text-[11px] text-ios-tertiary mt-0.5">
                      {row.contributions.map((c, i) => (
                        <span key={i}>{i > 0 && ' · '}{c.qty} {c.flower}</span>
                      ))}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-200 text-sm font-medium active-scale"
          >
            {labels.cancel}
          </button>
          <button
            onClick={() => onConfirm([...selected])}
            disabled={saving || selected.size === 0}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 active-scale"
          >
            {saving ? '...' : `${labels.confirm} (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
