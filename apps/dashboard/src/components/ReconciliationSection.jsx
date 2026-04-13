// ReconciliationSection — stock mismatch detection + substitute reconciliation.
// Shows items where stock qty doesn't match expected deductions,
// and allows bulk corrections.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

export default function ReconciliationSection({ onClose }) {
  const { showToast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    client.get('/stock/reconciliation')
      .then(r => setData(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggleSelect(stockId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(stockId)) next.delete(stockId);
      else next.add(stockId);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === data.length) setSelected(new Set());
    else setSelected(new Set(data.map(d => d.stockId)));
  }

  async function applyCorrections() {
    const adjustments = data
      .filter(d => selected.has(d.stockId))
      .map(d => ({ stockId: d.stockId, adjustDelta: -d.deductionExpected }));
    if (adjustments.length === 0) return;

    setApplying(true);
    try {
      await client.post('/stock/reconciliation/apply', adjustments);
      showToast(t.fixesApplied, 'success');
      onClose?.();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
    setApplying(false);
  }

  return (
    <div className="glass-card overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50/80">
        <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
          {t.reconcileTitle}
        </span>
        <button onClick={onClose} className="text-xs text-ios-tertiary hover:text-ios-label">✕</button>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-xs text-ios-tertiary text-center">{t.loading}...</p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ios-tertiary text-center">{t.noMismatches}</p>
      ) : (
        <>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-ios-tertiary uppercase border-b border-amber-100 bg-amber-50/40">
                  <th className="text-left py-1.5 px-3">
                    <input
                      type="checkbox"
                      checked={selected.size === data.length}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left py-1.5 px-2">{t.stockName}</th>
                  <th className="text-right py-1.5 px-2">{t.currentStock}</th>
                  <th className="text-right py-1.5 px-2">{t.expectedDeduction}</th>
                  <th className="text-left py-1.5 px-2">{t.orders}</th>
                </tr>
              </thead>
              <tbody>
                {data.map(item => (
                  <tr key={item.stockId} className="border-b border-gray-50">
                    <td className="py-1.5 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.stockId)}
                        onChange={() => toggleSelect(item.stockId)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-1.5 px-2 font-medium text-ios-label">{item.name}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${
                      item.currentQty < 0 ? 'text-red-600' : 'text-ios-label'
                    }`}>
                      {item.currentQty}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-amber-600">
                      −{item.deductionExpected}
                    </td>
                    <td className="py-1.5 px-2 text-ios-tertiary">
                      {item.orders?.slice(0, 3).map((o, i) => (
                        <span key={i} className={`mr-1 ${o.mixedDeferredFlag ? 'text-red-500 font-medium' : ''}`}>
                          #{o.appOrderId}{o.deferred ? '⚠' : ''}
                        </span>
                      ))}
                      {item.orders?.length > 3 && <span>+{item.orders.length - 3}</span>}
                      {item.orders?.some(o => o.mixedDeferredFlag) && (
                        <span className="ml-1 text-[10px] text-red-500">{t.mixedDeferred || 'mixed deferred'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 flex items-center justify-between border-t border-amber-100">
            <span className="text-xs text-ios-tertiary">
              {selected.size} / {data.length} {t.selected || 'selected'}
            </span>
            <button
              onClick={applyCorrections}
              disabled={applying || selected.size === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40"
            >
              {applying ? '...' : t.applyFixes}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
