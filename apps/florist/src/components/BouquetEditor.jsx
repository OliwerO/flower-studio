import { useState, useMemo } from 'react';
import { renderStockName } from '@flower-studio/shared';
import t from '../translations.js';

export default function BouquetEditor({ editing, saving, detail, isTerminal, isOwner, originalPrice, onSaveClick, doSave }) {
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');

  const dateBatchPattern = /\(\d{1,2}\.\w{3,4}\.?\)$/;

  // Visible stock: hide depleted dated batches
  const visibleStock = useMemo(() =>
    editing.stockItems.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      if (qty <= 0 && dateBatchPattern.test(s['Display Name'] || '') && !(editing.pendingPO?.[s.id]?.ordered > 0)) return false;
      return true;
    }),
    [editing.stockItems, editing.pendingPO]
  );

  // Filtered catalog: search + in-stock toggle
  // Always show items with pending PO quantities even at qty=0
  const catalogItems = useMemo(() => {
    let result = visibleStock;
    if (!showOutOfStock) {
      result = result.filter(s =>
        (Number(s['Current Quantity']) || 0) > 0 || (editing.pendingPO?.[s.id]?.ordered || 0) > 0
      );
    }
    const q = flowerSearch.toLowerCase().trim();
    if (!q) return result;
    return result.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerSearch, showOutOfStock, editing.pendingPO]);

  function addFromCatalog(s) {
    const existing = editing.editLines.findIndex(l => l.stockItemId === s.id);
    if (existing >= 0) {
      editing.incrementQty(existing);
    } else {
      editing.addFlowerFromStock(s);
    }
  }

  function refreshStock() {
    // Re-use the hook's internal fetch by re-starting (stock is cached in hook)
    // Directly fetch via the pattern the hook uses
  }

  const budgetNum = originalPrice || 0;
  const delta = budgetNum ? editing.editSellTotal - budgetNum : 0;
  const overBudget = delta > 0;
  const underBudget = delta < 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.labelBouquet}</p>
        {!isTerminal && !editing.editingBouquet && (
          <button onClick={() => editing.startEditing(detail.orderLines)}
            className="text-xs text-brand-600 font-medium">{t.edit || 'Edit'}</button>
        )}
      </div>

      {editing.editingBouquet ? (
        <div className="space-y-3">

          {/* Price target + running totals */}
          <div className="bg-white rounded-xl border border-gray-100 px-3 py-2.5 space-y-1.5">
            {originalPrice > 0 && (
              <div className="flex items-center justify-between text-xs text-ios-tertiary">
                <span>{t.originalPrice || 'Original price'}</span>
                <span className="font-semibold">{originalPrice} zł</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-brand-600">{editing.editSellTotal.toFixed(0)} zł</span>
                {budgetNum > 0 && (
                  <span className={`text-xs font-bold ${overBudget ? 'text-red-500' : underBudget ? 'text-green-600' : 'text-ios-tertiary'}`}>
                    ({overBudget ? '+' : ''}{delta.toFixed(0)})
                  </span>
                )}
              </div>
            </div>
            {isOwner && editing.editCostTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-ios-tertiary">
                <span>{t.costTotal || 'Cost'}: {editing.editCostTotal.toFixed(0)} zł</span>
                <span>{t.margin || 'Margin'}: {editing.editMargin}%</span>
              </div>
            )}
          </div>

          {/* Stock catalog */}
          <div>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.searchFlowers}</p>
              <button
                onClick={() => setShowOutOfStock(v => !v)}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${showOutOfStock ? 'bg-gray-200 text-ios-label' : 'bg-brand-50 text-brand-600'}`}
              >
                {showOutOfStock ? t.showAll : t.inStockOnly}
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-2">
              <div className="flex items-center px-3 gap-2">
                <span className="text-ios-tertiary text-sm">🔍</span>
                <input
                  type="text"
                  value={flowerSearch}
                  onChange={e => setFlowerSearch(e.target.value)}
                  placeholder={t.flowerSearch}
                  className="flex-1 py-2.5 text-sm bg-transparent outline-none placeholder-ios-tertiary/50"
                />
                {flowerSearch && (
                  <button onClick={() => setFlowerSearch('')} className="text-ios-tertiary text-sm">✕</button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {/* Add unlisted flower option */}
              {flowerSearch.length >= 2 && !catalogItems.some(s => (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => {
                    const existing = editing.stockItems.find(s => (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase());
                    if (existing) {
                      addFromCatalog(existing);
                      setFlowerSearch('');
                    } else {
                      editing.addNewFlowerQuick(flowerSearch);
                    }
                  }}
                  className="w-full flex items-center px-3 py-2.5 gap-2 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
                >
                  <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerSearch}"</span>
                </button>
              )}
              {catalogItems.length === 0 ? (
                <p className="text-ios-tertiary text-sm text-center py-6">{t.noStockFound || 'No items found'}</p>
              ) : (
                catalogItems.map(s => {
                  const qty = Number(s['Current Quantity']) || 0;
                  const sell = Number(s['Current Sell Price']) || 0;
                  const inCart = editing.editLines.find(l => l.stockItemId === s.id);
                  const low = qty > 0 && qty <= (s['Reorder Threshold'] || 5);
                  const out = qty <= 0;
                  const poQty = editing.pendingPO?.[s.id]?.ordered || 0;
                  const poDate = editing.pendingPO?.[s.id]?.plannedDate || null;
                  const poDateLabel = poDate ? (() => { const d = new Date(poDate); return isNaN(d) ? null : `${d.getDate()}.${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}.`; })() : null;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addFromCatalog(s)}
                      className={`w-full flex items-center px-3 py-2.5 gap-2 text-left transition-colors active-scale
                                  ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                          {renderStockName(s['Display Name'], qty > 0 ? s['Last Restocked'] : null)}
                        </div>
                        <div className="text-xs text-ios-tertiary">
                          <span className="font-bold text-brand-700">{sell.toFixed(0)} zł</span>
                          {isOwner && <span> · {Number(s['Current Cost Price'] || 0).toFixed(0)} zł {t.costPrice}</span>}
                          <span> · {qty} pcs</span>
                          {low && !out && <span className="text-ios-orange"> · low</span>}
                          {out && !poQty && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
                          {poQty > 0 && <span className="text-blue-600 font-medium"> · +{poQty} {poDateLabel ? `→ ${poDateLabel}` : (t.onOrder || 'on order')}</span>}
                        </div>
                      </div>
                      {inCart && (
                        <span className="min-w-[22px] h-[22px] px-1 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                          {inCart.quantity}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Cart — current bouquet lines with steppers */}
          {editing.editLines.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 px-1">{t.bouquetContents || 'Bouquet'}</p>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
                {editing.editLines.map((line, idx) => {
                  const si = editing.stockItems.find(s => s.id === line.stockItemId);
                  const availableQty = Number(si?.['Current Quantity']) || 0;
                  const liveSell = Number(si?.['Current Sell Price'] ?? line.sellPricePerUnit ?? 0);
                  const lineSell = liveSell * Number(line.quantity || 0);
                  const overStock = line.stockItemId && line.quantity > availableQty;
                  const linePoQty = line.stockItemId ? (editing.pendingPO?.[line.stockItemId]?.ordered || 0) : 0;
                  return (
                    <div key={line.id || idx} className="flex flex-col px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-ios-label truncate block">{line.flowerName}</span>
                          <span className="text-xs text-ios-tertiary">
                            {liveSell.toFixed(0)} zł × {line.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => editing.decrementQty(idx)}
                            className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-lg font-bold flex items-center justify-center active-scale"
                          >−</button>
                          <input type="number" min="1" value={line.quantity}
                            onChange={e => editing.updateLineQty(idx, e.target.value)}
                            onBlur={() => editing.commitLineQty(idx)}
                            onFocus={e => e.target.select()}
                            className="w-9 text-center text-sm font-bold border border-gray-200 rounded-xl py-1 bg-white outline-none"
                          />
                          <button
                            onClick={() => editing.incrementQty(idx)}
                            className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold flex items-center justify-center active-scale"
                          >+</button>
                        </div>
                        <button onClick={() => editing.setRemoveDialogIdx(idx)} className="text-red-400 active:text-red-600 text-sm px-1">✕</button>
                      </div>
                      {overStock && (
                        <div className={`mt-1 text-xs rounded-lg px-2 py-1 ${linePoQty > 0 ? 'text-blue-700 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
                          {line.quantity - availableQty} {t.notInStock || 'not in stock'}
                          {linePoQty > 0 && <span> · +{linePoQty} {t.onOrder || 'on order'}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Remove flower dialog — return or write off */}
          {editing.removeDialogIdx != null && (
            <div className={`${editing.removeDialogIsNegativeStock ? 'bg-blue-50' : 'bg-amber-50'} rounded-xl px-3 py-2 space-y-2`}>
              <p className={`text-sm font-medium ${editing.removeDialogIsNegativeStock ? 'text-blue-800' : 'text-amber-800'}`}>
                {editing.removeDialogLine?.flowerName}: {editing.removeDialogIsNegativeStock ? (t.notReceivedYet || 'Not received yet') : (t.returnOrWriteOff || 'Return or write off?')}
              </p>
              <div className="flex gap-2">
                <button onClick={() => editing.confirmRemoveLine('return')}
                  className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-medium active-scale">
                  {t.returnToStock || 'Return'}
                </button>
                <button onClick={() => editing.confirmRemoveLine('writeoff')}
                  className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium active-scale">
                  {t.writeOff || 'Write off'}
                </button>
              </div>
              <button onClick={() => editing.setRemoveDialogIdx(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
            </div>
          )}

          {/* Stock action dialog — shown when Save is tapped and quantities decreased */}
          {editing.stockAction === 'pending' && (() => {
            const reduced = editing.editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
            const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
            return totalReduced > 0 || editing.removedLines.length > 0 ? (
              <div className="bg-amber-50 rounded-xl px-3 py-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">
                  {t.spareFlowersQuestion || 'What would you like to do with the spare flowers?'}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => doSave('return')}
                    className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active-scale">
                    {t.returnToStock || 'Return to stock'}
                  </button>
                  <button onClick={() => doSave('writeoff')}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium active-scale">
                    {t.writeOff || 'Write off'}
                  </button>
                </div>
                <button onClick={() => editing.setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
              </div>
            ) : null;
          })()}

          <div className="flex gap-2 pt-1">
            <button onClick={() => {
              const result = onSaveClick();
              if (result) result.then(data => { if (data) return; });
            }} disabled={saving || editing.saving}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
            >{saving || editing.saving ? '...' : (t.save || 'Save')}</button>
            <button onClick={() => editing.cancelEditing()}
              className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm active-scale"
            >{t.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
          {detail.orderLines.map((line, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ios-label">{line['Flower Name']}</p>
                <p className="text-xs text-ios-tertiary">
                  {line['Sell Price Per Unit']} zł × {line['Quantity']}
                </p>
              </div>
              <p className="text-sm font-semibold text-brand-600">
                {(Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0)).toFixed(0)} zł
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
