import { useState, useMemo } from 'react';
import {
  renderStockName, parseBatchName, findAllMatchingVariety,
  BatchPickerModal, VarietyAllocationPicker, TierSwitchChip, useStockYModelFlag, useAuth,
  groupByVariety, varietyDisplayName, resolveStockLinePrice, resolveVarietySell,
  allocateLinesAgainstVariety, NewVarietyFields,
} from '@flower-studio/shared';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';

export default function BouquetEditor({ editing, saving, detail, isTerminal, isOwner, originalPrice, onSaveClick, doSave }) {
  const yEnabled = useStockYModelFlag();
  const { role } = useAuth();
  const { targetMarkup } = useConfigLists();

  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [pickerModalVariety, setPickerModalVariety] = useState(null);
  const [pickerModalMatches, setPickerModalMatches] = useState([]);
  // Y-model picker state: show VarietyAllocationPicker when yEnabled
  const [yPickerOpen, setYPickerOpen] = useState(false);
  const [yPickerQty, setYPickerQty] = useState(1);
  const [yPickerStockItems, setYPickerStockItems] = useState([]);

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

  // Filter by in-stock toggle (search handled after grouping for Y-model)
  const catalogItems = useMemo(() => {
    if (!showOutOfStock) {
      return visibleStock.filter(s =>
        (Number(s['Current Quantity']) || 0) > 0 || (editing.pendingPO?.[s.id]?.ordered || 0) > 0
      );
    }
    return visibleStock;
  }, [visibleStock, showOutOfStock, editing.pendingPO]);

  // Net each cart line's available stock against earlier lines bound to the SAME
  // stock item, so two lines never both claim the same on-hand stems. lineNets[i]
  // = what's left for line i after earlier same-item lines took their share.
  const lineNets = useMemo(() => allocateLinesAgainstVariety(editing.editLines, (l) => {
    const si = editing.stockItems.find(s => s.id === l.stockItemId);
    return { key: l.stockItemId ?? l.flowerName, net: Number(si?.['Current Quantity']) || 0 };
  }), [editing.editLines, editing.stockItems]);

  // Group catalog: Y-model = one row per Variety 4-tuple; legacy = one row per base name
  const catalogVarieties = useMemo(() => {
    const q = flowerSearch.toLowerCase().trim();
    if (yEnabled) {
      const adapted = catalogItems.map(s => ({
        ...s,
        type_name: s.Type ?? null,
        colour:    s.Colour ?? null,
        size_cm:   s.Size ?? null,
        cultivar:  s.Cultivar ?? null,
        current_quantity: Number(s['Current Quantity']) || 0,
      }));
      const groups = [...groupByVariety(adapted).values()].map(g => ({
        key:         g.key,
        displayName: varietyDisplayName(g),
        type_name:   g.type_name,
        colour:      g.colour,
        size_cm:     g.size_cm,
        cultivar:    g.cultivar,
        rows:        g.rows,
        totalQty:    g.rows.reduce((s, r) => s + (Number(r['Current Quantity']) || 0), 0),
        // Pending-PO Variety shows its PO sell, not the stale card sell (#377).
        sell:        resolveVarietySell(g.rows, editing.pendingPO),
        poQty:       g.rows.reduce((s, r) => s + (editing.pendingPO?.[r.id]?.ordered || 0), 0),
        inCart:      g.rows.some(r => editing.editLines.some(l => l.stockItemId === r.id)),
      }));
      if (!q) return groups;
      return groups.filter(g => g.displayName.toLowerCase().includes(q));
    }
    // Legacy: group by parseBatchName base name
    const map = new Map();
    for (const s of catalogItems) {
      const { name: base } = parseBatchName(s['Display Name'] || '');
      const key = base.toLowerCase();
      if (!q || key.includes(q) || (s['Category'] || '').toLowerCase().includes(q)) {
        if (!map.has(key)) {
          map.set(key, { key, displayName: base, totalQty: 0, sell: Number(s['Current Sell Price']) || 0, poQty: 0, inCart: false, rows: [] });
        }
        const entry = map.get(key);
        entry.totalQty += Number(s['Current Quantity']) || 0;
        entry.poQty += editing.pendingPO?.[s.id]?.ordered || 0;
        if (editing.editLines.find(l => l.stockItemId === s.id)) entry.inCart = true;
        entry.rows.push(s);
      }
    }
    // Pending-PO Variety shows its PO sell, not the stale card sell (#377).
    return [...map.values()].map(e => ({ ...e, sell: resolveVarietySell(e.rows, editing.pendingPO) }));
  }, [catalogItems, flowerSearch, yEnabled, editing.pendingPO, editing.editLines]);

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
        {(!isTerminal || isOwner) && !editing.editingBouquet && (
          <button onClick={() => editing.startEditing(detail.orderLines || [])}
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
              {/* Add unlisted flower option — opens full price form (cost + sell) */}
              {flowerSearch.length >= 2 && !editing.stockItems.some(s => {
                const { name } = parseBatchName(s['Display Name'] || '');
                return name.toLowerCase() === flowerSearch.trim().toLowerCase();
              }) && (
                <button
                  type="button"
                  onClick={() => editing.openNewFlowerForm(flowerSearch.trim())}
                  className="w-full flex items-center px-3 py-2.5 gap-2 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
                >
                  <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerSearch}"</span>
                </button>
              )}
              {catalogVarieties.length === 0 ? (
                <p className="text-ios-tertiary text-sm text-center py-6">{t.noStockFound || 'No items found'}</p>
              ) : (
                catalogVarieties.map((v) => {
                  const { key, displayName, totalQty, sell, poQty, inCart } = v;
                  const low = totalQty > 0 && totalQty <= 5;
                  const out = totalQty <= 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (yEnabled) {
                          setYPickerStockItems(v.rows);
                          setYPickerOpen(true);
                          setYPickerQty(1);
                        } else {
                          const allMatches = findAllMatchingVariety(editing.stockItems, displayName);
                          setPickerModalVariety(displayName);
                          setPickerModalMatches(allMatches);
                        }
                      }}
                      className={`w-full flex items-center px-3 py-2.5 gap-2 text-left transition-colors active-scale
                                  ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                          {displayName}
                        </div>
                        <div className="text-xs text-ios-tertiary">
                          <span className="font-bold text-brand-700">{sell.toFixed(0)} zł</span>
                          <span> · {totalQty} pcs</span>
                          {low && !out && <span className="text-ios-orange"> · low</span>}
                          {out && !poQty && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
                          {poQty > 0 && <span className="text-blue-600 font-medium"> · +{poQty} {t.onOrder || 'on order'}</span>}
                        </div>
                      </div>
                      {inCart && (
                        <span className="min-w-[22px] h-[22px] px-1 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* New flower form — cost + sell price inputs, shown after openNewFlowerForm() */}
          {editing.newFlowerForm && (
            <div className="bg-indigo-50 rounded-xl px-3 py-3 space-y-2">
              <p className="text-sm font-semibold text-indigo-800">{t.addNewFlower}: {editing.newFlowerForm.name}</p>
              {yEnabled && (
                <NewVarietyFields
                  form={editing.newFlowerForm}
                  onChange={editing.setNewFlowerForm}
                  t={t}
                  stockItems={editing.stockItems}
                  idPrefix="nv-florist"
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={editing.newFlowerForm.costPrice}
                  onChange={e => {
                    const cost = e.target.value;
                    editing.setNewFlowerForm(p => ({
                      ...p,
                      costPrice: cost,
                      // Auto-suggest sell price from cost × targetMarkup if sell is still empty
                      sellPrice: cost && targetMarkup && !p.sellPrice
                        ? String(Math.round(Number(cost) * targetMarkup))
                        : p.sellPrice,
                    }));
                  }}
                  placeholder={t.costPrice}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                />
                <input
                  type="number"
                  step="0.01"
                  value={editing.newFlowerForm.sellPrice}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, sellPrice: e.target.value }))}
                  placeholder={t.sellPrice}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={editing.newFlowerForm.lotSize}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, lotSize: e.target.value }))}
                  placeholder={t.lotSize}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                />
                <input
                  type="text"
                  value={editing.newFlowerForm.supplier}
                  onChange={e => editing.setNewFlowerForm(p => ({ ...p, supplier: e.target.value }))}
                  placeholder={t.supplier}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => editing.addNewFlower()}
                  className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
                >{t.addToCart}</button>
                <button
                  type="button"
                  onClick={() => editing.setNewFlowerForm(null)}
                  className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm active-scale"
                >{t.cancel}</button>
              </div>
            </div>
          )}

          {/* Cart — current bouquet lines with steppers */}
          {editing.editLines.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 px-1">{t.bouquetContents || 'Bouquet'}</p>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
                {editing.editLines.map((line, idx) => {
                  const si = editing.stockItems.find(s => s.id === line.stockItemId);
                  const availableQty = lineNets[idx]; // sibling-netted (see lineNets memo)
                  // Pending-PO flowers price off their PO, not the stale card sell (#377).
                  const liveSell = resolveStockLinePrice(si, editing.pendingPO?.[line.stockItemId]).sellPricePerUnit
                    || Number(line.sellPricePerUnit) || 0;
                  const lineSell = liveSell * Number(line.quantity || 0);
                  const overStock = line.stockItemId && line.quantity > availableQty;
                  const linePoQty = line.stockItemId ? (editing.pendingPO?.[line.stockItemId]?.ordered || 0) : 0;
                  const lineCap = editing.getLineCap(line);
                  const atCap = Number(line.quantity || 0) >= lineCap;
                  return (
                    <div key={line.id || idx} className="flex flex-col px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-ios-label truncate block">{line.flowerName}</span>
                          <span className="text-xs text-ios-tertiary inline-flex items-baseline gap-1">
                            {yEnabled
                              ? <TierSwitchChip
                                  currentSell={liveSell}
                                  tiers={editing.getLineTiers(line)}
                                  onPick={(stockId) => editing.switchLineTier(idx, stockId)}
                                  t={t}
                                />
                              : <span>{liveSell.toFixed(0)} zł</span>}
                            <span>× {line.quantity} =</span>
                            <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
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
                            disabled={atCap}
                            className={`w-7 h-7 rounded-full text-lg font-bold flex items-center justify-center active-scale ${
                              atCap ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-brand-100 text-brand-700'
                            }`}
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

          {/* Legacy picker — only rendered when flag is off (Pitfall #4: never gate out valid paths) */}
          {!yEnabled && pickerModalVariety && (
            <BatchPickerModal
              baseName={pickerModalVariety}
              matches={pickerModalMatches}
              pendingPO={editing.pendingPO}
              onSelectStock={s => {
                const existing = editing.editLines.findIndex(l => l.stockItemId === s.id);
                if (existing >= 0) {
                  editing.incrementQty(existing);
                } else {
                  editing.addFlowerFromStock(s);
                }
                setPickerModalVariety(null);
                setFlowerSearch('');
              }}
              onCreateDemand={() => {
                editing.createDemandEntry(pickerModalVariety);
                setPickerModalVariety(null);
                setFlowerSearch('');
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

          {/* Y-model picker — only rendered when flag is on */}
          {yEnabled && yPickerOpen && (
            <VarietyAllocationPicker
              stockItems={yPickerStockItems}
              reservations={new Map(
                Object.entries(editing.premadeMap || {}).map(([id, v]) => [id, v.qty || 0])
              )}
              pendingPO={editing.pendingPO}
              requiredBy={detail['Required By'] || null}
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
                setFlowerSearch('');
              }}
              onCreateVariety={async draft => {
                const res = await editing.addNewVariety(draft);
                setYPickerOpen(false);
                return res;
              }}
              onClose={() => setYPickerOpen(false)}
            />
          )}

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
      ) : !(detail.orderLines?.length > 0) ? (
        <div className="bg-gray-50 rounded-xl px-3 py-4 text-center text-sm text-ios-tertiary">
          {t.bouquetEmpty}
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
