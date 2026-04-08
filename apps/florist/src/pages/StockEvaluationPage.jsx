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
      const res = await client.get('/stock-orders?status=Evaluating&include=lines');
      setOrders(res.data);
      const initial = {};
      for (const order of res.data) {
        for (const line of order.lines) {
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
      const msg = (t.confirmNewStockCards || 'These will be created as new stock cards:') + '\n\n' + list + '\n\n' + (t.confirmContinue || 'Continue?');
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
            <p className="text-ios-tertiary text-sm">{t.nothingToEvaluate || 'No deliveries to evaluate'}</p>
          </div>
        ) : (
          orders.map(order => {
            // A line is "evaluable" if there's anything physical to inspect:
            // - Primary supplier delivered (Found All / Partial), OR
            // - Primary failed but the alt supplier delivered substitutes
            // The second case was previously dropped into the read-only
            // notFound banner, leaving the florist unable to accept/write-off
            // the substitutes that actually arrived.
            const evaluableLines = order.lines.filter(l => {
              const status = l['Driver Status'];
              if (status === 'Found All' || status === 'Partial') return true;
              if (status === 'Not Found' && Number(l['Alt Quantity Found']) > 0) return true;
              return false;
            });
            const notFoundLines = order.lines.filter(l =>
              l['Driver Status'] === 'Not Found' && !(Number(l['Alt Quantity Found']) > 0)
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
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700">
                      {t.stockEvaluation}
                    </span>
                  </div>
                  {order['Assigned Driver'] && (
                    <span className="text-xs text-ios-secondary">
                      {t.driver || 'Driver'}: {order['Assigned Driver']}
                    </span>
                  )}
                </div>

                {/* Found lines grouped by supplier */}
                {Object.entries(bySupplier).map(([supplier, lines]) => (
                  <div key={supplier} className="ios-card overflow-hidden">
                    {/* Supplier header */}
                    <div className="bg-brand-50 px-4 py-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-700">{supplier}</span>
                      <span className="text-xs text-brand-500">{lines.length} {t.items || 'items'}</span>
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
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-sm font-semibold text-ios-label">{line['Flower Name']}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-ios-tertiary">
                                  {lotSize > 1 && <span>{t.lotSize}: {lotSize}</span>}
                                  {costPrice > 0 && <span>{costPrice} zł</span>}
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-ios-tertiary">{t.qtyNeeded || 'Needed'}: {needed}</p>
                                <p className="text-sm font-bold text-ios-label">{t.driverFound}: {found}</p>
                              </div>
                            </div>

                            {/* Accept / Write-off controls — only when primary supplier actually delivered */}
                            {found > 0 && (
                            <div className="bg-gray-50 rounded-xl px-3 py-2.5 space-y-2">
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <label className="text-[10px] text-emerald-600 uppercase font-semibold mb-0.5 block">
                                    ✓ {t.accept}
                                  </label>
                                  <input
                                    type="number"
                                    value={ev.accepted ?? found}
                                    onChange={e => {
                                      const val = Math.max(0, Math.min(Number(e.target.value) || 0, found));
                                      updateEval(line.id, { accepted: val, writeOff: Math.max(0, found - val) });
                                    }}
                                    className="w-full text-sm font-medium border border-emerald-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                    min="0" max={found}
                                  />
                                </div>
                                <div className="flex-1">
                                  <label className="text-[10px] text-amber-600 uppercase font-semibold mb-0.5 block">
                                    ✗ {t.writeOffQty}
                                  </label>
                                  <input
                                    type="number"
                                    value={ev.writeOff || 0}
                                    onChange={e => handleWriteOffChange(line.id, e.target.value, 'writeOff')}
                                    className="w-full text-sm font-medium border border-amber-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                    min="0"
                                  />
                                </div>
                                <div className="flex-1">
                                  <label className="text-[10px] text-ios-tertiary uppercase font-semibold mb-0.5 block">
                                    {t.reason || 'Reason'}
                                  </label>
                                  <select
                                    value={ev.reason || 'Damaged'}
                                    onChange={e => updateEval(line.id, { reason: e.target.value })}
                                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                  >
                                    <option value="Wilted">{t.reasonWilted}</option>
                                    <option value="Damaged">{t.reasonDamaged}</option>
                                    <option value="Arrived Broken">{t.arrivedBroken || 'Arrived Broken'}</option>
                                    <option value="Overstock">{t.reasonOverstock || 'Overstock'}</option>
                                    <option value="Other">{t.reasonOther || 'Other'}</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            )}

                            {/* Alt supplier block — separate indigo section */}
                            {altSupplier && altFound > 0 && (() => {
                              // Real per-stem alt cost = total paid / delivered.
                              // This is what actually lands on the substitute's new stock card.
                              const altCostTotal = Number(line['Alt Cost']) || 0;
                              const altCostPerStem = altFound > 0 ? (altCostTotal / altFound) : 0;
                              const isNewSubstitute = altFlowerName &&
                                !knownStockNames.has(String(altFlowerName).trim().toLowerCase());
                              return (
                              <div className="bg-indigo-50 rounded-xl px-3 py-2.5 space-y-2 border border-indigo-100">
                                <p className="text-[10px] text-indigo-600 uppercase font-semibold tracking-wide">
                                  ↳ {altFlowerName ? `${altFlowerName} — ${altSupplier}` : altSupplier}
                                  <span className="ml-1 text-indigo-500 normal-case">
                                    ({altFound} {t.delivered || 'delivered'}
                                    {altCostPerStem > 0 && `, ${altCostPerStem.toFixed(2)} zł/шт`})
                                  </span>
                                </p>
                                {isNewSubstitute && (
                                  <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 border border-amber-200">
                                    {t.newStockCardWarning || `Will create new stock card: "${altFlowerName}"`}
                                  </p>
                                )}
                                <div className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <label className="text-[10px] text-emerald-600 uppercase font-semibold mb-0.5 block">
                                      ✓ {t.accept}
                                    </label>
                                    <input
                                      type="number"
                                      value={ev.altAccepted ?? altFound}
                                      onChange={e => {
                                        const val = Math.max(0, Math.min(Number(e.target.value) || 0, altFound));
                                        updateEval(line.id, { altAccepted: val, altWriteOff: Math.max(0, altFound - val) });
                                      }}
                                      className="w-full text-sm font-medium border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                      min="0" max={altFound}
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-[10px] text-amber-600 uppercase font-semibold mb-0.5 block">
                                      ✗ {t.writeOffQty}
                                    </label>
                                    <input
                                      type="number"
                                      value={ev.altWriteOff || 0}
                                      onChange={e => handleWriteOffChange(line.id, e.target.value, 'altWriteOff')}
                                      className="w-full text-sm font-medium border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                      min="0"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-[10px] text-ios-tertiary uppercase font-semibold mb-0.5 block">
                                      {t.reason || 'Reason'}
                                    </label>
                                    <select
                                      value={ev.altReason || 'Damaged'}
                                      onChange={e => updateEval(line.id, { altReason: e.target.value })}
                                      className="w-full text-sm border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                                    >
                                      <option value="Wilted">{t.reasonWilted}</option>
                                      <option value="Damaged">{t.reasonDamaged}</option>
                                      <option value="Overstock">{t.reasonOverstock || 'Overstock'}</option>
                                      <option value="Other">{t.reasonOther || 'Other'}</option>
                                    </select>
                                  </div>
                                </div>
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
                        const hasAlt = line['Alt Supplier'] && Number(line['Alt Quantity Found']) > 0;
                        return (
                          <div key={line.id} className="px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-ios-secondary">{line['Flower Name']}</span>
                              <span className="text-xs text-ios-tertiary">{Number(line['Quantity Needed']) || 0} {t.qtyNeeded || 'needed'}</span>
                            </div>
                            {line.Notes && (
                              <p className="text-xs text-ios-tertiary mt-0.5">{line.Notes}</p>
                            )}
                            {hasAlt && (
                              <div className="mt-1.5 bg-indigo-50 rounded-lg px-2.5 py-1.5 text-xs text-indigo-600">
                                ↳ {line['Alt Flower Name'] || '?'} ({line['Alt Supplier']}) × {line['Alt Quantity Found']}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Complete evaluation button */}
                <button
                  onClick={() => handleSubmitClick(order.id)}
                  disabled={submittingId === order.id || evaluableLines.length === 0}
                  className="w-full py-3.5 rounded-2xl bg-brand-600 text-white text-base font-semibold
                             disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
                >
                  {submittingId === order.id
                    ? (t.saving || '...')
                    : `${t.completeEvaluation} (${evaluableLines.length} ${t.items || 'items'})`}
                </button>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
