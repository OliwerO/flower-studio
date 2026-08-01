import { useMemo, useState } from 'react';
import NewVarietyFields from './NewVarietyFields.jsx';
import { createBouquetDemand } from '../utils/createBouquetDemand.js';
import { varietyDisplayName, groupByVariety } from '../utils/varietyKey.js';
import { resolveVariety, seedVarietyFromQuery, normaliseSize } from '../utils/varietyIdentity.js';

/**
 * BouquetFlowerForm — **the** "add a flower to a bouquet" form.
 *
 * Deliberate sibling of `PoLineForm`: same badge vocabulary, same amber confirm,
 * different domain (a bouquet demand, not a Stock Order line). One form for the
 * five surfaces that had drifted apart — florist `OrderCard` + `OrderDetailPage`,
 * dashboard `OrderDetailPanel`, and both wizards' `steps/Step2Bouquet`.
 *
 * ## The rule this exists to enforce
 *
 * **The typed search string is a seed for the form. It is never an identity.**
 *
 * All five surfaces used to do the opposite: the raw query became the flower's
 * Type (and its name). That is how `Pink Peonies` ended up as a Type beside the
 * real `Peony / Pink` (#562), and how the owner typing `DA` while looking for
 * Dahlia got a flower both named and typed `DA` (2026-07-30). Here the query is
 * decomposed against values that ALREADY exist (`seedVarietyFromQuery`), the
 * flower's name is built from the classification or taken from the matched card,
 * and creating a genuinely new Variety takes an explicit confirm.
 *
 * Two of the five (florist `OrderCard`, `OrderDetailPage`) had no Variety fields
 * at all — the flower was one free-typed blob. `dense` is how they get the fields
 * without losing their two-tap phone ergonomics: the resolved name and the
 * suggestion chips carry the common path, and the 4-tuple stays behind a
 * disclosure that auto-opens exactly when the seed could not classify the query.
 *
 * ## Badge states
 *
 * | state    | when                                      | submit                |
 * |----------|-------------------------------------------|-----------------------|
 * | `none`   | no Type yet                               | disabled              |
 * | `linked` | the tuple resolves to a flower she has    | straight through      |
 * | `new`    | Type present, nothing matches             | raises the confirm    |
 *
 * `dated-only` (the flower exists solely as a dated delivery) counts as
 * **linked**. Prompting "create a new variety?" there would be a lie — she is
 * holding the stems — and it trains her to click through the prompt.
 *
 * NOTE for future readers: `PoLineForm` gates its prompt on
 * `!matched && value.stockItemId` because it protects a line that ALREADY had a
 * link. A bouquet add starts with no link, so that gate would never fire here.
 * The gate below is the opposite — prompt on submit whenever nothing matched.
 * Do not "fix" it back.
 */
export const BOUQUET_FLOWER_FORM_KEYS = [
  'newVarietyConfirm', 'newVarietyCreate', 'varietyLinked', 'varietyNone',
  'newVariety', 'varietyRefine', 'varietySuggestions', 'varietyTypeRequired',
  'flowerName', 'addToCart', 'cancel', 'costPrice', 'sellPrice',
];

