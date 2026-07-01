import { Sheet } from '@flower-studio/shared';
import t from '../translations.js';

// Mobile filter drawer for the Y-model By-Variety Stock list (E1b). Mirrors the
// order filter drawer, but filters on VARIETY-level dimensions (the florist list
// is grouped by Variety, not flattened sell-tiers like the dashboard flat table):
// Type / colour·cultivar text / status (short·tight·free) / net range. Edits the
// shared variety-filter object live and applies in real time.
export default function StockFilterDrawer({ open, onClose, filter, onApply, onReset }) {
  const set = (key, value) => onApply({ ...filter, [key]: value });
  const statuses = [
    { v: '', label: t.all },
    { v: 'short', label: t.statusShort },
    { v: 'tight', label: t.statusTight },
    { v: 'free', label: t.statusFree },
  ];
  return (
    <Sheet open={open} onClose={onClose} title={t.filters} t={t}>
      <div className="px-4 pb-4 space-y-3">
        <input
          className="field-input w-full"
          placeholder={t.type}
          value={filter.typeQuery}
          onChange={e => set('typeQuery', e.target.value)}
        />
        <input
          className="field-input w-full"
          placeholder={t.stockFilterVariety || 'Colour / cultivar'}
          value={filter.varietyQuery}
          onChange={e => set('varietyQuery', e.target.value)}
        />
        {/* Status segmented control */}
        <div className="flex flex-wrap gap-1.5">
          {statuses.map(s => (
            <button
              key={s.v || 'all'}
              onClick={() => set('status', s.v)}
              className={`px-3 h-8 rounded-full text-xs font-medium ${filter.status === s.v ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* Net range */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ios-tertiary w-10">{t.net}</span>
          <input type="number" className="field-input w-24" placeholder={t.filterMin}
            value={filter.netMin ?? ''} onChange={e => set('netMin', e.target.value === '' ? null : Number(e.target.value))} />
          <span className="text-xs text-ios-tertiary">—</span>
          <input type="number" className="field-input w-24" placeholder={t.filterMax}
            value={filter.netMax ?? ''} onChange={e => set('netMax', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onReset} className="flex-1 h-10 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium">{t.resetFilters}</button>
          <button onClick={onClose} className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-medium">{t.apply}</button>
        </div>
      </div>
    </Sheet>
  );
}
