// Step2Bouquet — catalog tap-to-add above, cart stepper below.

import { useState, useMemo, useEffect } from 'react';
import client from '../../api/client.js';
import t from '../../translations.js';
import { useToast } from '../../context/ToastContext.jsx';
import useConfigLists from '../../hooks/useConfigLists.js';
import { renderStockName, VarietyAllocationPicker, VarietyAvailabilityLine, useStockYModelFlag, varietyDisplayName, groupByVariety, resolveStockLinePrice, resolveVarietySell, getVarietyAvailability, arrivalsForVariety, allocateLinesAgainstVariety } from '@flower-studio/shared';

const PO_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatPoDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getDate()}.${PO_MONTHS[d.getMonth()]}.`;
}

// Owner-only inline override for cost/sell when a flower is out of stock.
// Onblur commits through the parent's line mutator. Empty draft means "no
// change"; typing and blurring writes the new price to the line snapshot.
function PriceOverride({ line, onCommit }) {
  const [cost, setCost] = useState('');
  const [sell, setSell] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="text-ios-tertiary">{t.overridePrices || 'Update prices'}:</span>
      <label className="flex items-center gap-1">
        <span className="text-ios-tertiary">{t.costPrice || 'Cost'}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={cost !== '' ? cost : (line.costPricePerUnit || '')}
          placeholder="0"
          onChange={e => setCost(e.target.value)}
          onBlur={() => {
            const v = Number(cost);
            if (cost !== '' && !Number.isNaN(v) && v !== Number(line.costPricePerUnit)) {
              onCommit({ costPricePerUnit: v });
            }
            setCost('');
          }}
          className="w-16 text-right border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none"
        />
        <span className="text-ios-tertiary">zł</span>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-ios-tertiary">{t.sellPrice || 'Sell'}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={sell !== '' ? sell : (line.sellPricePerUnit || '')}
          placeholder="0"
          onChange={e => setSell(e.target.value)}
          onBlur={() => {
            const v = Number(sell);
            if (sell !== '' && !Number.isNaN(v) && v !== Number(line.sellPricePerUnit)) {
              onCommit({ sellPricePerUnit: v });
            }
            setSell('');
          }}
          className="w-16 text-right border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none"
        />
        <span className="text-ios-tertiary">zł</span>
      </label>
    </div>
  );
}

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, requiredBy,
  // Premade-bouquet match mode — mirrors the florist app.
  premadeBouquets = null,
  matchPremadeId = null,
  onSelectPremade = null,
  onUnlinkPremade = null,
  // When true, the picker hides any stock item with Current Quantity <= 0,
  // so premade-bouquet composition flows can't accidentally reserve stems
  // that haven't physically arrived yet. Regular new-order flow keeps the
  // current behaviour (shows depleted items for deferred demand).
  onlyPhysicallyAvailable = false,
}) {
  const premadeLocked = !!matchPremadeId;
  const lockedBouquet = premadeLocked && Array.isArray(premadeBouquets)
    ? premadeBouquets.find(b => b.id === matchPremadeId)
    : null;
  const yEnabled = useStockYModelFlag();
  // Determine if the order is for a future date (not today).
  const todayIso = new Date().toISOString().split('T')[0];
  const isFutureOrder = (() => {
    if (!requiredBy) return false;
    return requiredBy > todayIso;
  })();
  const { targetMarkup } = useConfigLists();
  const { showToast } = useToast();
  const [flowerQuery, setFlowerQuery] = useState('');
  const [showCost, setShowCost]       = useState(false);
  const [showCustomFlower, setShowCustomFlower] = useState(false);
  const [customFlower, setCustomFlower] = useState({ name: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
  // Pending purchase orders — drives the "arrives DD.Mmm" badge in the picker
  // so the owner can grab a flower that's on order instead of typing it again
  // and creating a duplicate stock card.
  const [pendingPO, setPendingPO] = useState({});
  const [reservations, setReservations] = useState(new Map());
  useEffect(() => {
    client.get('/stock/pending-po').then(r => setPendingPO(r.data || {})).catch(() => {});
    client.get('/stock/premade-committed').then(r => {
      setReservations(new Map(Object.entries(r.data || {}).map(([id, v]) => [id, v.qty || 0])));
    }).catch(() => {});
  }, []);
  // Y-model picker state — opens when flag-on AND a Variety has >1 Stock Items
  const [yPickerOpen, setYPickerOpen] = useState(false);
  const [yPickerStockItems, setYPickerStockItems] = useState([]);

  // Adapt Airtable-shaped stock rows to snake_case shape expected by varietyKey / VarietyAllocationPicker.
  const adaptedStock = useMemo(() =>
    stock.map(s => ({
      ...s,
      type_name:        s.Type ?? null,
      colour:           s.Colour ?? null,
      size_cm:          s.Size ?? null,
      cultivar:         s.Cultivar ?? null,
      current_quantity: Number(s['Current Quantity']) || 0,
    })),
    [stock]
  );

  // Stable key for lines: stockItemId or flowerName (for unlisted flowers)
  function lineKey(l) { return l.stockItemId || l.flowerName; }
  function matchesKey(l, key) {
    return l.stockItemId === key || (!l.stockItemId && l.flowerName === key);
  }

  // Pending-PO flowers price off their PO, not the stale card sell (#377).
  const costTotal = useMemo(
    () => orderLines.reduce((s, l) => {
      const si = stock.find(x => x.id === l.stockItemId);
      const cost = resolveStockLinePrice(si, pendingPO[l.stockItemId]).costPricePerUnit || Number(l.costPricePerUnit) || 0;
      return s + cost * Number(l.quantity);
    }, 0),
    [orderLines, stock, pendingPO]
  );
  const sellTotal = useMemo(
    () => orderLines.reduce((s, l) => {
      const si = stock.find(x => x.id === l.stockItemId);
      const sell = resolveStockLinePrice(si, pendingPO[l.stockItemId]).sellPricePerUnit || Number(l.sellPricePerUnit) || 0;
      return s + sell * Number(l.quantity);
    }, 0),
    [orderLines, stock, pendingPO]
  );
  const margin = sellTotal > 0 ? Math.round(((sellTotal - costTotal) / sellTotal) * 100) : 0;

  // Hide depleted dated batches (e.g. "Rose Red (14.Mar.)" at qty 0). When
  // onlyPhysicallyAvailable is set (premade compose flow), also hide the base
  // record when its qty is <= 0 — premade stems must exist right now.
  const visibleStock = useMemo(() => {
    const dateBatchPattern = /\(\d{1,2}\.\w{3,4}\.?\)$/;
    return stock.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      const name = s['Display Name'] || '';
      if (onlyPhysicallyAvailable && qty <= 0) return false;
      if (qty <= 0 && dateBatchPattern.test(name)) return false;
      return true;
    });
  }, [stock, onlyPhysicallyAvailable]);

  // Surface a pending PO match for a flower name typed in the custom-flower
  // form so we can offer a 1-tap "use the existing card" path. Matches the
  // catalog's case-insensitive Display Name lookup.
  const customNameMatch = useMemo(() => {
    const needle = customFlower.name.trim().toLowerCase();
    if (!needle) return null;
    return stock.find(s =>
      (s['Display Name'] || '').trim().toLowerCase() === needle
    ) || null;
  }, [stock, customFlower.name]);

  const filteredStock = useMemo(() => {
    if (yEnabled) return visibleStock; // Y-model: filter at group level below
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return visibleStock;
    return visibleStock.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerQuery, yEnabled]);

  // Y-model: group filteredStock by Variety 4-tuple for the catalog list.
  const varGroups = useMemo(() => {
    if (!yEnabled) return [];
    const groups = [...groupByVariety(adaptedStock.filter(a =>
      visibleStock.some(s => s.id === a.id)
    )).values()];
    const q = flowerQuery.toLowerCase().trim();
    const filtered = q
      ? groups.filter(g => varietyDisplayName(g).toLowerCase().includes(q))
      : groups;
    return filtered.map(g => {
      const inCart = g.rows.some(r => orderLines.some(l => l.stockItemId === r.id));
      return {
        key:         g.key,
        displayName: varietyDisplayName(g),
        rows:        g.rows,
        // S3.2-i: one labelled availability model (CR-23/28) — onHand/committed/
        // reserved/net + incoming/effective; the catalog hides effective ≤ 0 (D3).
        availability: getVarietyAvailability(g.rows, reservations, arrivalsForVariety(g.rows, pendingPO, todayIso)),
        // Pending-PO Variety shows its PO sell, not the stale card sell (#377).
        sell:        resolveVarietySell(g.rows, pendingPO),
        inCart,
      };
    })
    // Hide fully-committed Varieties (effective ≤ 0) by default; name search (q)
    // still reaches them (deliberate over-promise → buy signal). Cart items stay.
    .filter(g => !!q || g.inCart || g.availability.effective > 0);
  }, [yEnabled, adaptedStock, visibleStock, flowerQuery, pendingPO, orderLines, reservations, todayIso]);

  // CR-27: cart-line availability is the whole Variety's net, not the single
  // bound sub-row — map every stock row id → its Variety availability.
  const varietyAvailById = useMemo(() => {
    if (!yEnabled) return {};
    const map = {};
    for (const [, group] of groupByVariety(adaptedStock)) {
      const avail = getVarietyAvailability(group.rows, reservations, arrivalsForVariety(group.rows, pendingPO, todayIso));
      for (const r of group.rows) map[r.id] = avail;
    }
    return map;
  }, [yEnabled, adaptedStock, pendingPO, reservations, todayIso]);

  // Net each cart line's available stock against earlier lines of the SAME
  // Variety so two lines of one Variety never both claim the same on-hand stems
  // (the "3 not in stock" double-count). remainingNet[i] = what's left for line
  // i after earlier same-Variety lines took their share.
  const lineNets = useMemo(() => allocateLinesAgainstVariety(orderLines, (l) => {
    if (l.stockDeferred) return null; // future-PO lines don't pull current stock
    const a = yEnabled ? varietyAvailById[l.stockItemId] : null;
    if (a) return { key: a, net: a.net };
    const si = stock.find(s => s.id === l.stockItemId);
    return { key: l.stockItemId ?? l.flowerName, net: Number(si?.['Current Quantity']) || 0 };
  }), [orderLines, varietyAvailById, yEnabled, stock]);

  function addOne(stockItem, amount = 1) {
    const add = Math.max(1, Number(amount) || 1);
    onLinesChange(lines => {
      const exists = lines.find(l => l.stockItemId === stockItem.id);
      if (exists) {
        return lines.map(l =>
          l.stockItemId === stockItem.id ? { ...l, quantity: l.quantity + add } : l
        );
      }
      // Pending-PO flower prices off its PO, not the stale card sell (#377).
      const { costPricePerUnit, sellPricePerUnit } = resolveStockLinePrice(stockItem, pendingPO[stockItem.id]);
      return [...lines, {
        stockItemId:      stockItem.id,
        flowerName:       stockItem['Display Name'],
        quantity:         add,
        costPricePerUnit,
        sellPricePerUnit,
        stockDeferred:    isFutureOrder,
      }];
    });
  }

  function changeQty(key, delta) {
    onLinesChange(lines =>
      lines
        .map(l => matchesKey(l, key) ? { ...l, quantity: l.quantity + delta } : l)
        .filter(l => l.quantity > 0)
    );
  }

  function setQtyDirect(key, value) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    onLinesChange(lines =>
      n === 0
        ? lines.filter(l => !matchesKey(l, key))
        : lines.map(l => matchesKey(l, key) ? { ...l, quantity: n } : l)
    );
  }

  function removeLine(key) {
    onLinesChange(lines => lines.filter(l => !matchesKey(l, key)));
  }

  function toggleDeferred(key) {
    onLinesChange(lines =>
      lines.map(l => matchesKey(l, key) ? { ...l, stockDeferred: !l.stockDeferred } : l)
    );
  }

  // Owner price override for out-of-stock flowers (dashboard is owner-only by
  // PIN gate, so no role check needed here). Mutates the form line; backend
  // cascades the new prices to the Stock row on order submit.
  function commitPrices(key, patch) {
    onLinesChange(lines =>
      lines.map(l => matchesKey(l, key) ? { ...l, ...patch } : l)
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Customer request */}
      <div>
        <p className="ios-label">{t.customerRequest}</p>
        <div className="ios-card px-4 py-3">
          <textarea
            value={customerRequest}
            onChange={e => onChange({ customerRequest: e.target.value })}
            placeholder={t.requestPlaceholder}
            rows={3}
            className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
          />
        </div>
      </div>

      {/* Premade bouquets section — for matching an existing composition to this customer */}
      {Array.isArray(premadeBouquets) && premadeBouquets.length > 0 && !premadeLocked && (
        <div>
          <p className="ios-label">{t.premadeBouquets}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {premadeBouquets.map(b => {
              const price = Math.round(Number(b['Price Override'] || b['Computed Sell Total'] || 0));
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectPremade?.(b)}
                  className="w-full flex items-center px-4 py-3 gap-3 text-left active:bg-pink-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 text-base flex items-center justify-center shrink-0">
                    💐
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ios-label truncate">{b.Name || t.premadeBouquet}</div>
                    <div className="text-xs text-ios-tertiary truncate">{b['Bouquet Summary'] || '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-brand-600">{price} zł</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Locked-to-premade banner */}
      {premadeLocked && (
        <div className="ios-card bg-pink-50 border border-pink-200 px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-pink-100 text-pink-600 text-lg flex items-center justify-center shrink-0">
            💐
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-pink-700 font-semibold uppercase tracking-wide">{t.premadeLocked}</div>
            <div className="text-sm font-semibold text-ios-label truncate">
              {lockedBouquet?.Name || t.premadeBouquet}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUnlinkPremade?.()}
            className="text-pink-700 text-xs font-semibold underline active-scale shrink-0"
          >
            {t.unlinkPremade}
          </button>
        </div>
      )}

      {/* Catalog */}
      {!premadeLocked && (
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="ios-label !px-0 !mb-0">{t.searchFlowers}</p>
          <button onClick={onStockRefresh} className="text-xs text-brand-600 font-medium">
            &#8635; {t.refreshStock}
          </button>
        </div>

        <div className="ios-card flex items-center px-4 gap-3 mb-2">
          <span className="text-ios-tertiary text-sm">&#128269;</span>
          <input
            type="text"
            value={flowerQuery}
            onChange={e => setFlowerQuery(e.target.value)}
            placeholder={t.flowerSearch}
            className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {flowerQuery && (
            <button onClick={() => setFlowerQuery('')} className="text-ios-tertiary text-sm">&#10005;</button>
          )}
        </div>

        <div className="ios-card overflow-hidden divide-y divide-white/40 max-h-64 overflow-y-auto">
          {/* Add unlisted flower option */}
          {flowerQuery.length >= 2 && !stock.some(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase()) && (
            <button
              type="button"
              onClick={() => {
                setShowCustomFlower(true);
                setCustomFlower({ name: flowerQuery, supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
              }}
              className="w-full flex items-center px-4 py-3 gap-3 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
            >
              <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerQuery}"</span>
            </button>
          )}
          {(yEnabled ? varGroups.length === 0 : filteredStock.length === 0) && !showCustomFlower ? (
            <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound}</p>
          ) : yEnabled ? (
            varGroups.map(v => {
              const { key, displayName, availability, sell, inCart } = v;
              const out = availability.net <= 0;
              const hasIncoming = availability.incoming > 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setYPickerStockItems(v.rows); setYPickerOpen(true); }}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors
                              ${hasIncoming ? 'bg-blue-50/60' : out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-white/40'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                        {displayName}
                      </span>
                      <span className="font-bold text-brand-700 text-sm whitespace-nowrap">{sell.toFixed(0)} zł</span>
                    </div>
                    <div className="mt-0.5">
                      <VarietyAvailabilityLine availability={availability} t={t} />
                    </div>
                  </div>
                  {inCart && (
                    <span className="min-w-[24px] h-[24px] px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                      ✓
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            filteredStock.map(s => {
              const qty    = Number(s['Current Quantity']) || 0;
              const inCart = orderLines.find(l => l.stockItemId === s.id);
              const low    = qty > 0 && qty <= (s['Reorder Threshold'] || 5);
              const out    = qty <= 0;
              const poInfo = pendingPO[s.id];
              const poQty  = poInfo?.ordered || 0;
              const poDateLabel = formatPoDate(poInfo?.plannedDate);
              // Pending-PO flowers show their PO price, not the stale card sell (#377).
              const rowPrice = resolveStockLinePrice(s, poInfo);
              const rowSell = rowPrice.sellPricePerUnit || Number(s['Current Sell Price']) || 0;
              const rowCost = rowPrice.costPricePerUnit || Number(s['Current Cost Price']) || 0;

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addOne(s)}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors
                              ${poQty > 0 ? 'bg-blue-50/60' : out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-white/40'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : poQty > 0 ? 'text-blue-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                      {renderStockName(s['Display Name'], s['Last Restocked'])}
                    </div>
                    <div className="text-xs text-ios-tertiary">
                      {rowSell.toFixed(0)} zł sell · {rowCost.toFixed(0)} zł cost · {qty} pcs
                      {low && !out && <span className="text-ios-orange"> · low</span>}
                      {out && !poQty && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
                      {poQty > 0 && (
                        <span className="text-blue-600 font-medium">
                          {' · +'}{poQty}{' '}
                          {poDateLabel ? `${t.arrivesOn || 'arrives'} ${poDateLabel}` : (t.onOrder || 'on order')}
                        </span>
                      )}
                    </div>
                  </div>
                  {inCart && (
                    <span className="min-w-[24px] h-[24px] px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                      {inCart.quantity}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* Custom flower form */}
      {!premadeLocked && showCustomFlower && (
        <div className="ios-card px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-ios-label">{t.addNewFlower || 'Add new flower'}</p>
          <input
            value={customFlower.name}
            onChange={e => setCustomFlower(p => ({ ...p, name: e.target.value }))}
            placeholder={t.flowerName || 'Flower name'}
            className="field-input w-full text-sm"
          />
          {customNameMatch && (() => {
            const matchPo = pendingPO[customNameMatch.id];
            const matchPoLabel = formatPoDate(matchPo?.plannedDate);
            return (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                {t.flowerAlreadyExists || 'Already in stock — pick from the list'}
                {matchPo?.ordered > 0 && (
                  <span> · +{matchPo.ordered}{' '}
                    {matchPoLabel ? `${t.arrivesOn || 'arrives'} ${matchPoLabel}` : (t.onOrder || 'on order')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    addOne(customNameMatch);
                    setShowCustomFlower(false);
                    setFlowerQuery('');
                  }}
                  className="ml-2 underline font-semibold"
                >
                  {t.addToCart || 'Add to bouquet'}
                </button>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-2">
            <input value={customFlower.supplier} onChange={e => setCustomFlower(p => ({ ...p, supplier: e.target.value }))}
              placeholder={t.supplier || 'Supplier'} className="field-input text-sm" />
            <input type="number" value={customFlower.lotSize} onChange={e => setCustomFlower(p => ({ ...p, lotSize: e.target.value }))}
              placeholder={t.lotSize || 'Lot size'} className="field-input text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={customFlower.costPrice} onChange={e => {
                const cost = e.target.value;
                setCustomFlower(p => ({
                  ...p, costPrice: cost,
                  sellPrice: cost && targetMarkup ? String(Math.round(Number(cost) * targetMarkup)) : p.sellPrice,
                }));
              }}
              placeholder={`${t.costPrice} (zł)`} className="field-input text-sm" />
            <input type="number" value={customFlower.sellPrice} onChange={e => setCustomFlower(p => ({ ...p, sellPrice: e.target.value }))}
              placeholder={`${t.sellPrice} (zł)`} className="field-input text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!!customNameMatch} onClick={async () => {
                if (!customFlower.name.trim()) return;
                // Block duplicate creation: if a stock item with this name already
                // exists, add it from the catalog instead of POSTing a duplicate.
                // This is what gets typed wrong (sell entered into the cost field)
                // and corrupts the bouquet's snapshotted prices.
                if (customNameMatch) {
                  showToast(t.flowerAlreadyExists || 'Flower already in stock — pick from the list', 'error');
                  addOne(customNameMatch);
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  return;
                }
                try {
                  const res = await client.post('/stock', {
                    displayName: customFlower.name.trim(),
                    supplier: customFlower.supplier || '',
                    costPrice: Number(customFlower.costPrice) || 0,
                    sellPrice: Number(customFlower.sellPrice) || 0,
                    lotSize: Number(customFlower.lotSize) || 1,
                    quantity: 0,
                  });
                  const newItem = res.data;
                  addOne({ id: newItem.id, 'Display Name': newItem['Display Name'],
                    'Current Cost Price': newItem['Current Cost Price'] || 0,
                    'Current Sell Price': newItem['Current Sell Price'] || 0 });
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  onStockRefresh();
                } catch (err) {
                  // Show error — do NOT fall back to a stockItemId-less line.
                  // Every flower in an order must have a stock record so demand,
                  // PO generation, and stock deduction stay consistent.
                  const msg = err.response?.data?.error || t.error;
                  showToast(msg, 'error');
                }
              }}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
            >{t.addToCart || 'Add to bouquet'}</button>
            <button type="button" onClick={() => setShowCustomFlower(false)}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm"
            >{t.cancel}</button>
          </div>
        </div>
      )}

      {/* Cart */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {premadeLocked && orderLines.map(l => (
              <div key={lineKey(l)} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-ios-label truncate">
                  {Number(l.quantity)}× {l.flowerName}
                </span>
                <span className="text-xs text-ios-tertiary shrink-0">
                  {Number(l.sellPricePerUnit).toFixed(0)} × {Number(l.quantity)} = {(Number(l.sellPricePerUnit) * Number(l.quantity)).toFixed(0)} zł
                </span>
              </div>
            ))}
            {!premadeLocked && orderLines.map((l, idx) => {
              const key = lineKey(l);
              const stockItem = stock.find(s => s.id === l.stockItemId);
              // CR-27: whole-Variety net under Y-model, not the single bound row.
              const lineVarietyAvail = yEnabled ? varietyAvailById[l.stockItemId] : null;
              // ...further reduced by earlier same-Variety lines so two lines of
              // one Variety never double-count the same on-hand stems.
              const availableQty = lineNets[idx];
              const overStock = l.stockItemId && !l.stockDeferred && l.quantity > availableQty;
              // Pending-PO flowers price off their PO, not the stale card sell (#377).
              const sellPrice = resolveStockLinePrice(stockItem, pendingPO[l.stockItemId]).sellPricePerUnit
                || Number(l.sellPricePerUnit) || 0;
              const lineSell  = sellPrice * Number(l.quantity);
              return (
              <div key={key} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
                      {!l.stockItemId && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-600">NEW</span>
                      )}
                      {isFutureOrder && (
                        <button type="button" onClick={() => toggleDeferred(key)}
                          className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
                            l.stockDeferred ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                          }`}
                        >{l.stockDeferred ? (t.orderNew || 'New') : (t.useStock || 'Stock')}</button>
                      )}
                    </div>
                    <div className="text-xs text-ios-tertiary">
                      {sellPrice.toFixed(0)} zł × {l.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => changeQty(key, -1)}
                      className="w-8 h-8 rounded-full bg-white/60 text-ios-secondary text-xl font-bold flex items-center justify-center active:bg-white"
                    >−</button>
                    <input type="text" inputMode="numeric" pattern="[0-9]*"
                      value={l.quantity} onChange={e => setQtyDirect(key, e.target.value)}
                      onFocus={e => e.target.select()}
                      className="w-9 text-center text-sm font-bold border border-white/50 rounded-xl py-1 bg-white/40 outline-none"
                    />
                    <button onClick={() => changeQty(key, +1)}
                      className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold flex items-center justify-center active:bg-brand-200"
                    >+</button>
                    <button onClick={() => removeLine(key)}
                            className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
                      &#10005;
                    </button>
                  </div>
                </div>
                {overStock && (() => {
                  const linePoQty = lineVarietyAvail
                    ? (lineVarietyAvail.incoming || 0)
                    : (l.stockItemId ? (pendingPO?.[l.stockItemId]?.ordered || 0) : 0);
                  return (
                    <div className={`mt-1 text-xs rounded-lg px-2 py-1 ${linePoQty > 0 ? 'text-blue-700 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
                      {l.quantity - availableQty} {t.notInStock || 'not in stock'}
                      {linePoQty > 0 && <span> · +{linePoQty} {t.onOrder || 'on order'}</span>}
                    </div>
                  );
                })()}
                {/* Owner price override — only for flowers currently out of
                    stock. In-stock items were priced at what we actually paid,
                    so no override needed. Inputs cascade to the Stock row on
                    order submit, which in turn cascades to premade bouquets. */}
                {l.stockItemId && availableQty <= 0 && (
                  <PriceOverride
                    line={l}
                    onCommit={(patch) => commitPrices(key, patch)}
                  />
                )}
              </div>
              );
            })}
          </div>

          {/* Totals */}
          <button
            key={`totals-${costTotal}-${sellTotal}`}
            type="button"
            onClick={() => setShowCost(v => !v)}
            className="w-full mt-2 ios-card px-4 py-3 text-left transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-ios-label font-semibold">{t.sellTotal}</span>
              <span className="text-base font-bold text-brand-600">{sellTotal.toFixed(0)} zł</span>
            </div>
            {showCost && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/40">
                <span className="text-xs text-ios-tertiary">{t.costTotal}: (Margin: {margin}%)</span>
                <span className="text-xs text-ios-tertiary font-medium">{costTotal.toFixed(0)} zł</span>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Price override */}
      <div>
        <p className="ios-label">{t.priceOverride}</p>
        <div className="ios-card flex items-center px-4">
          <input
            type="number"
            // CR-29: pre-fill the fixed price with the live sell total so the
            // owner SEES (and the order keeps) that total when she doesn't set a
            // custom one. State stays empty until she types — clearing reverts to
            // the suggestion, and the value tracks line edits while untouched.
            // (Submit sends null when blank; the backend already falls back to
            // the computed flower total — orderRepo finalPriceAtCreate.)
            value={priceOverride !== '' ? priceOverride : (sellTotal > 0 ? String(Math.round(sellTotal)) : '')}
            onChange={e => onChange({ priceOverride: e.target.value })}
            onFocus={e => e.target.select()}
            placeholder={sellTotal > 0 ? String(Math.round(sellTotal)) : '0'}
            className="flex-1 py-3.5 text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          <span className="text-ios-tertiary text-sm shrink-0 pr-1">zł</span>
        </div>
      </div>

      {/* Y-model picker — only when flag-on AND user tapped a multi-batch variety */}
      {yEnabled && yPickerOpen && (
        <VarietyAllocationPicker
          stockItems={yPickerStockItems}
          reservations={reservations}
          pendingPO={pendingPO}
          requiredBy={requiredBy || null}
          qty={1}
          role="owner"
          todayIso={todayIso}
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
          onSelectStock={async (picked, amount = 1, opts) => {
            const add = Math.max(1, Number(amount) || 1);
            if (picked?.kind === 'fresh') {
              const v = picked.variety || {};
              const displayName = varietyDisplayName(v) || yPickerStockItems[0]?.['Display Name'] || picked.date || '';
              try {
                const res = await client.post('/stock', {
                  displayName,
                  typeName: v.type_name ?? null, colour: v.colour ?? null,
                  sizeCm: v.size_cm ?? null, cultivar: v.cultivar ?? null,
                  costPrice: opts?.costPrice ?? 0, sellPrice: opts?.sellPrice ?? 0, quantity: 0,
                });
                onStockRefresh?.();
                addOne({ id: res.data.id, 'Display Name': res.data['Display Name'],
                         'Current Cost Price': opts?.costPrice ?? 0, 'Current Sell Price': opts?.sellPrice ?? 0 }, add);
              } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
              setYPickerOpen(false); setFlowerQuery(''); return;
            }
            if (picked) {
              const original = stock.find(s => s.id === picked.id) || picked;
              addOne(original, add);
            }
            setYPickerOpen(false);
            setFlowerQuery('');
          }}
          onCreateVariety={async draft => {
            const displayName = (draft.baseName || varietyDisplayName(draft) || '').trim();
            try {
              const res = await client.post('/stock', {
                displayName,
                typeName: draft.type_name ?? null,
                colour:   draft.colour ?? null,
                sizeCm:   draft.size_cm ?? null,
                cultivar: draft.cultivar ?? null,
                costPrice: 0, sellPrice: 0, quantity: 0,
              });
              const newItem = res.data;
              addOne({ id: newItem.id, 'Display Name': newItem['Display Name'], 'Current Cost Price': 0, 'Current Sell Price': 0 });
              onStockRefresh();
            } catch (err) {
              showToast(err.response?.data?.error || t.error, 'error');
            }
            setYPickerOpen(false);
            return null;
          }}
          onClose={() => setYPickerOpen(false)}
        />
      )}
    </div>
  );
}
