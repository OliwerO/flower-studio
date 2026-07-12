import { useState, useMemo } from 'react';
import t from '../../translations.js';
import {
  parseBatchName,
  VarietyAllocationPicker, TierSwitchChip, useAuth,
  groupByVariety, varietyDisplayName, resolveVarietySell,
  shouldShowBouquetSection, NewVarietyFields, isStockItemAvailable,
} from '@flower-studio/shared';

const PO_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatPoDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getDate()}.${PO_MONTHS[d.getMonth()]}.`;
}

export default function BouquetSection({ order, editing, isTerminal, saving, targetMarkup, doSave }) {
  const { role } = useAuth();

  const o = order;
  // Y-model picker state: show VarietyAllocationPicker.
  const [yPickerOpen, setYPickerOpen] = useState(false);
  const [yPickerQty, setYPickerQty] = useState(1);
  const [yPickerStockItems, setYPickerStockItems] = useState([]);

  // Group the search-filtered stock by Variety 4-tuple.
  // `editing.flowerSearch` is the hook-owned search state — destructuring it as
  // a local would only work inside the editing-mode IIFE further down.
  const varGroups = useMemo(() => {
    const raw = editing.getFilteredStock(editing.flowerSearch);
    const adapted = raw.map(s => ({
      ...s,
      type_name: s.Type ?? null,
      colour:    s.Colour ?? null,
      size_cm:   s.Size ?? null,
      cultivar:  s.Cultivar ?? null,
      current_quantity: Number(s['Current Quantity']) || 0,
    }));
    return [...groupByVariety(adapted).values()].map(g => ({
      key:         g.key,
      displayName: varietyDisplayName(g),
      type_name:   g.type_name,
      colour:      g.colour,
      size_cm:     g.size_cm,
      cultivar:    g.cultivar,
      rows:        g.rows,
      totalQty:    g.rows.reduce((s, r) => s + (r.current_quantity || 0), 0),
      // Pending-PO Variety shows its PO sell, not the stale card sell (#377).
      sell:        resolveVarietySell(g.rows, editing.pendingPO),
      cost:        Number(g.rows[0]?.['Current Cost Price']) || 0,
      poQty:       g.rows.reduce((s, r) => s + (editing.pendingPO?.[r.id]?.ordered || 0), 0),
      poDate:      g.rows.map(r => editing.pendingPO?.[r.id]?.plannedDate).find(Boolean) ?? null,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.stockItems, editing.pendingPO, editing.flowerSearch]);

  // Dashboard is owner-only and edits in every status → always render, so an
  // emptied order keeps its "Edit Bouquet" entry point (Pitfall #4).
  if (!shouldShowBouquetSection({ hasLines: o.orderLines?.length > 0, isTerminal, isOwner: true })) return null;

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
            const lineCap = editing.getLineCap(line);
            const atCap = Number(line.quantity || 0) >= lineCap;
            return (
            <div key={line.id || idx} className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ios-label truncate block">
                    {parsedName}
                    {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                  </span>
                  <span className="text-xs text-ios-tertiary inline-flex items-baseline gap-1">
                    <TierSwitchChip
                      currentSell={Number(line.sellPricePerUnit || 0)}
                      tiers={editing.getLineTiers(line)}
                      onPick={(stockId) => editing.switchLineTier(idx, stockId)}
                      t={{ ...t, currency: t.zl }}
                    />
                    <span>× {line.quantity} =</span>
                    <strong className="text-brand-700">{lineSell.toFixed(0)} {t.zl}</strong>
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
                    disabled={atCap}
                    className={`w-7 h-7 rounded-full text-lg font-bold flex items-center justify-center ${
                      atCap ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-brand-100 text-brand-700'
                    }`}>+</button>
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
              {/* Grid: Type | Colour | Size | Cultivar | Tag | Cost | Sell | Qty.
                  Aligned across all rows for at-a-glance scanning (#image 16). */}
              <div className="grid grid-cols-[5rem_5rem_3rem_minmax(0,1fr)_3.5rem_3rem_3rem_2.5rem] gap-2 text-[10px] text-ios-tertiary uppercase tracking-wide px-2 pt-1">
                <span>{t.varietyType ?? 'Type'}</span>
                <span>{t.varietyColour ?? 'Colour'}</span>
                <span>{t.varietySize ?? 'Size'}</span>
                <span>{t.varietyCultivar ?? 'Cultivar'}</span>
                <span className="text-right">{t.batchTag ?? 'Batch'}</span>
                <span className="text-right">{t.costPrice}</span>
                <span className="text-right">{t.sellPrice}</span>
                <span className="text-right">{t.quantity}</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                {varGroups.slice(0, 20).map(v => {
                    const { key, type_name, colour, size_cm, cultivar, totalQty, sell, cost, poQty, poDate } = v;
                    const poDateLabel = formatPoDate(poDate);
                    return (
                      <button key={key} type="button"
                        onClick={() => { setYPickerStockItems(v.rows); setYPickerOpen(true); setYPickerQty(1); }}
                        className={`w-full grid grid-cols-[5rem_5rem_3rem_minmax(0,1fr)_3.5rem_3rem_3rem_2.5rem] gap-2 items-baseline px-2 py-1.5 text-sm hover:bg-gray-50 rounded text-left ${poQty > 0 ? 'bg-blue-50/50' : totalQty <= 0 ? 'bg-amber-50/50' : ''}`}
                      >
                        <span className="text-xs font-semibold text-ios-label truncate">{type_name ?? '—'}</span>
                        <span className="text-xs text-ios-secondary truncate">{colour ?? '—'}</span>
                        <span className="text-xs text-ios-secondary tabular-nums">{size_cm != null ? `${size_cm}cm` : '—'}</span>
                        <span className="text-xs italic text-ios-tertiary truncate">{cultivar ?? '—'}</span>
                        <span className="text-right text-ios-tertiary text-[10px]">
                          {v.rows.length > 1 ? `×${v.rows.length}` : '—'}
                        </span>
                        <span className="text-right text-xs text-ios-tertiary tabular-nums">{cost > 0 ? cost.toFixed(0) : '—'}</span>
                        <span className="text-right text-xs text-ios-secondary tabular-nums">{sell > 0 ? sell.toFixed(0) : '—'}</span>
                        <span className={`text-right text-xs font-medium tabular-nums ${totalQty <= 0 ? 'text-amber-600' : 'text-ios-label'}`}>{totalQty}</span>
                        {poQty > 0 && (
                          <div className="col-span-8 text-[10px] text-blue-600 font-medium mt-0.5">
                            +{poQty}{' '}
                            {poDateLabel ? `${t.arrivesOn || 'arrives'} ${poDateLabel}` : (t.onOrder || 'on order')}
                          </div>
                        )}
                      </button>
                    );
                })}
                {/* Shown when no IN-STOCK (or on-order) flower matches: covers
                    brand-new flowers AND existing-but-out-of-stock ones, so the
                    owner can create a new demand + set its price off the shelf. */}
                {flowerSearch.length >= 2 && !editing.stockItems.some(s => {
                  const { name } = parseBatchName(s['Display Name'] || '');
                  if (name.toLowerCase() !== flowerSearch.trim().toLowerCase()) return false;
                  return isStockItemAvailable(s, editing.pendingPO);
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

          {/* Variety allocation picker — opened when a Variety has multiple batches/sources */}
          {yPickerOpen && (
            <VarietyAllocationPicker
              stockItems={yPickerStockItems}
              reservations={new Map(
                Object.entries(editing.premadeMap || {}).map(([id, v]) => [id, v.qty || 0])
              )}
              pendingPO={editing.pendingPO}
              requiredBy={o['Required By'] || null}
              qty={yPickerQty}
              role={role}
              t={{
                pickerSearchPlaceholder: t.pickerSearchPlaceholder,
                pickerCreateNew:         t.pickerCreateNew,
                pickerNoResults:         t.pickerNoResults,
                pickerSaveContinue:      t.pickerSaveContinue,
                pickerOrderFreshAll:     t.pickerOrderFreshAll,
                stems:                   t.stems,
                cancel:                  t.cancel,
                onHand:                  t.onHand,
                committed:               t.committed,
                reserved:                t.reserved,
                net:                     t.net,
                incoming:                t.incoming,
                effective:               t.effective,
                undatedShort:            t.undatedShort,
                allocSource:             t.allocSource,
                allocQty:                t.allocQty,
                allocRemaining:          t.allocRemaining,
                allocAdd:                t.allocAdd,
                allocSellPrice:          t.allocSellPrice,
                allocCostPrice:          t.allocCostPrice,
                allocShortConfirm:       t.allocShortConfirm,
                allocConfirmYes:         t.allocConfirmYes,
                allocConfirmNo:          t.allocConfirmNo,
                free:                    t.free,
                srcStock:                t.srcStock,
                srcCommitted:            t.srcCommitted,
                srcIncoming:             t.srcIncoming,
                srcFresh:                t.srcFresh,
                currency:                t.currency,
              }}
              onSelectStock={(picked, amount = 1, opts) => {
                const add = Math.max(1, Number(amount) || 1);
                if (picked && picked.kind === 'fresh') {
                  editing.createDemandEntry(picked.variety || picked.displayName || picked.date || '', add, opts);
                } else if (picked) {
                  const existing = editing.editLines.findIndex(l => l.stockItemId === picked.id);
                  if (existing >= 0) {
                    editing.incrementQty(existing, add);
                  } else {
                    editing.addFlowerFromStock(picked, add);
                  }
                }
                setYPickerOpen(false);
                editing.setFlowerSearch('');
                editing.setAddingFlower(false);
              }}
              onCreateVariety={async draft => {
                const res = await editing.addNewVariety(draft);
                setYPickerOpen(false);
                return res;
              }}
              onClose={() => setYPickerOpen(false)}
            />
          )}

          {newFlowerForm && (
            <div className="bg-indigo-50 rounded-xl px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-indigo-800">{t.addNewFlower}: {newFlowerForm.name}</p>
              <NewVarietyFields
                form={newFlowerForm}
                onChange={editing.setNewFlowerForm}
                t={t}
                stockItems={stockItems}
                idPrefix="nv-dash-bq"
              />
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
