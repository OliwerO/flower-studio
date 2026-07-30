import { useMemo, useState } from 'react';
import NewVarietyFields from './NewVarietyFields.jsx';
import StockSearchInput from './StockSearchInput.jsx';
import {
  resolveVarietyLink,
  derivePackages,
  stemsFromPackages,
} from '../utils/poLineVariety.js';

/**
 * PoLineForm — the single Stock Order line editor, used by every surface that
 * enters or edits a line (plan 2026-07-29, D8).
 *
 * It replaces four forms that had drifted apart: the new-order rows, the saved
 * Draft line editor, the add-line form on a Sent order, and the off-plan form
 * on the shopping-supervision screen. Those differed in which fields they
 * showed — one had Packages, one had no flower picker at all, none showed a
 * Variety on a line that was linked to a Stock Item.
 *
 * Two behaviours are load-bearing:
 *
 *   Variety block is ALWAYS visible (ADR-0014). Picking a flower fills
 *   Type/Colour/Size/Cultivar from its card instead of hiding them. Editing any
 *   attr re-resolves the link: a match re-links, no match detaches. A line must
 *   never stay linked to a card whose Variety differs from what it displays —
 *   evaluation skips attrs on a linked line, so that would receive stems into
 *   the wrong card (#558).
 *
 *   Packages is derived, never stored (D1). `qty` (stems) is the stored
 *   quantity. Editing Packages sets stems; editing stems lets Packages show a
 *   fraction rather than rounding the Owner's number.
 *
 * Canonical line shape — hosts adapt their own state to this:
 *   { flowerName, stockItemId, supplier, farmer, notes,
 *     lotSize, qty, costPerStem, sellPerStem,
 *     type, colour, size, cultivar }
 *
 * @param {object}   value        The line, in the canonical shape above.
 * @param {function} onChange     (patch) => void. Called with a partial line.
 * @param {Array}    stock        Loaded stock wire rows (search + re-resolution).
 * @param {Array}    suppliers    Supplier names for the datalist.
 * @param {number}   targetMarkup Suggests a sell price when a card has cost only.
 * @param {object}   t            Translations.
 * @param {'draft'|'sent'|'shopping'} mode  Toggles OPTIONAL FIELD VISIBILITY only —
 *                                never layout, never the quantity math.
 * @param {string}   idPrefix     Unique prefix for datalist ids on the page.
 */
