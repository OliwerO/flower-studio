import { useMemo } from 'react';

/**
 * NewVarietyFields — the Y-model Variety 4-tuple inputs (Type / Colour / Size /
 * Cultivar) for the "Add new flower" form in the bouquet builder.
 *
 * Under STOCK_Y_MODEL a brand-new flower created from order intake MUST carry
 * its Variety attrs, or it lands as an attr-less Stock row that the grouped
 * Stock view can't classify (root pitfall #9 / the type_name NOT NULL class).
 * Previously the search-driven "Add new" form only captured price/lot/supplier,
 * so a flower the owner didn't have yet (e.g. "red roses") was created blind.
 *
 * Type is required (it is NOT NULL on prod and drives grouping). Colour / Size /
 * Cultivar are optional. Datalists suggest existing values from the loaded stock
 * so entries stay consistent (no new fetch — derived in-memory).
 *
 * Props: form ({ typeName, colour, sizeCm, cultivar }), onChange (setNewFlowerForm
 * updater), t, stockItems (for datalist suggestions), idPrefix (unique datalist id).
 */
export default function NewVarietyFields({ form, onChange, t, stockItems = [], idPrefix = 'nv' }) {
  const { types, colours, cultivars } = useMemo(() => {
    const ty = new Set(), co = new Set(), cu = new Set();
    for (const s of stockItems) {
      const tn = s['Type'] ?? s.type_name;
      const c = s['Colour'] ?? s.colour;
      const cv = s['Cultivar'] ?? s.cultivar;
      if (tn) ty.add(String(tn));
      if (c) co.add(String(c));
      if (cv) cu.add(String(cv));
    }
    const sort = (set) => [...set].sort((a, b) => a.localeCompare(b));
    return { types: sort(ty), colours: sort(co), cultivars: sort(cu) };
  }, [stockItems]);

  const set = (k, v) => onChange((p) => ({ ...p, [k]: v }));
  const cls = 'text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none';

  return (
    <div className="space-y-2" data-testid="new-variety-fields">
      <div className="grid grid-cols-2 gap-2">
        <input
          list={`${idPrefix}-types`}
          value={form.typeName ?? ''}
          onChange={(e) => set('typeName', e.target.value)}
          placeholder={`${t.flowerType ?? 'Type'} *`}
          className={cls}
          data-testid="nv-type"
        />
        <input
          list={`${idPrefix}-colours`}
          value={form.colour ?? ''}
          onChange={(e) => set('colour', e.target.value)}
          placeholder={t.flowerColour ?? 'Colour'}
          className={cls}
          data-testid="nv-colour"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          list={`${idPrefix}-cultivars`}
          value={form.cultivar ?? ''}
          onChange={(e) => set('cultivar', e.target.value)}
          placeholder={t.flowerCultivar ?? 'Cultivar'}
          className={cls}
          data-testid="nv-cultivar"
        />
        <input
          type="number"
          inputMode="numeric"
          value={form.sizeCm ?? ''}
          onChange={(e) => set('sizeCm', e.target.value)}
          placeholder={t.flowerSizeCm ?? 'Size cm'}
          className={cls}
          data-testid="nv-size"
        />
      </div>
      <datalist id={`${idPrefix}-types`}>{types.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id={`${idPrefix}-colours`}>{colours.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id={`${idPrefix}-cultivars`}>{cultivars.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  );
}
