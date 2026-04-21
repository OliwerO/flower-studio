// CustomerFilterBar — composable filter chips with AND logic.
// State is owned by the parent (CustomersTab); this component just renders
// chips for active filters and exposes an "+ Add filter" menu for new ones.

import { useMemo, useState, useEffect, useRef } from 'react';
import t from '../translations.js';
import { activeFilterCount } from '../utils/customerFilters.js';

// Definitions of each available filter dimension.
// - key: property path in the filter state
// - label: t-key for human-readable name
// - kind: 'multi' | 'toggle' | 'withinDays' | 'minNumber'
// - extract: how to pull the value list from a customer (for multi dimensions)
const DIMENSIONS = [
  { key: 'segments',      labelKey: 'segment',        kind: 'multi',      extract: c => c.Segment },
  { key: 'languages',     labelKey: 'language',       kind: 'multi',      extract: c => c.Language },
  { key: 'comms',         labelKey: 'commMethod',     kind: 'multi',      extract: c => c['Communication method'] },
  { key: 'sources',       labelKey: 'orderSource',    kind: 'multi',      extract: c => c['Order Source'] },
  { key: 'sexBiz',        labelKey: 'sexBusiness',    kind: 'multi',      extract: c => c['Sex / Business'] },
  { key: 'foundUsFrom',   labelKey: 'foundUsFrom',    kind: 'multi',      extract: c => c['Found us from'] },
  { key: 'hasPhone',      labelKey: 'hasPhone',       kind: 'toggle' },
  { key: 'hasInstagram',  labelKey: 'hasInstagram',   kind: 'toggle' },
  { key: 'hasEmail',      labelKey: 'hasEmail',       kind: 'toggle' },
  { key: 'hasKeyPerson',  labelKey: 'hasKeyPerson',   kind: 'toggle' },
  { key: 'churnRisk',     labelKey: 'churnRisk',      kind: 'toggle' },
  { key: 'doNotContactOnly', labelKey: 'doNotContact', kind: 'toggle' },
  { key: 'lastOrderWithinDays', labelKey: 'lastOrderWithin', kind: 'withinDays' },
  { key: 'minOrderCount', labelKey: 'minOrderCount',  kind: 'minNumber', unit: '',    defaultVal: 5 },
  { key: 'minTotalSpend', labelKey: 'minTotalSpend',  kind: 'minNumber', unit: 'zł',  defaultVal: 500 },
];

// Collect unique values for a multi-select dimension from the current list.
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

function isActive(filters, dim) {
  switch (dim.kind) {
    case 'multi': return filters[dim.key].size > 0;
    case 'toggle': return !!filters[dim.key];
    case 'withinDays': return filters.lastOrderWithinDays != null;
    case 'minNumber': return filters[dim.key] != null;
    default: return false;
  }
}

export default function CustomerFilterBar({ filters, setFilters, customers, onClearAll }) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingDim, setEditingDim]   = useState(null);
  const rootRef = useRef(null);

  // displayDims includes every currently-active filter PLUS whichever
  // dimension the owner just picked from "+ Filter" (editingDim). Without
  // the editingDim bit, activating a multi-select dimension was invisible
  // — its chip didn't render until a value was picked, but the picker lives
  // inside the chip, so there was no way to pick one. Think of it as
  // opening the workstation toolbox before any parts are selected.
  const activeKeys = useMemo(
    () => new Set(DIMENSIONS.filter(d => isActive(filters, d)).map(d => d.key)),
    [filters]
  );
  const displayDims = useMemo(
    () => DIMENSIONS.filter(d => activeKeys.has(d.key) || editingDim === d.key),
    [activeKeys, editingDim]
  );
  const addableDims = useMemo(
    () => DIMENSIONS.filter(d => !activeKeys.has(d.key) && editingDim !== d.key),
    [activeKeys, editingDim]
  );
  const count = activeFilterCount(filters);

  // Close popovers on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setAddMenuOpen(false);
        setEditingDim(null);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function clearDimension(dim) {
    setFilters(prev => {
      const next = { ...prev };
      switch (dim.kind) {
        case 'multi':      next[dim.key] = new Set(); break;
        case 'toggle':     next[dim.key] = false; break;
        case 'withinDays': next.lastOrderWithinDays = null; break;
        case 'minNumber':  next[dim.key] = null; break;
        default: break;
      }
      return next;
    });
  }

  function activateDimension(dim) {
    setAddMenuOpen(false);
    setFilters(prev => {
      const next = { ...prev };
      switch (dim.kind) {
        case 'toggle':     next[dim.key] = true; break;
        case 'withinDays': next.lastOrderWithinDays = 30; break;
        case 'minNumber':  next[dim.key] = dim.defaultVal ?? 1; break;
        case 'multi':      /* open editor so owner picks values */ break;
        default: break;
      }
      return next;
    });
    if (dim.kind === 'multi' || dim.kind === 'withinDays' || dim.kind === 'minNumber') {
      setEditingDim(dim.key);
    }
  }

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5 relative">
      {displayDims.map(dim => (
        <FilterChip
          key={dim.key}
          dim={dim}
          filters={filters}
          setFilters={setFilters}
          customers={customers}
          editing={editingDim === dim.key}
          onToggleEditor={() => setEditingDim(editingDim === dim.key ? null : dim.key)}
          onClear={() => { clearDimension(dim); setEditingDim(null); }}
        />
      ))}

      <div className="relative">
        <button
          onClick={() => setAddMenuOpen(o => !o)}
          className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-ios-secondary hover:bg-gray-200 inline-flex items-center gap-1"
        >
          + {t.addFilter}
        </button>
        {addMenuOpen && addableDims.length > 0 && (
          <div className="absolute z-20 left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[200px] py-1 max-h-80 overflow-y-auto">
            {addableDims.map(dim => (
              <button
                key={dim.key}
                onClick={() => activateDimension(dim)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-ios-label"
              >
                {t[dim.labelKey] || dim.labelKey}
              </button>
            ))}
          </div>
        )}
      </div>

      {count > 0 && (
        <button
          onClick={onClearAll}
          className="text-xs text-ios-secondary hover:text-ios-red underline ml-1"
        >
          {t.clearAll}
        </button>
      )}
    </div>
  );
}

