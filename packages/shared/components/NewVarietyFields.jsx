import { useMemo } from 'react';
import ValueCombobox from './ValueCombobox.jsx';

/**
 * NewVarietyFields — the Y-model Variety 4-tuple inputs (Type / Colour / Size /
 * Cultivar) for every "create a new flower" form.
 *
 * Under STOCK_Y_MODEL a brand-new flower created from order intake MUST carry
 * its Variety attrs, or it lands as an attr-less Stock row that the grouped
 * Stock view can't classify (root pitfall #9 / the type_name NOT NULL class).
 * Previously the search-driven "Add new" form only captured price/lot/supplier,
 * so a flower the owner didn't have yet (e.g. "red roses") was created blind.
 *
 * Type is required (it is NOT NULL on prod and drives grouping). Colour / Size /
 * Cultivar are optional — and a blank one is a real, distinct identity under
 * ADR-0006, not a wildcard.
 *
 * **Each field is a `ValueCombobox`, not a text box** (#610). These four values
 * ARE the flower's identity, so a typo or a case variant does not produce a
 * slightly-wrong label — it produces a second flower, and stock splits across
 * two cards that each show a fraction of the truth (#562 / #558). The owner
 * reported these as "type fields" after typing `DA` and meeting four blanks;
 * they now open a list of what she already uses, snap `white` onto `White`, and
 * take a deliberate click to add a value that is genuinely new.
 *
 * Props: form ({ typeName, colour, sizeCm, cultivar }), onChange (setNewFlowerForm
 * updater), t, stockItems (options derived from these in-memory — no fetch),
 * sizeOptions (optional — Variety-aware size suggestions; the Stock Order line
 * form passes the sizes actually stocked for the chosen Type, so "pick a
 * different size" reads as choosing an existing Variety rather than inventing
 * one. Defaults to every size seen in the loaded stock).
 */
export default function NewVarietyFields({ form, onChange, t, stockItems = [], sizeOptions = [] }) {
  const { types, colours, cultivars, sizes } = useMemo(() => {
    const ty = new Set(), co = new Set(), cu = new Set(), sz = new Set();
    for (const s of stockItems) {
      const tn = s['Type'] ?? s.type_name;
      const c = s['Colour'] ?? s.colour;
      const cv = s['Cultivar'] ?? s.cultivar;
      const size = s['Size'] ?? s.size_cm;
      if (tn) ty.add(String(tn));
      if (c) co.add(String(c));
      if (cv) cu.add(String(cv));
      if (size != null && size !== '' && Number.isFinite(Number(size))) sz.add(Number(size));
    }
    const sort = (set) => [...set].sort((a, b) => a.localeCompare(b));
    return {
      types: sort(ty),
      colours: sort(co),
      cultivars: sort(cu),
      sizes: [...sz].sort((a, b) => a - b).map(String),
    };
  }, [stockItems]);

  const set = (k) => (v) => onChange((p) => ({ ...p, [k]: v }));
  const sizeList = sizeOptions.length > 0 ? sizeOptions.map(String) : sizes;

  return (
    <div className="space-y-2" data-testid="new-variety-fields">
      <div className="grid grid-cols-2 gap-2">
        <ValueCombobox
          value={form.typeName ?? ''}
          onChange={set('typeName')}
          options={types}
          placeholder={`${t.flowerType ?? 'Type'} *`}
          testId="nv-type"
          t={t}
        />
        <ValueCombobox
          value={form.colour ?? ''}
          onChange={set('colour')}
          options={colours}
          placeholder={t.flowerColour ?? 'Colour'}
          testId="nv-colour"
          t={t}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ValueCombobox
          value={form.cultivar ?? ''}
          onChange={set('cultivar')}
          options={cultivars}
          placeholder={t.flowerCultivar ?? 'Cultivar'}
          testId="nv-cultivar"
          t={t}
        />
        <ValueCombobox
          value={form.sizeCm ?? ''}
          onChange={set('sizeCm')}
          options={sizeList}
          placeholder={t.flowerSizeCm ?? 'Size cm'}
          testId="nv-size"
          numeric
          t={t}
        />
      </div>
    </div>
  );
}
