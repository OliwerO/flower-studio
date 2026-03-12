// StockEvaluationPage — florist quality inspection for incoming flowers.
// After the driver returns from shopping, the florist physically checks each item:
// accept good stems, write off damaged/wilted ones. Like a receiving inspection
// gate on a production line — only quality-approved materials enter the warehouse.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';

export default function StockEvaluationPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState(null);

  // Per-line evaluation state: { [lineId]: { accepted, writeOff, reason, altAccepted, altWriteOff, altReason } }
  const [evalState, setEvalState] = useState({});

  const fetchOrders = useCallback(async () => {
    try {
      // Single batch fetch with lines included — no N+1 calls
      const res = await client.get('/stock-orders?status=Evaluating&include=lines');
      const withLines = res.data;
      setOrders(withLines);

      // Init eval state with defaults from driver data
      const initial = {};
      for (const order of withLines) {
        for (const line of order.lines) {
          const found = Number(line['Quantity Found']) || 0;
          const altFound = Number(line['Alt Quantity Found']) || 0;
          initial[line.id] = {
            accepted: found,
            writeOff: 0,
            reason: 'Damaged',
            altAccepted: altFound,
            altWriteOff: 0,
            altReason: 'Damaged',
          };
        }
      }
      setEvalState(initial);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  function updateEval(lineId, patch) {
    setEvalState(prev => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...patch },
    }));
  }

  // Auto-compute: accepted = found - writeOff
  function handleWriteOffChange(lineId, writeOff, field = 'writeOff') {
    const raw = Number(writeOff) || 0;
    if (field === 'writeOff') {
      const found = Number(orders.flatMap(o => o.lines).find(l => l.id === lineId)?.['Quantity Found']) || 0;
      const wo = Math.max(0, Math.min(raw, found));
      updateEval(lineId, { writeOff: wo, accepted: Math.max(0, found - wo) });
    } else {
      const altFound = Number(orders.flatMap(o => o.lines).find(l => l.id === lineId)?.['Alt Quantity Found']) || 0;
      const wo = Math.max(0, Math.min(raw, altFound));
      updateEval(lineId, { altWriteOff: wo, altAccepted: Math.max(0, altFound - wo) });
    }
  }

  async function submitEvaluation(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    setSubmittingId(orderId);
    try {
      const evalLines = order.lines
        .filter(l => l['Driver Status'] === 'Found All' || l['Driver Status'] === 'Partial')
        .map(l => {
          const ev = evalState[l.id] || {};
          return {
            lineId: l.id,
            quantityAccepted: Number(ev.accepted) || 0,
            writeOffQty: Number(ev.writeOff) || 0,
            writeOffReason: ev.reason || 'Damaged',
            altQuantityAccepted: Number(ev.altAccepted) || 0,
            altWriteOffQty: Number(ev.altWriteOff) || 0,
            altWriteOffReason: ev.altReason || 'Damaged',
          };
        });

      await client.post(`/stock-orders/${orderId}/evaluate`, { lines: evalLines });
      showToast(t.evaluationComplete, 'success');
      fetchOrders();
    } catch {
      showToast(t.evaluationError, 'error');
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ios-bg">
      {/* Header */}
      <header className="glass-nav px-4 pt-3 pb-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-base">
            ‹ {t.back || 'Back'}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockEvaluation}</h1>
          <span className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-32 space-y-6">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-ios-tertiary">{t.noOrders || 'Nothing to evaluate'}</p>
          </div>
        ) : (
          orders.map(order => {
            // Separate lines: found (for evaluation) vs not found (info only)
            const foundLines = order.lines.filter(l =>
              l['Driver Status'] === 'Found All' || l['Driver Status'] === 'Partial'
            );
            const notFoundLines = order.lines.filter(l => l['Driver Status'] === 'Not Found');

            // Group found lines by supplier
            const bySupplier = {};
            for (const line of foundLines) {
              const sup = line.Supplier || '—';
              if (!bySupplier[sup]) bySupplier[sup] = [];
              bySupplier[sup].push(line);
            }

            return (
              <div key={order.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ios-tertiary uppercase">
                    PO #{order['Stock Order ID'] || '—'}
                  </span>
                  {order['Assigned Driver'] && (
                    <span className="text-xs text-ios-secondary">{order['Assigned Driver']}</span>
                  )}
                </div>

                {/* Lines to evaluate — grouped by supplier */}
                {Object.entries(bySupplier).map(([supplier, lines]) => (
                  <div key={supplier} className="ios-card overflow-hidden">
                    <div className="bg-brand-50 px-4 py-2">
                      <span className="text-xs font-semibold text-brand-700 uppercase">{supplier}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {lines.map(line => {
                        const ev = evalState[line.id] || {};
                        const found = Number(line['Quantity Found']) || 0;
                        const altFound = Number(line['Alt Quantity Found']) || 0;
                        const altSupplier = line['Alt Supplier'];

                        const evalLotSize = Number(line['Lot Size']) || 1;

                        return (
                          <div key={line.id} className="px-4 py-3 space-y-2">
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-ios-label">
                                {line['Flower Name']}
                                {evalLotSize > 1 && (
                                  <span className="text-xs text-ios-tertiary ml-1">
                                    ({t.lotSize}: {evalLotSize})
                                  </span>
                                )}
                              </span>
                              <span className="text-xs text-ios-tertiary">
                                {t.driverFound}: {found}
                              </span>
                            </div>

                            {/* Accept / write-off row */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <label className="text-[11px] text-ios-tertiary">{t.accept}</label>
                                <input
                                  type="number"
                                  value={ev.accepted ?? found}
                                  onChange={e => {
                                    const val = Math.max(0, Math.min(Number(e.target.value) || 0, found));
                                    updateEval(line.id, { accepted: val, writeOff: Math.max(0, found - val) });
                                  }}
                                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                  min="0" max={found}
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-[11px] text-ios-tertiary">{t.writeOffQty}</label>
                                <input
                                  type="number"
                                  value={ev.writeOff || 0}
                                  onChange={e => handleWriteOffChange(line.id, e.target.value, 'writeOff')}
                                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                  min="0"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-[11px] text-ios-tertiary">{t.writeOffReason || 'Reason'}</label>
                                <select
                                  value={ev.reason || 'Damaged'}
                                  onChange={e => updateEval(line.id, { reason: e.target.value })}
                                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                >
                                  <option value="Wilted">{t.reasonWilted}</option>
                                  <option value="Damaged">{t.reasonDamaged}</option>
                                </select>
                              </div>
                            </div>

                            {/* Alt supplier row (if driver found more elsewhere) */}
                            {altSupplier && altFound > 0 && (
                              <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
                                <span className="text-xs text-ios-secondary">
                                  + {altSupplier}: {altFound}
                                </span>
                                <div className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <input
                                      type="number"
                                      value={ev.altAccepted ?? altFound}
                                      onChange={e => {
                                        const val = Math.max(0, Math.min(Number(e.target.value) || 0, altFound));
                                        updateEval(line.id, { altAccepted: val, altWriteOff: Math.max(0, altFound - val) });
                                      }}
                                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                      min="0" max={altFound}
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <input
                                      type="number"
                                      value={ev.altWriteOff || 0}
                                      onChange={e => handleWriteOffChange(line.id, e.target.value, 'altWriteOff')}
                                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                      min="0"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <select
                                      value={ev.altReason || 'Damaged'}
                                      onChange={e => updateEval(line.id, { altReason: e.target.value })}
                                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                                    >
                                      <option value="Wilted">{t.reasonWilted}</option>
                                      <option value="Damaged">{t.reasonDamaged}</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Not found lines — info only */}
                {notFoundLines.length > 0 && (
                  <details className="ios-card overflow-hidden">
                    <summary className="px-4 py-3 text-xs font-semibold text-ios-tertiary cursor-pointer">
                      {t.notFoundByDriver} ({notFoundLines.length})
                    </summary>
                    <div className="divide-y divide-gray-100">
                      {notFoundLines.map(line => (
                        <div key={line.id} className="px-4 py-2 flex items-center justify-between">
                          <span className="text-sm text-ios-secondary">{line['Flower Name']}</span>
                          <span className="text-xs text-ios-tertiary">{line.Notes || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Complete button */}
                <button
                  onClick={() => submitEvaluation(order.id)}
                  disabled={submittingId === order.id || foundLines.length === 0}
                  className="w-full py-3.5 rounded-2xl bg-brand-600 text-white text-base font-semibold
                             disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
                >
                  {submittingId === order.id ? t.saving || 'Saving...' : t.completeEvaluation}
                </button>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