function FilterChip({ dim, filters, setFilters, customers, editing, onToggleEditor, onClear }) {
  const label = t[dim.labelKey] || dim.labelKey;
  let display = label;

  if (dim.kind === 'multi') {
    const set = filters[dim.key];
    const values = [...set];
    if (values.length === 1) display = `${label}: ${values[0]}`;
    else if (values.length > 1) display = `${label}: ${values[0]} +${values.length - 1}`;
    else display = `${label}: ${t.chooseValues || '…'}`;
  } else if (dim.kind === 'withinDays') {
    display = `${label} ${filters.lastOrderWithinDays}d`;
  } else if (dim.kind === 'minNumber') {
    const u = dim.unit ? ` ${dim.unit}` : '';
    display = `${label} ≥${filters[dim.key]}${u}`;
  }

  const editable = dim.kind === 'multi' || dim.kind === 'withinDays' || dim.kind === 'minNumber';

  return (
    <div className="relative">
      <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
        <button
          onClick={editable ? onToggleEditor : undefined}
          className={editable ? 'hover:underline' : 'cursor-default'}
        >
          {display}
        </button>
        <button
          onClick={onClear}
          aria-label={t.remove}
          className="text-brand-400 hover:text-brand-700 w-4 h-4 inline-flex items-center justify-center rounded-full"
        >
          ×
        </button>
      </span>
      {editing && (
        <div className="absolute z-20 left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[240px] p-3">
          {dim.kind === 'multi' && (
            <MultiSelectEditor
              dim={dim}
              filters={filters}
              setFilters={setFilters}
              customers={customers}
              onClose={onToggleEditor}
            />
          )}
          {dim.kind === 'withinDays' && (
            <WithinDaysEditor filters={filters} setFilters={setFilters} onClose={onToggleEditor} />
          )}
          {dim.kind === 'minNumber' && (
            <MinNumberEditor dim={dim} filters={filters} setFilters={setFilters} onClose={onToggleEditor} />
          )}
        </div>
      )}
    </div>
  );
}

function MultiSelectEditor({ dim, filters, setFilters, customers, onClose }) {
  const values = useMemo(() => uniqueValues(customers, dim.extract), [customers, dim]);
  const selected = filters[dim.key];

  function toggle(v) {
    setFilters(prev => {
      const next = { ...prev };
      const cur = new Set(prev[dim.key]);
      if (cur.has(v)) cur.delete(v); else cur.add(v);
      next[dim.key] = cur;
      return next;
    });
  }

  if (values.length === 0) {
    return <p className="text-xs text-ios-tertiary">{t.noResults}</p>;
  }

  return (
    <div className="max-h-60 overflow-y-auto">
      {values.map(v => (
        <label key={v} className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-gray-50 rounded text-sm">
          <input
            type="checkbox"
            checked={selected.has(v)}
            onChange={() => toggle(v)}
          />
          <span className="text-ios-label">{v}</span>
        </label>
      ))}
      <button
        onClick={onClose}
        className="mt-2 w-full text-xs text-brand-600 hover:text-brand-700 py-1 border-t border-gray-100 pt-2"
      >
        {t.close}
      </button>
    </div>
  );
}

function WithinDaysEditor({ filters, setFilters, onClose }) {
  const presets = [7, 30, 60, 90, 180, 365];
  const cur = filters.lastOrderWithinDays;
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-2">{t.lastOrderWithin}</p>
      <div className="flex flex-wrap gap-1">
        {presets.map(d => (
          <button
            key={d}
            onClick={() => { setFilters(p => ({ ...p, lastOrderWithinDays: d })); onClose(); }}
            className={`px-2 py-1 rounded-md text-xs ${cur === d ? 'bg-brand-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-ios-label'}`}
          >
            ≤{d}d
          </button>
        ))}
      </div>
    </div>
  );
}

function MinNumberEditor({ dim, filters, setFilters, onClose }) {
  const cur = filters[dim.key] ?? dim.defaultVal ?? 1;
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-2">{t[dim.labelKey]} ≥</p>
      <input
        type="number"
        value={cur}
        onChange={e => setFilters(p => ({ ...p, [dim.key]: e.target.value === '' ? null : Number(e.target.value) }))}
        className="field-input w-full"
        min={0}
      />
      <button
        onClick={onClose}
        className="mt-2 w-full text-xs text-brand-600 hover:text-brand-700 py-1 border-t border-gray-100 pt-2"
      >
        {t.close}
      </button>
    </div>
  );
}
