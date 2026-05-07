import { useState } from 'react';
import t from '../../translations.js';
import { parseBatchName, findAllMatchingVariety, BatchPickerModal } from '@flower-studio/shared';

const PO_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatPoDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getDate()}.${PO_MONTHS[d.getMonth()]}.`;
}

export default function BouquetSection({ order, editing, isTerminal, saving, targetMarkup, doSave }) {
  const o = order;
  const [pickerModalVariety, setPickerModalVariety] = useState(null);
  const [pickerModalMatches, setPickerModalMatches] = useState([]);
  if (!o.orderLines?.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">
          {t.bouquetComposition}
        </p>
        {!isTerminal && !editing.editingBouquet && (
          <button
            onClick={() => editing.startEditing(o.orderLines)}
            className="text-xs text-brand-600 font-medium"
          >{t.editBouquet}</button>
        )}
      </div>

      {editing.editingBouquet ? (() => {
        const { editLines, editCostTotal, editSellTotal, editMargin,
                addingFlower, flowerSearch, stockItems, newFlowerForm,
                removeDialogIdx, removeDialogLine, removeDialogIsNegativeStock,
                stockAction } = editing;
        return (
        <div className="space-y-2">
          {editLines.map((line, idx) => {
            const lineSell = Number(line.sellPricePerUnit || 0) * Number(line.quantity || 0);
            const { name: parsedName, batch } = parseBatchName(line.flowerName);
            return (
            <div key={line.id || idx} className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ios-label truncate block">
                    {parsedName}
                    {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                  </span>
                  <span className="text-xs text-ios-tertiary">
                    {Number(line.sellPricePerUnit || 0).toFixed(0)} {t.zl} × {line.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} {t.zl}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => editing.decrementQty(idx)}
                    className="w-7 h-7 rounded-full bg-white text-ios-secondary text-lg font-bold flex items-center justify-center">−</button>
                  <input type="number" min="1" value={line.quantity}
                    onChange={e => editing.updateLineQty(idx, e.target.value)}
                    onBlur={() => editing.commitLineQty(idx)}
                    onFocus={e => e.target.select()}
                    className="w-10 text-center text-sm font-bold border border-gray-200 rounded-lg py-1" />
                  <button onClick={() => editing.incrementQty(idx)}
                    className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold flex items-center justify-center">+</button>
                </div>
                <button onClick={() => editing.setRemoveDialogIdx(idx)}
                  className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
              </div>
            </div>
            );
          })}

          {editLines.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
                <span className="text-base font-bold text-brand-600">{editSellTotal.toFixed(0)} {t.zl}</span>
              </div>
              <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-50">
                <span className="text-xs text-ios-tertiary">{t.costTotal} · {t.markup}: {editMargin}%</span>
                <span className="text-xs text-ios-tertiary font-medium">{editCostTotal.toFixed(0)} {t.zl}</span>
              </div>
            </div>
          )}

          {!addingFlower ? (
            <button onClick={() => editing.setAddingFlower(true)}
              className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg hover:bg-brand-100"
            >+ {t.addFlower}</button>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
              <input type="text" value={flowerSearch}
                onChange={e => editing.setFlowerSearch(e.target.value)}
                placeholder={t.flowerSearch}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                autoFocus />
              <div className="flex items-center text-[10px] text-ios-tertiary uppercase tracking-wide px-2 pt-1">
                <span className="flex-1">{t.flowers}</span>
                <span className="w-14 text-right">{t.costPrice}</span>
                <span className="w-14 text-right">{t.sellPrice}</span>
                <span className="w-12 text-right">{t.quantity}</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                {editing.getFilteredStock(flowerSearch)
                  .slice(0, 20)
                  .map(s => {
                    const qty = Number(s['Current Quantity']) || 0;
                    const cost = Number(s['Current Cost Price']) || 0;
                    const sell = Number(s['Current Sell Price']) || 0;
                    const { name: fn, batch: b } = parseBatchName(s['Display Name']);
                    const poInfo = editing.pendingPO?.[s.id];
                    const poQty = poInfo?.ordered || 0;
                    const poDateLabel = formatPoDate(poInfo?.plannedDate);
                    return (
                      <button key={s.id} type="button"
                        onClick={() => {
                          const baseName = parseBatchName(s['Display Name'] || '').name;
                          const allMatches = findAllMatchingVariety(editing.stockItems, baseName);
                          if (allMatches.length <= 1) {
                            editing.addFlowerFromStock(s);
                          } else {
                            setPickerModalVariety(baseName);
                            setPickerModalMatches(allMatches);
                          }
                        }}
                        className={`w-full flex flex-col px-2 py-1.5 text-sm hover:bg-gray-50 rounded ${poQty > 0 ? 'bg-blue-50/50' : qty <= 0 ? 'bg-amber-50/50' : ''}`}
                      >
                        <div className="flex items-center w-full">
                          <span className="flex-1 font-medium text-left truncate">
                            {fn}
                            {b && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{b}</span>}
                          </span>
                          <span className="w-14 text-right text-xs text-ios-tertiary">{cost > 0 ? cost.toFixed(0) : '—'}</span>
                          <span className="w-14 text-right text-xs text-ios-secondary">{sell > 0 ? `${sell.toFixed(0)}` : '—'}</span>
                          <span className={`w-12 text-right text-xs font-medium ${qty <= 0 ? 'text-amber-600' : 'text-ios-label'}`}>{qty}</span>
                        </div>
                        {poQty > 0 && (
                          <div className="text-[10px] text-blue-600 font-medium text-left mt-0.5">
                            +{poQty}{' '}
                            {poDateLabel ? `${t.arrivesOn || 'arrives'} ${poDateLabel}` : (t.onOrder || 'on order')}
                          </div>
                        )}
                      </button>
                    );
                  })}
                {flowerSearch.length >= 2 && !editing.stockItems.some(s => {
                  const { name } = parseBatchName(s['Display Name'] || '');
                  return name.toLowerCase() === flowerSearch.trim().toLowerCase();
                }) && (
                  <button type="button"
                    onClick={() => editing.openNewFlowerForm(flowerSearch.trim())}
                    className="w-full text-left px-2 py-1.5 text-sm text-brand-600 font-medium border-t border-gray-100"
                  >+ {t.addNewFlower} "{flowerSearch}"</button>
                )}
              </div>
              <button onClick={() => { editing.setAddingFlower(false); editing.setFlowerSearch(''); }}
                className="text-xs text-ios-tertiary">{t.cancel}</button>
            </div>
          )}

          {pickerModalVariety && (
            <BatchPickerModal
              baseName={pickerModalVariety}
              matches={pickerModalMatches}
              pendingPO={editing.pendingPO}
              onSelectStock={s => {
                editing.addFlowerFromStock(s);
                setPickerModalVariety(null);
                editing.setFlowerSearch('');
                editing.setAddingFlower(false);
              }}
              onCreateDemand={() => {
                editing.createDemandEntry(pickerModalVariety);
                setPickerModalVariety(null);
                editing.setFlowerSearch('');
                editing.setAddingFlower(false);
              }}
              onClose={() => setPickerModalVariety(null)}
              t={{
                batchPickerTitle:  t.batchPickerTitle,
                demandEntry:       t.demandEntry,
                demandEntryHint:   t.demandEntryHint,
                demandEntryCreate: t.demandEntryCreate,
                onOrder:           t.onOrder,
                cancel:            t.cancel,
                stems:             t.stems,
              }}
            />
          )}

          {newFlowerForm && (
            <div className="bg-indigo-50 rounded-xl px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-indigo-800">{t.addNewFlower}: {newFlowerForm.name}</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" value={newFlowerForm.costPrice}
                  onChange={e => {
                    const cost = e.target.value;
                    editing.setNewFlowerForm(p => ({
                      ...p, costPrice: cost,
                      sellPrice: cost && targetMarkup ? String(Math.round(Number(cost) * targetMarkup)) : p.sellPrice,
                    }));
                  }}
                  placeholder={t.costPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                <input type="number" step="0.01" value={newFlowerForm.sellPrice}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, sellPrice: e.target.value }))}
                  placeholder={t.sellPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={newFlowerForm.lotSize}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, lotSize: e.target.value }))}
                  placeholder={t.lotSize} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                <input type="text" value={newFlowerForm.supplier}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, supplier: e.target.value }))}
                  placeholder={t.supplier} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => editing.addNewFlower()}
                  className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t.addToCart}</button>
                <button type="button" onClick={() => editing.setNewFlowerForm(null)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm">{t.cancel}</button>
              </div>
            </div>
          )}

          {removeDialogIdx != null && (
            <div className={`${removeDialogIsNegativeStock ? 'bg-blue-50' : 'bg-amber-50'} rounded-xl px-4 py-3 space-y-2`}>
              <p className={`text-sm font-medium ${removeDialogIsNegativeStock ? 'text-blue-800' : 'text-amber-800'}`}>
                {removeDialogLine?.flowerName}: {removeDialogIsNegativeStock ? t.notReceivedYet : t.returnOrWriteOff}
              </p>
              <div className="flex gap-2">
                <button onClick={() => editing.confirmRemoveLine('return')}
                  className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium">{t.returnToStock}</button>
                {removeDialogIsNegativeStock ? (
                  <button onClick={() => { editing.confirmRemoveLine('return'); /* toast handled by parent */ }}
                    className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium">{t.adjustPO}</button>
                ) : (
                  <button onClick={() => editing.confirmRemoveLine('writeoff')}
                    className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium">{t.writeOff}</button>
                )}
              </div>
              <button onClick={() => editing.setRemoveDialogIdx(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
            </div>
          )}

          {stockAction === 'pending' && (() => {
            const reduced = editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
            const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
            return totalReduced > 0 ? (
              <div className="bg-amber-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">{t.spareFlowersQuestion}</p>
                <div className="flex gap-2">
                  <button onClick={() => doSave('return')}
                    className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium">{t.returnToStock}</button>
                  <button onClick={() => doSave('writeoff')}
                    className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium">{t.writeOff}</button>
                </div>
                <button onClick={() => editing.setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
              </div>
            ) : null;
          })()}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                if (editing.hasReductions && stockAction !== 'pending') {
                  editing.setStockAction('pending');
                  return;
                }
                doSave(null);
              }}
              disabled={saving || editing.saving}
              className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
            >{saving || editing.saving ? '...' : t.saveBouquet}</button>
            <button onClick={() => editing.cancelEditing()}
              className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm">{t.cancel}</button>
          </div>
        </div>
        );
      })()
      : (
        <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ios-tertiary border-b border-gray-100 bg-gray-50">
                <th className="text-left px-3 py-2 font-medium">{t.flowers}</th>
                <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                <th className="text-right px-3 py-2 font-medium">{t.costPrice}</th>
                <th className="text-right px-3 py-2 font-medium">{t.sellPrice}</th>
                <th className="text-right px-3 py-2 font-medium">{t.orderTotal}</th>
              </tr>
            </thead>
            <tbody>
              {o.orderLines.map(line => (
                <tr key={line.id} className="border-b border-gray-50">
                  <td className="px-3 py-2 text-ios-label">{line['Flower Name'] || '—'}</td>
                  <td className="px-3 py-2 text-right">{line.Quantity}</td>
                  <td className="px-3 py-2 text-right text-ios-tertiary">{(line['Cost Price Per Unit'] || 0).toFixed(0)}</td>
                  <td className="px-3 py-2 text-right">{(line['Sell Price Per Unit'] || 0).toFixed(0)}</td>
                  <td className="px-3 py-2 text-right font-medium">{((line['Sell Price Per Unit'] || 0) * (line.Quantity || 0)).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