export default function BouquetFlowerForm({
  seedQuery = '',
  seedStockItem = null,
  nameEditable = false,
  stockItems = [],
  apiClient,
  quantity = 1,
  fields = {},
  suppliers = [],
  targetMarkup = 0,
  dense = false,
  idPrefix = 'bff',
  t = {},
  showToast,
  onCreated,
  onCancel,
}) {
  const [form, setForm] = useState(() => seedVarietyFromQuery(seedQuery, stockItems, seedStockItem));
  const [refineOpen, setRefineOpen] = useState(() => !form.typeName);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // The florist app nests some of these under `t.po`; the dashboard keeps them
  // flat. Read both rather than forcing a translations refactor into this change.
  const tx = (key, fallback) => t[key] ?? t.po?.[key] ?? fallback;

  const resolution = useMemo(() => resolveVariety(stockItems, form), [stockItems, form]);
  const hasType = !!String(form.typeName || '').trim();

  // `dated-only` is a real flower she is holding — treat it as linked.
  const state = !hasType && !resolution.match
    ? 'none'
    : (resolution.match || resolution.reason === 'dated-only') ? 'linked' : 'new';

  /**
   * The name that will actually be written. Never `seedQuery` — that is the
   * whole point. A matched card keeps its own name (so the line reads the same
   * as the stock screen); otherwise the name is composed from the classification,
   * so name and attrs cannot disagree (#558's divergence class).
   */
  const resolvedName = useMemo(() => {
    if (resolution.match) return resolution.match['Display Name'] || '';
    const composed = varietyDisplayName({
      type_name: form.typeName, colour: form.colour,
      size_cm: normaliseSize(form.sizeCm), cultivar: form.cultivar,
    });
    return composed || String(form.name || '').trim();
  }, [resolution.match, form.typeName, form.colour, form.sizeCm, form.cultivar, form.name]);

  // Sizes actually stocked for the chosen Type — picking one reads as choosing
  // an existing Variety rather than inventing a new height.
  const sizeOptions = useMemo(() => {
    const wantType = String(form.typeName || '').trim().toLowerCase();
    const out = new Set();
    for (const s of stockItems) {
      const ty = String(s.Type ?? s.type_name ?? '').trim().toLowerCase();
      if (wantType && ty !== wantType) continue;
      const size = s.Size ?? s.size_cm;
      if (size != null && size !== '') out.add(String(size));
    }
    return [...out].sort((a, b) => Number(a) - Number(b));
  }, [stockItems, form.typeName]);

  /**
   * "You already have" — the dropdown made visible. A `<datalist>` on a phone is
   * invisible until you tap into the field, which is why these are chips: the
   * owner asked to *see* what she has had before, not to discover it by typing.
   */
  const suggestions = useMemo(() => {
    const wantType = String(form.typeName || '').trim().toLowerCase();
    const groups = [...groupByVariety(
      stockItems
        .filter(s => (s.Type ?? s.type_name))
        .map(s => ({
          type_name: s.Type ?? s.type_name,
          colour: s.Colour ?? s.colour,
          size_cm: s.Size ?? s.size_cm,
          cultivar: s.Cultivar ?? s.cultivar,
        })),
    ).values()];
    const scoped = wantType
      ? groups.filter(g => String(g.type_name || '').trim().toLowerCase() === wantType)
      : groups;
    return scoped
      .map(g => ({ ...g, label: varietyDisplayName(g) }))
      .filter(g => g.label)
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 12);
  }, [stockItems, form.typeName]);

  function applySuggestion(g) {
    setConfirming(false);
    setForm(p => ({
      ...p,
      typeName: g.type_name ? String(g.type_name) : '',
      colour:   g.colour ? String(g.colour) : '',
      sizeCm:   g.size_cm != null ? String(g.size_cm) : '',
      cultivar: g.cultivar ? String(g.cultivar) : '',
    }));
  }

  // Any edit invalidates a pending confirm — she must re-see what she is creating.
  function updateForm(updater) {
    setConfirming(false);
    setForm(updater);
  }

  async function save(newVariety) {
    if (!hasType && !resolution.match) return;
    setSaving(true);
    try {
      const result = await createBouquetDemand({
        apiClient,
        stockItems,
        displayName: resolvedName,
        variety: {
          type_name: String(form.typeName || '').trim() || null,
          colour:    String(form.colour || '').trim() || null,
          size_cm:   normaliseSize(form.sizeCm),
          cultivar:  String(form.cultivar || '').trim() || null,
        },
        costPrice: Number(form.costPrice) || 0,
        sellPrice: Number(form.sellPrice) || 0,
        quantity,
        supplier: fields.supplier ? form.supplier : undefined,
        lotSize:  fields.lotSize ? form.lotSize : undefined,
        resolvedStockItem: resolution.match || undefined,
        newVariety: newVariety === true ? true : undefined,
      });
      setConfirming(false);
      onCreated?.({ ...result, resolved: !!resolution.match, form });
    } catch (err) {
      // Never silently append an unlinked line — a flower with no stock record
      // is exactly what this form exists to prevent (pitfall #5).
      console.error('BouquetFlowerForm: create failed', err);
      showToast?.(err?.response?.data?.error || tx('error', 'Error'), 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    if (state === 'new') { setConfirming(true); return; }
    save(false);
  }

  // Suggest a sell price from cost once, without ever overwriting a typed one.
  function handleCostBlur() {
    if (!(targetMarkup > 0)) return;
    const cost = Number(form.costPrice) || 0;
    if (cost > 0 && !String(form.sellPrice || '').trim()) {
      setForm(p => ({ ...p, sellPrice: String(Math.round(cost * targetMarkup * 100) / 100) }));
    }
  }

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none w-full';
  const badge = {
    none:   { cls: 'bg-gray-100 text-gray-600',     label: tx('varietyNone', 'not selected') },
    linked: { cls: 'bg-emerald-100 text-emerald-800', label: tx('varietyLinked', 'from stock card') },
    new:    { cls: 'bg-amber-100 text-amber-800',   label: tx('newVariety', 'new variety') },
  }[state];

  return (
    <div className="space-y-2" data-testid="bouquet-flower-form">
      {/* What will actually be written — name + how it resolved. */}
      <div className="flex items-center gap-2 flex-wrap">
        {nameEditable ? (
          <input
            value={form.name ?? ''}
            onChange={(e) => updateForm(p => ({ ...p, name: e.target.value }))}
            placeholder={tx('flowerName', 'Flower name')}
            className={`${inputCls} flex-1 min-w-[8rem]`}
            data-testid="bff-name"
          />
        ) : (
          <span className="text-sm font-medium text-gray-900 flex-1" data-testid="bff-resolved-name">
            {resolvedName || tx('varietyTypeRequired', 'Choose a type first')}
          </span>
        )}
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`} data-testid="bff-variety-badge">
          {badge.label}
        </span>
      </div>
      {/* When a card matched, name it explicitly — on the wizards the editable
          name field can differ from the card the line will actually bind to. */}
      {nameEditable && resolution.match && (
        <p className="text-[11px] text-emerald-700" data-testid="bff-resolved-name">
          {resolution.match['Display Name']}
        </p>
      )}

      {suggestions.length > 0 && state !== 'linked' && (
        <div data-testid="bff-suggestions">
          <p className="text-[11px] text-gray-500 mb-1">{tx('varietySuggestions', 'You already have')}</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {suggestions.map((g) => (
              <button
                key={g.key}
                type="button"
                data-testid="bff-suggestion"
                onClick={() => applySuggestion(g)}
                className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-800 active:bg-gray-200"
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number" inputMode="decimal" step="0.01"
          value={form.costPrice ?? ''}
          onChange={(e) => updateForm(p => ({ ...p, costPrice: e.target.value }))}
          onBlur={handleCostBlur}
          placeholder={tx('costPrice', 'Cost')}
          className={inputCls}
          data-testid="bff-cost"
        />
        <input
          type="number" inputMode="decimal" step="0.01"
          value={form.sellPrice ?? ''}
          onChange={(e) => updateForm(p => ({ ...p, sellPrice: e.target.value }))}
          placeholder={tx('sellPrice', 'Sell')}
          className={inputCls}
          data-testid="bff-sell"
        />
      </div>

      {(fields.supplier || fields.lotSize) && (
        <div className="grid grid-cols-2 gap-2">
          {fields.supplier && (
            <>
              <input
                list={`${idPrefix}-suppliers`}
                value={form.supplier ?? ''}
                onChange={(e) => updateForm(p => ({ ...p, supplier: e.target.value }))}
                placeholder={tx('supplier', 'Supplier')}
                className={inputCls}
                data-testid="bff-supplier"
              />
              <datalist id={`${idPrefix}-suppliers`}>
                {suppliers.map((s) => <option key={s} value={s} />)}
              </datalist>
            </>
          )}
          {fields.lotSize && (
            <input
              type="number" inputMode="numeric"
              value={form.lotSize ?? ''}
              onChange={(e) => updateForm(p => ({ ...p, lotSize: e.target.value }))}
              placeholder={tx('lotSize', 'Lot size')}
              className={inputCls}
              data-testid="bff-lot"
            />
          )}
        </div>
      )}

      {/* On a phone the 4-tuple hides until it is the point — which is exactly
          when the seed could not classify what she typed. */}
      {dense && (
        <button
          type="button"
          data-testid="bff-refine-toggle"
          onClick={() => setRefineOpen(o => !o)}
          className="text-[11px] text-brand-600 font-medium"
        >
          {tx('varietyRefine', 'Refine')} {refineOpen ? '▴' : '▾'}
        </button>
      )}
      {(!dense || refineOpen) && (
        <NewVarietyFields
          form={form}
          onChange={updateForm}
          t={t}
          stockItems={stockItems}
          idPrefix={`${idPrefix}-nv`}
          sizeOptions={sizeOptions}
        />
      )}

      {confirming && (
        <div
          data-testid="bff-new-variety-prompt"
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900"
        >
          <p className="mb-1.5">
            {tx('newVarietyConfirm', 'No such flower yet. Create it as a new variety?')}{' '}
            <span className="font-semibold">{resolvedName}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="bff-new-variety-confirm"
              disabled={saving}
              onClick={() => save(true)}
              className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white active:bg-amber-600 disabled:opacity-50"
            >
              {tx('newVarietyCreate', 'Create new')}
            </button>
            <button
              type="button"
              data-testid="bff-new-variety-cancel"
              onClick={() => setConfirming(false)}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-300 active:bg-amber-100"
            >
              {tx('cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="bff-submit"
          disabled={state === 'none' || saving}
          onClick={handleSubmit}
          className="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700 disabled:opacity-40"
        >
          {tx('addToCart', 'Add')}
        </button>
        <button
          type="button"
          data-testid="bff-cancel"
          onClick={onCancel}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 active:bg-gray-200"
        >
          {tx('cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
}