export default function PoLineForm({
  value,
  onChange,
  stock = [],
  suppliers = [],
  targetMarkup = 0,
  t = {},
  mode = 'draft',
  idPrefix = 'po-line',
}) {
  const lotSize   = Number(value.lotSize) || 0;
  const stems     = Number(value.qty) || 0;
  const cost      = Number(value.costPerStem) || 0;
  const sell      = Number(value.sellPerStem) || 0;
  const packages  = derivePackages(stems, lotSize);
  const totalCost = stems * cost;
  const markup    = cost > 0 && sell > 0 ? (sell / cost).toFixed(1) : null;

  const linked = !!value.stockItemId;
  const hasType = !!String(value.type || '').trim();

  // The two apps shape their Stock Order strings differently — the florist app
  // nests them under `t.po` / `t.shopping`, the dashboard keeps them flat. Read
  // both rather than forcing a translations refactor into this change.
  const tx = (key, fallback) => t.po?.[key] ?? t.shopping?.[key] ?? t[key] ?? fallback;

  // Size suggestions are Variety-aware: once a Type is chosen, offer the sizes
  // actually stocked for it. This is the "choose a size or keep the one from
  // the card" path — picking an existing size re-links rather than creating.
  const sizeOptions = useMemo(() => {
    const wantType = String(value.type || '').trim().toLowerCase();
    const out = new Set();
    for (const s of stock) {
      const ty = String(s.Type ?? s.type_name ?? '').trim().toLowerCase();
      if (wantType && ty !== wantType) continue;
      const size = s.Size ?? s.size_cm;
      if (size != null && size !== '') out.add(String(size));
    }
    return [...out].sort((a, b) => Number(a) - Number(b));
  }, [stock, value.type]);

  // Picking from the search adopts the card's Variety attrs too — the whole
  // point of the change. Previously this cleared them and hid the block.
  function handleStockSelect(item) {
    const itemCost = Number(item['Current Cost Price']) || 0;
    const itemSell = Number(item['Current Sell Price']) || 0;
    const itemLot  = Number(item['Lot Size']) || 0;
    onChange({
      stockItemId: item.id,
      flowerName:  item['Display Name'] || '',
      type:        item.Type ?? item.type_name ?? '',
      colour:      item.Colour ?? item.colour ?? '',
      size:        (item.Size ?? item.size_cm) != null ? String(item.Size ?? item.size_cm) : '',
      cultivar:    item.Cultivar ?? item.cultivar ?? '',
      supplier:    item.Supplier || value.supplier || '',
      farmer:      item.Farmer || value.farmer || '',
      costPerStem: itemCost > 0 ? String(itemCost) : value.costPerStem,
      sellPerStem: itemSell > 0
        ? String(itemSell)
        : (itemCost > 0 && targetMarkup ? String(Math.round(itemCost * targetMarkup)) : value.sellPerStem),
      lotSize:     itemLot > 0 ? String(itemLot) : value.lotSize,
    });
  }

  // Typing a cost fills the sell price from the target markup, but only when
  // sell is still empty — a sell the Owner (or a matched card) already supplied
  // is never overwritten. This replaces the hosts' `sellPriceManual` flag with
  // "is the field empty?", which needs no extra state to stay correct.
  function withMarkupSuggestion(nextCost) {
    const patch = { costPerStem: nextCost };
    const n = Number(nextCost) || 0;
    if (n > 0 && targetMarkup && !String(value.sellPerStem ?? '').trim()) {
      patch.sellPerStem = String(Math.round(n * targetMarkup));
    }
    return patch;
  }

  // Pending "create a new variety?" confirmation (hybrid rule, ADR-0016).
  const [newVarietyPrompt, setNewVarietyPrompt] = useState(null);

  // Every attr edit re-resolves the link (ADR-0014); `adopt` only carries values
  // the matched card actually has, so a match never blanks something typed.
  //
  // Hybrid rule (owner decision 2026-07-30, ADR-0016): a match re-links silently
  // — that is the routine "Peony 60cm → 70cm" case. NO match on a line that was
  // linked does NOT silently detach any more: detaching mints a brand-new
  // Variety at evaluation, and doing that from a typo is what fragmented stock
  // before (#562). Instead the owner is asked to confirm, and only the confirmed
  // path sets `isNewVariety` (→ `New Variety: true`, which the backend requires).
  function handleAttrsChange(nextAttrs) {
    const { matched, stockItemId, adopt } = resolveVarietyLink(stock, nextAttrs, { targetMarkup });
    if (!matched && value.stockItemId) {
      setNewVarietyPrompt({ attrs: nextAttrs, previous: { ...value } });
      return;
    }
    setNewVarietyPrompt(null);
    onChange({ ...nextAttrs, stockItemId, ...adopt, isNewVariety: false });
  }

  function confirmNewVariety() {
    const { attrs } = newVarietyPrompt;
    setNewVarietyPrompt(null);
    onChange({ ...attrs, stockItemId: '', isNewVariety: true });
  }

  function cancelNewVariety() {
    const { previous } = newVarietyPrompt;
    setNewVarietyPrompt(null);
    onChange({ ...previous });
  }

  const varietyForm = {
    typeName: value.type   ?? '',
    colour:   value.colour ?? '',
    sizeCm:   value.size   ?? '',
    cultivar: value.cultivar ?? '',
  };

  function handleVarietyUpdater(updater) {
    const next = typeof updater === 'function' ? updater(varietyForm) : updater;
    handleAttrsChange({
      type:     next.typeName ?? '',
      colour:   next.colour   ?? '',
      size:     next.sizeCm   ?? '',
      cultivar: next.cultivar ?? '',
    });
  }

  const badge = linked
    ? { text: tx('varietyLinked', 'from stock card'), cls: 'bg-emerald-100 text-emerald-700' }
    : hasType
      ? { text: tx('newVariety', 'new variety'),      cls: 'bg-amber-100 text-amber-700' }
      : { text: tx('varietyNone', 'not selected'),    cls: 'bg-gray-100 text-gray-600' };

  const numCls = 'field-input w-full text-sm';
  const lblCls = 'text-[10px] text-ios-tertiary uppercase mb-0.5 block';

  return (
    <div className="space-y-2" data-testid="po-line-form">
      <StockSearchInput
        stock={stock}
        value={value.flowerName}
        t={t}
        onChange={(name) => onChange({ flowerName: name, stockItemId: '' })}
        onSelect={handleStockSelect}
      />

      {/* Variety identity — always visible (ADR-0014), never gated on the link. */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold">
            {tx('variety', 'Variety')}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`} data-testid="po-variety-badge">
            {badge.text}
          </span>
        </div>
        <NewVarietyFields
          form={varietyForm}
          onChange={handleVarietyUpdater}
          t={t}
          stockItems={stock}
          idPrefix={`${idPrefix}-nv`}
          sizeOptions={sizeOptions}
        />

        {/* Hybrid rule: an identity that matches nothing is not applied until
            the owner confirms it really is a new variety. Cancelling restores
            the previous flower, so a typo can never fragment stock (#562). */}
        {newVarietyPrompt && (
          <div
            data-testid="po-new-variety-prompt"
            className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900"
          >
            <p className="mb-1.5">
              {tx('newVarietyConfirm', 'No such flower yet. Create it as a new variety?')}
              {' '}
              <span className="font-semibold">
                {[newVarietyPrompt.attrs.type, newVarietyPrompt.attrs.colour,
                  newVarietyPrompt.attrs.size ? `${newVarietyPrompt.attrs.size}cm` : null,
                  newVarietyPrompt.attrs.cultivar].filter(Boolean).join(' ')}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="po-new-variety-confirm"
                onClick={confirmNewVariety}
                className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white active:bg-amber-600"
              >
                {tx('newVarietyCreate', 'Create new')}
              </button>
              <button
                type="button"
                data-testid="po-new-variety-cancel"
                onClick={cancelNewVariety}
                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-300 active:bg-amber-100"
              >
                {tx('cancel', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stems / Lot / Packages. Packages is derived — editing it sets stems. */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={lblCls}>{tx('qtyNeeded', 'Needed')}</label>
          <input
            type="number" inputMode="numeric" min="0" className={numCls}
            value={value.qty ?? ''} placeholder="0"
            onChange={(e) => onChange({ qty: e.target.value })}
            data-testid="po-qty"
          />
        </div>
        <div>
          <label className={lblCls}>{tx('lotSize', 'Lot size')}</label>
          <input
            type="number" inputMode="numeric" min="0" className={numCls}
            value={value.lotSize ?? ''} placeholder="1"
            onChange={(e) => onChange({ lotSize: e.target.value })}
            data-testid="po-lot"
          />
        </div>
        <div>
          <label className={lblCls}>{tx('packages', 'Pkgs')}</label>
          <input
            type="number" inputMode="decimal" min="0" step="0.5" className={numCls}
            value={packages ?? ''} placeholder="—"
            disabled={lotSize <= 1}
            onChange={(e) => onChange({ qty: String(stemsFromPackages(e.target.value, lotSize)) })}
            data-testid="po-packages"
          />
        </div>
      </div>

      {stems > 0 && (
        <div className="flex items-center justify-between bg-brand-50 rounded-lg px-3 py-1.5" data-testid="po-stems-line">
          <span className="text-xs text-brand-700">
            {packages != null
              ? `${packages} × ${lotSize} = ${stems} ${tx('stems', 'pcs')}`
              : `${stems} ${tx('stems', 'pcs')}`}
          </span>
          {totalCost > 0 && (
            <span className="text-sm font-semibold text-brand-700">
              {tx('totalCost', 'Total')}: {totalCost.toFixed(2)} zł
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lblCls}>{tx('costPrice', 'Cost')} / {tx('stems', 'pc')}</label>
          <input
            type="number" step="0.01" min="0" className={numCls}
            value={value.costPerStem ?? ''} placeholder="0"
            onChange={(e) => onChange(withMarkupSuggestion(e.target.value))}
            data-testid="po-cost"
          />
        </div>
        <div>
          <label className={lblCls}>
            {tx('sellPrice', 'Sell')} / {tx('stems', 'pc')}
            {markup && (
              <span className={`ml-1 px-1 rounded-full ${
                Number(markup) >= targetMarkup ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>×{markup}</span>
            )}
          </label>
          <input
            type="number" step="0.01" min="0" className={numCls}
            value={value.sellPerStem ?? ''} placeholder="0"
            onChange={(e) => onChange({ sellPerStem: e.target.value })}
            data-testid="po-sell"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lblCls}>{tx('supplier', 'Supplier')}</label>
          <input
            type="text" list={`${idPrefix}-suppliers`} className={numCls}
            value={value.supplier ?? ''}
            onChange={(e) => onChange({ supplier: e.target.value })}
            data-testid="po-supplier"
          />
          <datalist id={`${idPrefix}-suppliers`}>
            {suppliers.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        {mode !== 'shopping' && (
          <div>
            <label className={lblCls}>{tx('farmer', 'Farmer')}</label>
            <input
              type="text" className={numCls}
              value={value.farmer ?? ''}
              onChange={(e) => onChange({ farmer: e.target.value })}
              data-testid="po-farmer"
            />
          </div>
        )}
      </div>

      {mode !== 'shopping' && (
        <div>
          <label className={lblCls}>{tx('notes', 'Notes')}</label>
          <input
            type="text" className={numCls}
            value={value.notes ?? ''}
            onChange={(e) => onChange({ notes: e.target.value })}
            data-testid="po-notes"
          />
        </div>
      )}
    </div>
  );
}
