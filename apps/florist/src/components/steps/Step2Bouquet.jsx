// Step2Bouquet — catalog tap-to-add above, cart stepper below.
//
// Catalog rows are fully tappable (not just the + button).
// Selected items get a brand tint so you can see at a glance what's in the bouquet.
// Cart lines show only sell-price math. Cost + margin appear in the totals summary.

import { useState, useMemo, useEffect, useRef } from 'react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import t from '../../translations.js';
import useConfigLists from '../../hooks/useConfigLists.js';
import { VarietyAllocationPicker, VarietyAvailabilityLine, varietyDisplayName, groupByVariety, resolveStockLinePrice, resolveVarietySell, getVarietyAvailability, arrivalsForVariety, allocateLinesAgainstVariety, NewVarietyFields, findAllMatchingVariety, parseBatchName } from '@flower-studio/shared';

// Isolated cart row — holds local input state so typing multi-digit numbers
// doesn't re-render the parent and kill focus. Like a sub-assembly station
// that buffers its output before sending it down the line.
// Confidence border colors for AI-matched import lines
const CONFIDENCE_STYLES = {
  high: 'border-l-4 border-l-green-400',
  low:  'border-l-4 border-l-amber-400',
  none: 'border-l-4 border-l-red-300',
};

function CartLine({ line: l, stock, onChangeQty, onCommitQty, onCommitPrices, onRemove, isFutureOrder, onToggleDeferred, pendingPO, isOwner, varietyAvail, siblingNet }) {
  const stockItem = stock.find(s => s.id === l.stockItemId);
  // CR-27: under Y-model, availability is the whole Variety's net (free now), not
  // the single bound sub-row — so binding to a Demand Entry no longer reads as a
  // phantom shortfall while physical batches exist in the same Variety.
  // siblingNet (when provided) is that Variety net already reduced by earlier
  // lines of the same Variety in this bouquet, so two lines never double-count
  // the same on-hand stems.
  const availableQty = siblingNet != null
    ? siblingNet
    : (varietyAvail ? varietyAvail.net : Number(stockItem?.['Current Quantity']) || 0);
  // Pending-PO flowers price off their PO, not the stale card sell (#377).
  const sellPrice = resolveStockLinePrice(stockItem, pendingPO?.[l.stockItemId]).sellPricePerUnit
    || Number(l.sellPricePerUnit) || 0;
  const lineSell  = sellPrice * Number(l.quantity);
  const confidence = l.confidence; // 'high' | 'low' | 'none' | undefined
  // Don't show over-stock warning for deferred lines (they don't pull from inventory)
  const overStock = l.stockItemId && !l.stockDeferred && l.quantity > availableQty;
  // Owner can override cost/sell for flowers that are currently out of stock —
  // the old snapshot reflects the last purchase price, which may be stale.
  // In-stock items are priced at what was actually paid, so no override needed.
  const canOverridePrices = isOwner && l.stockItemId && availableQty <= 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [costDraft, setCostDraft] = useState('');
  const [sellDraft, setSellDraft] = useState('');

  function handleFocus(e) {
    setEditing(true);
    setDraft(String(l.quantity));
    e.target.select();
  }

  function handleBlur() {
    setEditing(false);
    onCommitQty(l.stockItemId || l.flowerName, draft);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  return (
    <div className={`flex flex-col px-4 py-3 ${confidence ? CONFIDENCE_STYLES[confidence] || '' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
            {confidence === 'low' && <span className="text-amber-500 text-xs" title={t.intake?.confidenceLow}>?</span>}
            {confidence === 'none' && <span className="text-red-400 text-xs" title={t.intake?.confidenceNone}>✗</span>}
            {isFutureOrder && (
              <button
                type="button"
                onClick={() => onToggleDeferred(l.stockItemId || l.flowerName)}
                className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  l.stockDeferred
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {l.stockDeferred ? (t.orderNew || 'New') : (t.useStock || 'Stock')}
              </button>
            )}
          </div>
          <div className="text-xs text-ios-tertiary">
            {sellPrice.toFixed(0)} zł × {l.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onChangeQty(l.stockItemId || l.flowerName, -1)}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-xl font-bold
                       flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 active-scale"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={editing ? draft : l.quantity}
            onChange={e => setDraft(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-9 text-center text-sm font-bold border border-gray-200 rounded-xl py-1 bg-white outline-none"
          />
          <button
            onClick={() => onChangeQty(l.stockItemId || l.flowerName, +1)}
            className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                       flex items-center justify-center active:bg-brand-200 active-scale"
          >
            +
          </button>
          <button onClick={() => onRemove(l.stockItemId || l.flowerName)}
                  className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
            ✕
          </button>
        </div>
      </div>
      {overStock && (() => {
        const linePoQty = varietyAvail
          ? (varietyAvail.incoming || 0)
          : (l.stockItemId ? (pendingPO?.[l.stockItemId]?.ordered || 0) : 0);
        return (
          <div className={`mt-1 text-xs rounded-lg px-2 py-1 ${linePoQty > 0 ? 'text-blue-700 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
            {l.quantity - availableQty} {t.notInStock || 'not in stock'}
            {linePoQty > 0 && <span> · +{linePoQty} {t.onOrder || 'on order'}</span>}
          </div>
        );
      })()}
      {canOverridePrices && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-ios-tertiary">{t.overridePrices || 'Update prices'}:</span>
          <label className="flex items-center gap-1">
            <span className="text-ios-tertiary">{t.costPrice || 'Cost'}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={costDraft !== '' ? costDraft : (l.costPricePerUnit || '')}
              placeholder="0"
              onChange={e => setCostDraft(e.target.value)}
              onBlur={() => {
                const v = Number(costDraft);
                if (costDraft !== '' && !Number.isNaN(v) && v !== Number(l.costPricePerUnit)) {
                  onCommitPrices?.(l.stockItemId || l.flowerName, { costPricePerUnit: v });
                }
                setCostDraft('');
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
              value={sellDraft !== '' ? sellDraft : (l.sellPricePerUnit || '')}
              placeholder="0"
              onChange={e => setSellDraft(e.target.value)}
              onBlur={() => {
                const v = Number(sellDraft);
                if (sellDraft !== '' && !Number.isNaN(v) && v !== Number(l.sellPricePerUnit)) {
                  onCommitPrices?.(l.stockItemId || l.flowerName, { sellPricePerUnit: v });
                }
                setSellDraft('');
              }}
              className="w-16 text-right border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none"
            />
            <span className="text-ios-tertiary">zł</span>
          </label>
        </div>
      )}
    </div>
  );
}

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, requiredBy, isOwner,
  // Premade-bouquet match mode (optional — only used inside the new-order wizard).
  // When `premadeBouquets` is an array, a "Готовые букеты" section is rendered
  // above the flower catalog. Tapping one locks the cart to that composition.
  // `matchPremadeId` + `onSelectPremade` + `onUnlinkPremade` manage the lock state.
  premadeBouquets = null,
  matchPremadeId = null,
  onSelectPremade = null,
  onUnlinkPremade = null,
  // When true, hide any stock item with Current Quantity <= 0 from the picker
  // regardless of pending-PO state. Used by the premade-bouquet composition
  // flow where the florist is physically assembling the bouquet right now —
  // she can only pick stems that actually exist, not stems expected from a
  // future PO. Also suppresses the "show out of stock" toggle.
  onlyPhysicallyAvailable = false,
}) {
  const { showToast } = useToast();
  const { role } = useAuth();
  // Determine if the order is for a future date (not today).
  // Future orders allow toggling between "use current stock" and "order new" per line.
  const todayIso = new Date().toISOString().split('T')[0];
  const isFutureOrder = (() => {
    if (!requiredBy) return false;
    return requiredBy > todayIso;
  })();
  const { suppliers: configSuppliers, targetMarkup } = useConfigLists();
  const [flowerQuery, setFlowerQuery] = useState('');
  const [showCost, setShowCost]       = useState(false);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showCustomFlower, setShowCustomFlower] = useState(false);
  const [customFlower, setCustomFlower] = useState({ name: '', typeName: '', colour: '', sizeCm: '', cultivar: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
  const [pendingPO, setPendingPO]     = useState({});
  const [reservations, setReservations] = useState(new Map());
  // Y-model picker state — opens when flag-on AND a Variety has >1 Stock Items
  const [yPickerOpen, setYPickerOpen] = useState(false);
  const [yPickerStockItems, setYPickerStockItems] = useState([]);

  // Adapt Airtable-shaped stock rows to snake_case shape expected by varietyKey / VarietyAllocationPicker.
  // VarietyAllocationPicker expects: { id, type_name, colour, size_cm, cultivar, current_quantity, date }
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

  // Fetch pending PO quantities so florists can see what's coming
  useEffect(() => {
    client.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
    client.get('/stock/premade-committed').then(r => {
      setReservations(new Map(Object.entries(r.data || {}).map(([id, v]) => [id, v.qty || 0])));
    }).catch(() => {});
  }, []);

  // Keep order line price snapshots in sync with current stock prices.
  // When stock data refreshes (e.g. after editing sell price), update the
  // snapshotted prices so the submitted order uses the latest values.
  const stockRef = useRef(stock);
  useEffect(() => {
    if (stock === stockRef.current) return;
    stockRef.current = stock;
    if (orderLines.length === 0 || stock.length === 0) return;
    let changed = false;
    const updated = orderLines.map(l => {
      if (!l.stockItemId) return l;
      const si = stock.find(x => x.id === l.stockItemId);
      if (!si) return l;
      // Keep the pending-PO price for not-yet-arrived flowers; only physical
      // stock re-syncs to the card sell (#377).
      const { costPricePerUnit: newCost, sellPricePerUnit: newSell } =
        resolveStockLinePrice(si, pendingPO[l.stockItemId]);
      if (newCost !== l.costPricePerUnit || newSell !== l.sellPricePerUnit) {
        changed = true;
        return { ...l, costPricePerUnit: newCost, sellPricePerUnit: newSell };
      }
      return l;
    });
    if (changed) onLinesChange(() => updated);
  }, [stock, orderLines, onLinesChange, pendingPO]);

  // Use current stock prices for display totals (snapshot happens at submit).
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

  // Filter stock: hide depleted dated batches (e.g. "Rose Red (14.Mar.)" with qty 0).
  // Show dated batches only when they have stock — useful for choosing which batch to use.
  // Always show the base flower name even at qty 0 (for negative stock / future ordering).
  const visibleStock = useMemo(() => {
    const dateBatchPattern = /\(\d{1,2}\.\w{3,4}\.?\)$/;
    return stock.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      const name = s['Display Name'] || '';
      if (qty <= 0 && dateBatchPattern.test(name)) return false;
      return true;
    });
  }, [stock]);

  const filteredStock = useMemo(() => {
    let result = visibleStock;
    if (onlyPhysicallyAvailable) {
      // Premade-compose mode — only real, countable stems. Pending POs don't
      // count because the florist can't put future flowers into a physical
      // bouquet today.
      result = result.filter(s => (Number(s['Current Quantity']) || 0) > 0);
    } else if (!showOutOfStock) {
      // #39: Filter to show only in-stock items by default,
      // but always show items with pending PO quantities (they're coming).
      // 2026-04: also keep items at NEGATIVE stock — they're implicit demand
      // for the next PO, so the owner should be able to select them when a new
      // order needs more of the same flower. Typing the name manually was
      // producing duplicate Stock rows (especially after the Lot Size field
      // was added). Only qty === 0 with no pending PO is hidden by default.
      result = result.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        const onOrder = pendingPO[s.id]?.ordered || 0;
        return qty !== 0 || onOrder > 0;
      });
    }
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return result;
    return result.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerQuery, showOutOfStock, pendingPO]);

  // Group filteredStock by Variety 4-tuple for the catalog list.
  const varGroups = useMemo(() => {
    const groups = [...groupByVariety(adaptedStock.filter(a =>
      filteredStock.some(s => s.id === a.id)
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
    // Hide fully-committed Varieties (effective ≤ 0) by default; a name search
    // (q) still reaches them so deliberate over-promising creates a buy signal.
    // A Variety already in the cart always stays visible so it can be adjusted.
    .filter(g => !!q || g.inCart || g.availability.effective > 0);
  }, [adaptedStock, filteredStock, flowerQuery, pendingPO, orderLines, reservations, todayIso]);

  // CR-27: a cart line bound to one sub-row (e.g. a −8 Demand Entry) must reflect
  // the WHOLE Variety's availability, not that one row — otherwise it falsely
  // reads "18 not in stock" while a 50-stem batch sits in the same Variety. Map
  // every stock row id → its Variety availability (over ALL varieties, including
  // ones hidden from the catalog).
  const varietyAvailById = useMemo(() => {
    const map = {};
    for (const [, group] of groupByVariety(adaptedStock)) {
      const avail = getVarietyAvailability(group.rows, reservations, arrivalsForVariety(group.rows, pendingPO, todayIso));
      for (const r of group.rows) map[r.id] = avail;
    }
    return map;
  }, [adaptedStock, pendingPO, reservations, todayIso]);

  // Net each cart line's available stock against earlier lines of the SAME
  // Variety so two lines never both claim the same on-hand stems (the "3 not in
  // stock" double-count). Walks orderLines in order; remainingNet[i] is what's
  // left for line i after earlier same-Variety lines took their share.
  const lineNets = useMemo(() => allocateLinesAgainstVariety(orderLines, (l) => {
    if (l.stockDeferred) return null; // future-PO lines don't pull current stock
    const a = varietyAvailById[l.stockItemId];
    if (a) return { key: a, net: a.net };
    const si = stock.find(s => s.id === l.stockItemId);
    return { key: l.stockItemId ?? l.flowerName, net: Number(si?.['Current Quantity']) || 0 };
  }), [orderLines, varietyAvailById, stock]);

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

  // Create a new demand for a flower, reusing an existing Variety when one
  // already exists (in stock OR out of stock) so we never duplicate a flower
  // record. When the owner set a price (> 0) it is persisted onto the reused
  // record and used for the line, so the sell price feeds the bouquet total.
  // A brand-new flower is created at qty 0 with its price. Confirmed behaviour:
  // reuse existing variety + set price.
  async function createOrDeepenDemand({ displayName, variety = {}, costPrice = 0, sellPrice = 0, amount = 1 }) {
    const name = (displayName || '').trim();
    if (!name) return;
    const add  = Math.max(1, Number(amount) || 1);
    const cost = Number(costPrice) || 0;
    const sell = Number(sellPrice) || 0;

    const existing = findAllMatchingVariety(stock, name);
    if (existing.length) {
      // Prefer the undated Demand Entry; else the first matching row.
      const target = existing.find(s => parseBatchName(s['Display Name'] || '').batch === null) || existing[0];
      let item = target;
      const body = {};
      if (sell > 0) body['Current Sell Price'] = sell;
      if (cost > 0) body['Current Cost Price'] = cost;
      if (Object.keys(body).length) {
        try {
          const res = await client.patch(`/stock/${target.id}`, body);
          item = { ...target, ...res.data };
          onStockRefresh?.();
        } catch { /* fall through: still add the line at the entered price */ }
      }
      addOne({
        id: item.id,
        'Display Name': item['Display Name'],
        'Current Cost Price': cost > 0 ? cost : (Number(item['Current Cost Price']) || 0),
        'Current Sell Price': sell > 0 ? sell : (Number(item['Current Sell Price']) || 0),
      }, add);
      return;
    }

    // Brand-new flower → create the Variety (qty 0) carrying its price.
    try {
      const res = await client.post('/stock', {
        displayName: name,
        typeName: (variety.type_name ?? variety.typeName ?? name),
        colour:   variety.colour ?? null,
        sizeCm:   variety.size_cm ?? variety.sizeCm ?? null,
        cultivar: variety.cultivar ?? null,
        costPrice: cost, sellPrice: sell, quantity: 0,
      });
      onStockRefresh?.();
      addOne({ id: res.data.id, 'Display Name': res.data['Display Name'],
               'Current Cost Price': cost, 'Current Sell Price': sell }, add);
    } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
  }

  // lineKey can be stockItemId or flowerName (for unmatched imports)
  function matchesKey(line, key) {
    return line.stockItemId === key || (!line.stockItemId && line.flowerName === key);
  }

  function lineKey(line) {
    return line.stockItemId || line.flowerName;
  }

  function changeQty(key, delta) {
    onLinesChange(lines =>
      lines
        .map(l => matchesKey(l, key)
          ? { ...l, quantity: l.quantity + delta }
          : l
        )
        .filter(l => l.quantity > 0)
    );
  }

  // Commit a typed quantity value — called on blur (not on every keystroke).
  // This lets the florist type multi-digit numbers without losing focus.
  function commitQty(key, value) {
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

  // Owner-only per-line cost/sell override (only exposed for out-of-stock
  // flowers — see CartLine gate). Mutates the form line snapshot; the backend
  // cascades the new prices to the Stock row on order submit.
  function commitPrices(key, patch) {
    onLinesChange(lines =>
      lines.map(l => matchesKey(l, key) ? { ...l, ...patch } : l)
    );
  }

  function toggleDeferred(key) {
    onLinesChange(lines =>
      lines.map(l => matchesKey(l, key) ? { ...l, stockDeferred: !l.stockDeferred } : l)
    );
  }

  // ── Premade bouquet match mode ──
  // `premadeBouquets` list is passed from NewOrderPage when the wizard is
  // opened for a customer. If the owner taps one, the cart becomes read-only
  // and the rest of the wizard submits via POST /api/premade-bouquets/:id/match
  // instead of POST /api/orders.
  const premadeLocked = !!matchPremadeId;
  const lockedBouquet = premadeLocked && Array.isArray(premadeBouquets)
    ? premadeBouquets.find(b => b.id === matchPremadeId)
    : null;

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

      {/* ── Premade bouquets section — available only in match mode ── */}
      {Array.isArray(premadeBouquets) && premadeBouquets.length > 0 && !premadeLocked && (
        <div>
          <p className="ios-label">{t.premadeBouquets}</p>
          <div className="ios-card overflow-hidden divide-y divide-gray-100">
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

      {/* ── Locked-to-premade banner — replaces catalog when a premade is selected ── */}
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

      {/* ── Catalog — tap entire row to add ── */}
      {!premadeLocked && (
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="ios-label !px-0 !mb-0">{t.searchFlowers}</p>
          <div className="flex items-center gap-2">
            {/* "Show out of stock" makes no sense when the picker is locked
                to physically-available stems (premade compose mode). */}
            {!onlyPhysicallyAvailable && (
              <button
                onClick={() => setShowOutOfStock(v => !v)}
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${showOutOfStock ? 'bg-gray-200 text-ios-label' : 'bg-brand-50 text-brand-600'}`}
              >
                {showOutOfStock ? t.showAll : t.inStockOnly}
              </button>
            )}
            <button onClick={() => {
              onStockRefresh();
              client.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
              client.get('/stock/premade-committed').then(r => {
                setReservations(new Map(Object.entries(r.data || {}).map(([id, v]) => [id, v.qty || 0])));
              }).catch(() => {});
            }} className="text-xs text-brand-600 font-medium">
              ↻ {t.refreshStock}
            </button>
          </div>
        </div>

        <div className="ios-card flex items-center px-4 gap-3 mb-2">
          <span className="text-ios-tertiary text-sm">🔍</span>
          <input
            type="text"
            value={flowerQuery}
            onChange={e => setFlowerQuery(e.target.value)}
            placeholder={t.flowerSearch}
            className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {flowerQuery && (
            <button onClick={() => setFlowerQuery('')} className="text-ios-tertiary text-sm">✕</button>
          )}
        </div>

        <div className="ios-card overflow-hidden divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {/* Add unlisted flower — for flowers not yet in the stock catalog.
              Check against filteredStock (not full stock) so out-of-stock flowers
              hidden by the "In stock only" filter still show the "Add new" option. */}
          {flowerQuery.length >= 2 && !filteredStock.some(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase()) && (
            <button
              type="button"
              onClick={() => {
                // Open the price form so the owner can create a NEW DEMAND and
                // set its sell/cost price — for a brand-new flower OR an existing
                // one that's currently out of stock (pre-fill its attrs + price
                // so she can confirm/override). Submitting reuses the existing
                // Variety instead of duplicating it (see createOrDeepenDemand).
                const existing = stock.find(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase());
                setShowCustomFlower(true);
                setCustomFlower(existing ? {
                  name:      existing['Display Name'],
                  typeName:  existing.Type || existing['Display Name'],
                  colour:    existing.Colour || '',
                  sizeCm:    existing.Size != null ? String(existing.Size) : '',
                  cultivar:  existing.Cultivar || '',
                  supplier:  existing.Supplier || '',
                  costPrice: existing['Current Cost Price'] ? String(existing['Current Cost Price']) : '',
                  sellPrice: existing['Current Sell Price'] ? String(existing['Current Sell Price']) : '',
                  lotSize:   '',
                } : { name: flowerQuery, typeName: flowerQuery, colour: '', sizeCm: '', cultivar: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
              }}
              className="w-full flex items-center px-4 py-3 gap-3 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
            >
              <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerQuery}"</span>
            </button>
          )}
          {varGroups.length === 0 && !showCustomFlower ? (
            <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound}</p>
          ) : (
            varGroups.map(v => {
              const { key, displayName, availability, sell, inCart } = v;
              const out = availability.net <= 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setYPickerStockItems(v.rows);
                    setYPickerOpen(true);
                  }}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors active-scale
                              ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-base font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
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
          )}
        </div>
      </div>
      )}

      {/* ── Custom flower form — create new stock item + add to cart ── */}
      {!premadeLocked && showCustomFlower && (
        <div className="ios-card px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-ios-label">{t.addNewFlower || 'Add new flower'}</p>
          <input
            value={customFlower.name}
            onChange={e => setCustomFlower(p => ({ ...p, name: e.target.value }))}
            placeholder={t.flowerName || 'Flower name'}
            className="field-input w-full text-sm"
          />
          <NewVarietyFields
            form={customFlower}
            onChange={setCustomFlower}
            t={t}
            stockItems={stock}
            idPrefix="nv-florist-step2"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={customFlower.supplier}
              onChange={e => setCustomFlower(p => ({ ...p, supplier: e.target.value }))}
              className="field-input text-sm"
            >
              <option value="">{t.supplier || 'Supplier'}...</option>
              {configSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="__other__">{t.otherSupplier || 'Other'}...</option>
            </select>
            {customFlower.supplier === '__other__' && (
              <input
                value={customFlower.customSupplier || ''}
                onChange={e => setCustomFlower(p => ({ ...p, customSupplier: e.target.value }))}
                placeholder={t.supplier || 'Supplier name'}
                className="field-input text-sm col-span-2"
              />
            )}
            <input
              type="number"
              value={customFlower.lotSize}
              onChange={e => setCustomFlower(p => ({ ...p, lotSize: e.target.value }))}
              placeholder={t.lotSize || 'Lot size'}
              className="field-input text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={customFlower.costPrice}
              onChange={e => {
                const cost = e.target.value;
                const updates = { costPrice: cost };
                // #40: Auto-suggest sell price = cost × targetMarkup
                if (cost && targetMarkup && !customFlower.sellPrice) {
                  updates.sellPrice = String(Math.round(Number(cost) * targetMarkup));
                }
                setCustomFlower(p => ({ ...p, ...updates }));
              }}
              placeholder={`${t.costPrice || 'Cost price'} (zł)`}
              className="field-input text-sm"
            />
            <div className="flex flex-col">
              <input
                type="number"
                value={customFlower.sellPrice}
                onChange={e => setCustomFlower(p => ({ ...p, sellPrice: e.target.value }))}
                placeholder={`${t.sellPrice || 'Sell price'} (zł)`}
                className="field-input text-sm"
              />
              {customFlower.costPrice && targetMarkup && !customFlower.sellPrice && (
                <span className="text-[10px] text-ios-tertiary mt-0.5">
                  {t.suggestedSellPrice}: {Math.round(Number(customFlower.costPrice) * targetMarkup)} zł
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!customFlower.name.trim()) return;
                // Block duplicate creation: if a stock item already exists with
                // this name, add it from the catalog instead of POSTing a second
                // record. This prevents the owner from re-typing a flower already
                // on order and accidentally entering a wrong cost/sell.
                const needle = customFlower.name.trim().toLowerCase();
                const dup = stock.find(s => (s['Display Name'] || '').trim().toLowerCase() === needle);
                if (dup) {
                  // Existing flower (likely out of stock) → reuse its record and
                  // create/deepen its demand at the entered price, rather than
                  // POSTing a duplicate. This is the owner's "new demand for an
                  // out-of-stock flower with a price" path.
                  await createOrDeepenDemand({
                    displayName: customFlower.name,
                    costPrice: customFlower.costPrice,
                    sellPrice: customFlower.sellPrice,
                  });
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  return;
                }
                const supplierValue = customFlower.supplier === '__other__'
                  ? (customFlower.customSupplier || '').trim()
                  : customFlower.supplier || '';
                try {
                  // If new supplier entered, persist to settings for future use
                  if (customFlower.supplier === '__other__' && supplierValue && !configSuppliers.some(s => s.toLowerCase() === supplierValue.toLowerCase())) {
                    client.put('/settings/config', { suppliers: [...configSuppliers, supplierValue] }).catch(() => {});
                  }
                  const sizeRaw = customFlower.sizeCm;
                  const res = await client.post('/stock', {
                    displayName: customFlower.name.trim(),
                    // Y-model Variety attrs (pitfall #9): typeName falls back to
                    // the name so it is never blank (NOT NULL on prod).
                    typeName: (customFlower.typeName ?? '').trim() || customFlower.name.trim(),
                    colour: (customFlower.colour ?? '').trim() || null,
                    sizeCm: sizeRaw !== '' && sizeRaw != null ? Number(sizeRaw) : null,
                    cultivar: (customFlower.cultivar ?? '').trim() || null,
                    supplier: supplierValue,
                    costPrice: Number(customFlower.costPrice) || 0,
                    sellPrice: Number(customFlower.sellPrice) || 0,
                    ...(Number(customFlower.lotSize) > 1 ? { lotSize: Number(customFlower.lotSize) } : {}),
                    quantity: 0,
                  });
                  const newItem = res.data;
                  addOne({
                    id: newItem.id,
                    'Display Name': newItem['Display Name'],
                    'Current Cost Price': newItem['Current Cost Price'] || 0,
                    'Current Sell Price': newItem['Current Sell Price'] || 0,
                  });
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  onStockRefresh();
                } catch (err) {
                  // Show error — do NOT fall back to text-only line.
                  // Every flower in an order must have a stock record for stock tracking to work.
                  const msg = err.response?.data?.error || t.error;
                  showToast(msg, 'error');
                }
              }}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
            >
              {t.addToCart || 'Add to bouquet'}
            </button>
            <button
              type="button"
              onClick={() => setShowCustomFlower(false)}
              className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* ── Cart ── */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-gray-100">
            {premadeLocked ? (
              // Read-only view when matching a premade bouquet — don't let the
              // user tweak quantities here, because the composition is locked
              // to whatever the florist already prepared physically.
              orderLines.map(l => (
                <div key={lineKey(l)} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-medium text-ios-label truncate">
                    {Number(l.quantity)}× {l.flowerName}
                  </span>
                  <span className="text-xs text-ios-tertiary shrink-0">
                    {Number(l.sellPricePerUnit).toFixed(0)} × {Number(l.quantity)} = {(Number(l.sellPricePerUnit) * Number(l.quantity)).toFixed(0)} zł
                  </span>
                </div>
              ))
            ) : (
              orderLines.map((l, idx) => (
                <CartLine
                  key={lineKey(l)}
                  line={l}
                  stock={stock}
                  isOwner={isOwner}
                  onChangeQty={(key, delta) => changeQty(key, delta)}
                  onCommitQty={(key, val) => commitQty(key, val)}
                  onCommitPrices={(key, patch) => commitPrices(key, patch)}
                  onRemove={(key) => removeLine(key)}
                  isFutureOrder={isFutureOrder}
                  onToggleDeferred={(key) => toggleDeferred(key)}
                  pendingPO={pendingPO}
                  varietyAvail={varietyAvailById[l.stockItemId]}
                  siblingNet={lineNets[idx]}
                />
              ))
            )}
          </div>

          {/* Totals — tap to toggle cost/margin visibility (owner only) */}
          <button
            key={`totals-${costTotal}-${sellTotal}`}
            type="button"
            onClick={() => isOwner && setShowCost(v => !v)}
            className="w-full mt-2 ios-card px-4 py-3 text-left active-scale transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-ios-label font-semibold">{t.sellTotal}</span>
              <span className="text-base font-bold text-brand-600">{sellTotal.toFixed(0)} zł</span>
            </div>
            {isOwner && showCost && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-100">
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

      {/* Y-model picker — only when user tapped a multi-batch variety */}
      {yPickerOpen && (
        <VarietyAllocationPicker
          stockItems={yPickerStockItems}
          reservations={reservations}
          pendingPO={pendingPO}
          requiredBy={requiredBy || null}
          qty={1}
          role={role}
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
              // Reuse an existing Variety when one already exists (never duplicate
              // the flower record); persist the entered price and add the line.
              await createOrDeepenDemand({
                displayName, variety: v,
                costPrice: opts?.costPrice ?? 0, sellPrice: opts?.sellPrice ?? 0, amount: add,
              });
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
              setYPickerOpen(false);
              return newItem;
            } catch (err) {
              showToast(err.response?.data?.error || t.error, 'error');
              setYPickerOpen(false);
              return null;
            }
          }}
          onClose={() => setYPickerOpen(false)}
        />
      )}
    </div>
  );
}
