// StockEvaluationPage — florist quality inspection for incoming flowers.
// After the driver returns from shopping, the florist physically checks each item:
// accept good stems, write off damaged/wilted ones.

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
  const [evalState, setEvalState] = useState({});
  // Lowercased set of existing Stock display names — used to preview which
  // substitutes will become brand-new stock cards on submit (edge case 2).
  const [knownStockNames, setKnownStockNames] = useState(new Set());
  const [committedMap, setCommittedMap] = useState({});

  useEffect(() => {
    client.get('/stock/committed').then(r => setCommittedMap(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    client.get('/stock-orders/meta/lookups')
      .then(r => {
        const names = (r.data.flowers || []).map(f => String(f.name || '').trim().toLowerCase());
        setKnownStockNames(new Set(names));
      })
      .catch(() => {});
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const [evalRes, errorRes] = await Promise.all([
        client.get('/stock-orders?status=Evaluating&include=lines'),
        client.get('/stock-orders?status=Eval Error&include=lines'),
      ]);
      const merged = [...evalRes.data, ...errorRes.data];
      setOrders(merged);
      const initial = {};
      for (const order of merged) {
        for (const line of order.lines) {
          // Already-processed lines (from a previous partial attempt) stay read-only
          if (line['Eval Status'] === 'Processed') continue;
          const found = Number(line['Quantity Found']) || 0;
          const altFound = Number(line['Alt Quantity Found']) || 0;
          initial[line.id] = {
            accepted: found, writeOff: 0, reason: 'Damaged',
            altAccepted: altFound, altWriteOff: 0, altReason: 'Damaged',
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
    setEvalState(prev => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

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

  // Before submit, check which substitute flower names don't match any
  // existing stock card — those will be created as new cards by the backend.
  // Shows a confirm dialog so the florist can catch typos (edge case 2).
  function collectNewSubstitutes(order) {
    const out = [];
    for (const line of order.lines) {
      if (line['Eval Status'] === 'Processed') continue;
      const ev = evalState[line.id] || {};
      const altAccepted = Number(ev.altAccepted) || 0;
      const altFlowerName = (line['Alt Flower Name'] || '').trim();
      if (altAccepted > 0 && altFlowerName &&
          !knownStockNames.has(altFlowerName.toLowerCase())) {
        out.push(altFlowerName);
      }
    }
    return out;
  }

  async function handleSubmitClick(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newOnes = collectNewSubstitutes(order);
    if (newOnes.length > 0) {
      const list = newOnes.map(n => `• ${n}`).join('\n');
      const msg = t.confirmNewStockCards + '\n\n' + list + '\n\n' + t.confirmContinue;
      if (!window.confirm(msg)) return;
    }
    submitEvaluation(orderId);
  }

  async function submitEvaluation(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    setSubmittingId(orderId);
    try {
      const evalLines = order.lines
        .filter(l => {
          if (l['Eval Status'] === 'Processed') return false;
          const status = l['Driver Status'];
          if (status === 'Found All' || status === 'Partial') return true;
          if (status === 'Not Found' && Number(l['Alt Quantity Found']) > 0) return true;
          return false;
        })
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
      const res = await client.post(`/stock-orders/${orderId}/evaluate`, { lines: evalLines });
      if (res.data?.success === false) {
        const failedCount = (res.data.lineResults || []).filter(r => r.status === 'error').length;
        showToast(`${failedCount} ${failedCount === 1 ? 'линия' : 'линий'} с ошибкой — повторите после исправления`, 'error');
      } else {
        showToast(t.evaluationComplete, 'success');
      }
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
      <header className="glass-nav px-4 pt-3 pb-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-sm">
            ‹ {t.navOrders}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockEvaluation}</h1>
          <span className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-32 space-y-6">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-2">📦</p>
            <p className="text-ios-tertiary text-sm">{t.nothingToEvaluate}</p>
          </div>
        ) : (
          orders.map(order => {
            const isRetry = order.Status === 'Eval Error';
            const evaluableLines = order.lines.filter(l => {
              if (l['Eval Status'] === 'Processed') return false;
              const status = l['Driver Status'];
              if (status === 'Found All' || status === 'Partial') return true;
              if (status === 'Not Found' && Number(l['Alt Quantity Found']) > 0) return true;
              return false;
            });
            const processedLines = order.lines.filter(l => l['Eval Status'] === 'Processed');
            const notFoundLines = order.lines.filter(l =>
              l['Driver Status'] === 'Not Found' &&
              l['Eval Status'] !== 'Processed' &&
              !(Number(l['Alt Quantity Found']) > 0)
            );

            // Group evaluable lines by supplier
            const bySupplier = {};
            for (const line of evaluableLines) {
              const sup = line.Supplier || '—';
              if (!bySupplier[sup]) bySupplier[sup] = [];
              bySupplier[sup].push(line);
            }

            return (
              <div key={order.id} className="space-y-3">
                {/* PO header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ios-tertiary uppercase">
                      {order['Stock Order ID'] || 'PO'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      isRetry ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {isRetry ? t.evalError : t.stockEvaluation}
                    </span>
                  </div>
                  {order['Assigned Driver'] && (
                    <span className="text-xs text-ios-secondary">
                      {t.driver}: {order['Assigned Driver']}
                    </span>
                  )}
                </div>

                {/* Already processed lines (from previous partial attempt) */}
                {processedLines.length > 0 && (
                  <div className="ios-card overflow-hidden opacity-60">
                    <div className="bg-emerald-50 px-4 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-700 uppercase">
                        {t.alreadyProcessed}
                      </span>
                      <span className="text-xs text-emerald-500">{processedLines.length}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {processedLines.map(line => (
                        <div key={line.id} className="px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-ios-secondary">{line['Flower Name']}</p>
                            {line['Alt Flower Name'] && (
                              <p className="text-xs text-indigo-500 mt-0.5">
                                ↳ {line['Alt Flower Name']}
                              </p>
                            )}
                          </div>
                          <div className="text-right text-xs text-ios-tertiary">
                            {Number(line['Quantity Accepted']) > 0 && (
                              <span className="text-emerald-600">
                                ✓ {line['Quantity Accepted']}
                              </span>
                            )}
                            {Number(line['Write Off Qty']) > 0 && (
                              <span className="text-amber-600 ml-2">
                                ✗ {line['Write Off Qty']}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evaluable lines grouped by supplier */}
                {Object.entries(bySupplier).map(([supplier, lines]) => (
                  <div key={supplier} className="ios-card overflow-hidden">
                    <div className="bg-brand-50 px-4 py-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-700">{supplier}</span>
                      <span className="text-xs text-brand-500">{lines.length} {t.items}</span>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {lines.map(line => {
                        const ev = evalState[line.id] || {};
                        const found = Number(line['Quantity Found']) || 0;
                        const needed = Number(line['Quantity Needed']) || 0;
                        const costPrice = Number(line['Cost Price']) || 0;
                        const lotSize = Number(line['Lot Size']) || 1;
                        const altFound = Number(line['Alt Quantity Found']) || 0;
                        const altSupplier = line['Alt Supplier'];
                        const altFlowerName = line['Alt Flower Name'] || '';

                        return (
                          <div key={line.id} className="px-4 py-3 space-y-3">
                            {/* Flower info header */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-ios-label">{line['Flower Name']}</p>
                                <p className="text-xs text-ios-tertiary mt-0.5">
                                  {lotSize > 1 && <>{t.lotSize}: {lotSize} · </>}
                                  {costPrice > 0 && <>{costPrice} zł</>}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs text-ios-tertiary">{t.qtyNeeded}: {needed}</p>
                                <p className={`text-sm font-bold ${found > 0 ? 'text-ios-label' : 'text-red-500'}`}>
                                  {t.driverFound}: {found}
                                </p>
                              </div>
                            </div>

                            {/* Accept / Write-off controls — only when primary supplier actually delivered */}
                            {found > 0 && (
                              <AcceptWriteOffRow
                                accepted={ev.accepted ?? found}
                                writeOff={ev.writeOff || 0}
                                reason={ev.reason || 'Damaged'}
                                max={found}
                                onAcceptChange={val => {
                                  const v = Math.max(0, Math.min(Number(val) || 0, found));
                                  updateEval(line.id, { accepted: v, writeOff: Math.max(0, found - v) });
                                }}
                                onWriteOffChange={val => handleWriteOffChange(line.id, val, 'writeOff')}
                                onReasonChange={val => updateEval(line.id, { reason: val })}
                              />
                            )}

                            {/* Alt supplier block */}
                            {altSupplier && altFound > 0 && (() => {
                              const altCostTotal = Number(line['Alt Cost']) || 0;
                              const altCostPerStem = altFound > 0 ? (altCostTotal / altFound) : 0;
                              const isNewSubstitute = altFlowerName &&
                                !knownStockNames.has(String(altFlowerName).trim().toLowerCase());
                              return (
                                <div className="bg-indigo-50/70 rounded-xl px-3 py-2.5 space-y-2 border border-indigo-100">
                                  <div>
                                    <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                                      ↳ {altFlowerName || altSupplier}
                                    </p>
                                    <p className="text-[11px] text-indigo-500 mt-0.5">
                                      {altSupplier} · {altFound} {t.delivered} · {altCostPerStem.toFixed(2)} zł/шт
                                    </p>
                                  </div>
                                  {isNewSubstitute && (
                                    <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-200">
                                      ⚠ {t.newStockCardWarning}
                                    </p>
                                  )}
                                  <AcceptWriteOffRow
                                    accepted={ev.altAccepted ?? altFound}
                                    writeOff={ev.altWriteOff || 0}
                                    reason={ev.altReason || 'Damaged'}
                                    max={altFound}
                                    borderColor="border-indigo-200"
                                    onAcceptChange={val => {
                                      const v = Math.max(0, Math.min(Number(val) || 0, altFound));
                                      updateEval(line.id, { altAccepted: v, altWriteOff: Math.max(0, altFound - v) });
                                    }}
                                    onWriteOffChange={val => handleWriteOffChange(line.id, val, 'altWriteOff')}
                                    onReasonChange={val => updateEval(line.id, { altReason: val })}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Not found lines */}
                {notFoundLines.length > 0 && (
                  <div className="ios-card overflow-hidden">
                    <div className="bg-red-50 px-4 py-2">
                      <span className="text-xs font-semibold text-red-600 uppercase">
                        {t.notFoundByDriver} ({notFoundLines.length})
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {notFoundLines.map(line => {
                        const stockItemId = line['Stock Item']?.[0];
                        const cd = stockItemId ? committedMap[stockItemId] : null;
                        return (
                          <div key={line.id} className="px-4 py-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-ios-secondary">{line['Flower Name']}</span>
                              <span className="text-xs text-ios-tertiary">{Number(line['Quantity Needed']) || 0} {t.qtyNeeded}</span>
                            </div>
                            {line.Notes && (
                              <p className="text-xs text-ios-tertiary mt-0.5">{line.Notes}</p>
                            )}
                            {cd?.orders?.length > 0 && (
                              <div className="mt-1.5 bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-200">
                                <p className="text-[10px] font-medium text-amber-700">
                                  ⚠ {cd.committed} {t.stemsCommitted} → {cd.orders.length} {t.ordersNeedSwap}
                                </p>
                                <div className="mt-0.5 flex flex-wrap gap-x-2">
                                  {cd.orders.map((o, i) => (
                                    <span
                                      key={i}
                                      onClick={(e) => { e.stopPropagation(); navigate(`/orders/${o.orderId}`); }}
                                      className="text-[10px] text-brand-600 cursor-pointer active:underline"
                                    >
                                      #{o.appOrderId} {o.customerName} ({o.qty})
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Submit button */}
                <button
                  onClick={() => handleSubmitClick(order.id)}
                  disabled={submittingId === order.id || evaluableLines.length === 0}
                  className="w-full py-3.5 rounded-2xl bg-brand-600 text-white text-base font-semibold
                             disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
                >
                  {submittingId === order.id
                    ? '...'
                    : `${t.completeEvaluation} (${evaluableLines.length})`}
                </button>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}

// Reusable row: accept count · write-off count · reason picker
function AcceptWriteOffRow({ accepted, writeOff, reason, max, borderColor = 'border-emerald-200', onAcceptChange, onWriteOffChange, onReasonChange }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-2">
      <div>
        <label className="text-[10px] text-emerald-600 uppercase font-semibold mb-1 block">
          ✓ {t.accept}
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={accepted}
          onChange={e => onAcceptChange(e.target.value)}
          className={`w-full text-center text-sm font-semibold ${borderColor} border rounded-xl px-2 py-2.5 bg-white outline-none`}
          min="0" max={max}
        />
      </div>
      <div>
        <label className="text-[10px] text-amber-600 uppercase font-semibold mb-1 block">
          ✗ {t.writeOffQty}
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={writeOff}
          onChange={e => onWriteOffChange(e.target.value)}
          className="w-full text-center text-sm font-semibold border-amber-200 border rounded-xl px-2 py-2.5 bg-white outline-none"
          min="0"
        />
      </div>
      <div>
        <label className="text-[10px] text-ios-tertiary uppercase font-semibold mb-1 block">
          {t.reason}
        </label>
        <select
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-xl px-2 py-2.5 bg-white outline-none appearance-none"
        >
          <option value="Damaged">{t.reasonDamaged}</option>
          <option value="Wilted">{t.reasonWilted}</option>
          <option value="Arrived Broken">{t.arrivedBroken}</option>
          <option value="Overstock">{t.reasonOverstock}</option>
          <option value="Other">{t.reasonOther}</option>
        </select>
      </div>
    </div>
  );
}
