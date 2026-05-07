import parseBatchName from '../utils/parseBatchName.js';

/**
 * Modal shown when owner selects a flower variety with multiple Stock Items
 * (Batches and/or a Demand Entry). Owner picks which to use or creates new Demand Entry.
 *
 * Props:
 *   baseName        string  — variety base name e.g. "Pink Peonies"
 *   matches         array   — all Stock Items for this variety
 *   pendingPO       object  — { [stockId]: { ordered, plannedDate } }
 *   onSelectStock   fn      — (stockItem) => void
 *   onCreateDemand  fn      — () => void (only when no Demand Entry exists)
 *   onClose         fn      — () => void
 *   t               object  — { batchPickerTitle, demandEntry, demandEntryHint,
 *                              demandEntryCreate, onOrder, cancel, stems }
 */
export default function BatchPickerModal({
  baseName, matches, pendingPO = {}, onSelectStock, onCreateDemand, onClose, t,
}) {
  const batches = matches.filter(s => parseBatchName(s['Display Name'] || '').batch !== null);
  const demandEntry = matches.find(s => parseBatchName(s['Display Name'] || '').batch === null);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">{baseName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t.batchPickerTitle}</p>
        </div>

        <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {batches.map(s => {
            const qty = Number(s['Current Quantity']) || 0;
            const sell = Number(s['Current Sell Price']) || 0;
            const { batch } = parseBatchName(s['Display Name'] || '');
            const po = pendingPO[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStock(s)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{batch}</span>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {sell.toFixed(0)} zł · {qty} {t.stems}
                    {po?.ordered > 0 && (
                      <span className="text-blue-600 font-medium"> · +{po.ordered} {t.onOrder}</span>
                    )}
                  </div>
                </div>
                <span className={`text-sm font-bold ml-3 ${qty > 0 ? 'text-green-600' : 'text-amber-600'}`}>
                  {qty > 0 ? `+${qty}` : qty}
                </span>
              </button>
            );
          })}

          {demandEntry ? (
            <button
              type="button"
              onClick={() => onSelectStock(demandEntry)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-blue-700">{t.demandEntry}</span>
                <div className="text-xs text-blue-500 mt-0.5">{t.demandEntryHint}</div>
              </div>
              <span className="text-sm font-bold ml-3 text-blue-600">
                {Number(demandEntry['Current Quantity']) || 0}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreateDemand}
              className="w-full flex items-start px-4 py-3 text-left hover:bg-indigo-50 active:bg-indigo-100 transition-colors"
            >
              <span className="text-sm font-medium text-indigo-700">+ {t.demandEntryCreate}</span>
            </button>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 border-t border-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
