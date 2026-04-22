// CustomerFilterSheet — mobile-native bottom-sheet equivalent of the
// dashboard's CustomerFilterBar.
//
// On desktop, the dashboard shows filters as inline chips with popover
// editors — which works because there's horizontal room next to a 1200+px
// list. On mobile, that pattern doesn't fit: chips wrap awkwardly,
// popovers fight with the virtual keyboard, and hunting through +Add
// Filter menus on a 375px screen adds tap latency.
//
// This component inverts the layout: every filter dimension renders as an
// always-visible section, with its editor inline. Owner scrolls, taps,
// done. Same filter state shape as the dashboard (same customerFilters.js
// from @flower-studio/shared), so a filter saved in localStorage here and
// viewed on the dashboard means the same thing.

import { useMemo } from 'react';
import { Sheet } from '@flower-studio/shared';
import { activeFilterCount } from '@flower-studio/shared';
import t from '../translations.js';

const MULTI_DIMS = [
  { key: 'segments',    labelKey: 'segment',      extract: c => c.Segment },
  { key: 'languages',   labelKey: 'language',     extract: c => c.Language },
  { key: 'comms',       labelKey: 'commMethod',   extract: c => c['Communication method'] },
  { key: 'sources',     labelKey: 'orderSource',  extract: c => c['Order Source'] },
  { key: 'sexBiz',      labelKey: 'sexBusiness',  extract: c => c['Sex / Business'] },
  { key: 'foundUsFrom', labelKey: 'foundUsFrom',  extract: c => c['Found us from'] },
];

const TOGGLE_DIMS = [
  { key: 'hasPhone',        labelKey: 'hasPhone' },
  { key: 'hasInstagram',    labelKey: 'hasInstagram' },
  { key: 'hasEmail',        labelKey: 'hasEmail' },
  { key: 'hasKeyPerson',    labelKey: 'hasKeyPerson' },
  { key: 'churnRisk',       labelKey: 'churnRisk' },
  { key: 'doNotContactOnly', labelKey: 'doNotContact' },
];

const WITHIN_PRESETS = [7, 30, 60, 90, 180, 365];

function uniqueValues(customers, extract) {
  const set = new Set();
  for (const c of customers) {
    const v = extract(c);
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach(x => x && set.add(x));
    else set.add(v);
  }
  return [...set].sort();
}

export default function CustomerFilterSheet({
  open, onClose, filters, setFilters, customers, onClearAll,
}) {
  const count = activeFilterCount(filters);
  const title = count > 0
    ? `${t.filters || 'Filters'} (${count})`
    : (t.filters || 'Filters');

  return (
    <Sheet open={open} onClose={onClose} title={title} t={t}>
      <div className="space-y-5">
        {MULTI_DIMS.map(dim => (
          <MultiSection
            key={dim.key}
            dim={dim}
            filters={filters}
            setFilters={setFilters}
            customers={customers}
          />
        ))}

        {/* Presence toggles — grouped together since they all share one UX pattern */}
        <div>
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.presenceToggles || 'Must have'}
          </p>
          <div className="flex flex-wrap gap-2">
            {TOGGLE_DIMS.map(dim => {
              const active = !!filters[dim.key];
              return (
                <button
                  key={dim.key}
                  onClick={() => setFilters(p => ({ ...p, [dim.key]: !p[dim.key] }))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 text-ios-secondary'
                  }`}
                >
                  {t[dim.labelKey] || dim.labelKey}
                </button>
              );
            })}
          </div>
        </div>

        <WithinDaysSection filters={filters} setFilters={setFilters} />
        <MinNumberSection
          dimKey="minOrderCount"
          labelKey="minOrderCount"
          unit=""
          filters={filters}
          setFilters={setFilters}
        />
        <MinNumberSection
          dimKey="minTotalSpend"
          labelKey="minTotalSpend"
          unit="zł"
          filters={filters}
          setFilters={setFilters}
        />

        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <button
            onClick={() => { onClearAll(); }}
            disabled={count === 0}
            className="flex-1 h-11 rounded-xl bg-gray-100 text-ios-secondary text-sm font-semibold
                       disabled:opacity-50 active-scale"
          >
            {t.clearAll || 'Clear all'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
          >
            {t.apply || 'Apply'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function MultiSection({ dim, filters, setFilters, customers }) {
  const values = useMemo(() => uniqueValues(customers, dim.extract), [customers, dim]);
  const selected = filters[dim.key];

  if (values.length === 0) return null;

  function toggle(v) {
    setFilters(p => {
      const next = { ...p };
      const cur = new Set(p[dim.key]);
      if (cur.has(v)) cur.delete(v); else cur.add(v);
      next[dim.key] = cur;
      return next;
    });
  }

  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t[dim.labelKey] || dim.labelKey}
      </p>
      <div className="flex flex-wrap gap-2">
        {values.map(v => (
          <button
            key={v}
            onClick={() => toggle(v)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selected.has(v)
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-ios-secondary'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function WithinDaysSection({ filters, setFilters }) {
  const cur = filters.lastOrderWithinDays;
  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t.lastOrderWithin || 'Last order within'}
      </p>
      <div className="flex flex-wrap gap-2">
        {WITHIN_PRESETS.map(d => (
          <button
            key={d}
            onClick={() =>
              setFilters(p => ({ ...p, lastOrderWithinDays: cur === d ? null : d }))
            }
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              cur === d
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-ios-secondary'
            }`}
          >
            ≤{d}d
          </button>
        ))}
      </div>
    </div>
  );
}

function MinNumberSection({ dimKey, labelKey, unit, filters, setFilters }) {
  const cur = filters[dimKey];
  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
        {t[labelKey] || labelKey} {unit && <span className="normal-case">({unit})</span>}
      </p>
      <input
        type="number"
        inputMode="numeric"
        value={cur ?? ''}
        onChange={e =>
          setFilters(p => ({
            ...p,
            [dimKey]: e.target.value === '' ? null : Number(e.target.value),
          }))
        }
        placeholder={t.noMinimum || 'Any'}
        min={0}
        className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-white text-sm text-ios-label focus:border-brand-500 focus:outline-none"
      />
    </div>
  );
}
