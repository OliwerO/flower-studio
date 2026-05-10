// VarietyBackfillTab — Owner-only UI for backfilling Variety attributes
// (Type, Colour, Size, Cultivar) on Stock Items that have type_name IS NULL.
//
// Wire: GET /stock/needs-backfill → row list + banner counts.
//       PATCH /stock/:id/variety-attrs → single-row save.
//       PATCH /stock/variety-attrs/bulk → bulk save.
//       GET /stock/distinct/:column → autocomplete suggestions.
//
// State shape:
//   rows[]       — items from the API; local edits stored in `edits` map
//   edits        — { [id]: { typeName, colour, sizeCm, cultivar } }
//   saving       — Set of ids currently being saved
//   banner       — { total, remaining } refetched after each save
//   suggestions  — { typeName: [], colour: [], sizeCm: [], cultivar: [] }
//   showAll      — when true, completed rows are visible too
//   selected     — Set of selected row ids for bulk edit
//   bulkFilter   — substring filter on display_name for bulk panel

import { useState, useEffect, useCallback, useRef } from 'react';
import t from '../translations.js';
import client from '../api/client.js';

// ── AutocompleteInput ──
// Renders a text input that shows a dropdown of suggestions from the
// /stock/distinct/:column endpoint. Suggestions are fetched once per
// column when the tab mounts and cached in the `suggestions` prop.
// The Owner can type a free-form value not in the list.
function AutocompleteInput({ value, onChange, suggestions = [], placeholder }) {
  const [open, setOpen] = useState(false);
  const [localVal, setLocalVal] = useState(value ?? '');
  const inputRef = useRef(null);

  // Sync when parent resets (e.g. cultivar prefill)
  useEffect(() => { setLocalVal(value ?? ''); }, [value]);

  const filtered = suggestions.filter(s =>
    s && s.toLowerCase().includes((localVal || '').toLowerCase())
  );

  function handleChange(e) {
    setLocalVal(e.target.value);
    onChange(e.target.value || null);
    setOpen(true);
  }

  function pick(val) {
    setLocalVal(val);
    onChange(val);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={localVal}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full text-sm border border-ios-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-ios-border rounded-lg shadow-lg max-h-40 overflow-y-auto text-sm">
          {filtered.map(s => (
            <li
              key={s}
              onMouseDown={() => pick(s)}
              className="px-3 py-2 hover:bg-gray-50 cursor-pointer"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function VarietyBackfillTab() {
  const [rows, setRows]               = useState([]);
  const [banner, setBanner]           = useState({ total: 0, remaining: 0 });
  const [edits, setEdits]             = useState({});
  const [saving, setSaving]           = useState(new Set());
  const [suggestions, setSuggestions] = useState({ typeName: [], colour: [], sizeCm: [], cultivar: [] });
  const [showAll, setShowAll]         = useState(false);
  const [selected, setSelected]       = useState(new Set());
  const [toast, setToast]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [bulkFilter, setBulkFilter]   = useState('');
  const [bulkAttrs, setBulkAttrs]     = useState({ typeName: '', colour: '', sizeCm: '', cultivar: '' });
  const [bulkSaving, setBulkSaving]   = useState(false);

  // cultivarPrefillMap: { cultivar_value: { typeName, colour, sizeCm } }
  // Built from rows that already have a cultivar filled in so selecting an
  // existing cultivar can prefill the other three fields.
  const cultivarPrefillMap = useRef({});

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rowRes, typeRes, colourRes, cultivarRes] = await Promise.all([
        client.get('/stock/needs-backfill', { params: { includeBackfilled: showAll } }),
        client.get('/stock/distinct/typeName'),
        client.get('/stock/distinct/colour'),
        client.get('/stock/distinct/cultivar'),
      ]);
      setRows(rowRes.data.rows);
      setBanner({ total: rowRes.data.total, remaining: rowRes.data.remaining });
      setSuggestions({
        typeName: typeRes.data,
        colour:   colourRes.data,
        sizeCm:   [],  // numeric — no autocomplete
        cultivar: cultivarRes.data,
      });

      // Build prefill map from rows that have both a cultivar and a type_name
      const map = {};
      for (const r of rowRes.data.rows) {
        if (r['Cultivar'] && r['Type']) {
          map[r['Cultivar']] = { typeName: r['Type'], colour: r['Colour'], sizeCm: r['Size'] };
        }
      }
      cultivarPrefillMap.current = map;
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t.error);
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleChange(id, field, value) {
    setEdits(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  }

  function handleCultivarPrefill(id, cultivarVal) {
    const prefill = cultivarPrefillMap.current[cultivarVal];
    if (!prefill) return;
    setEdits(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        typeName: prefill.typeName,
        colour:   prefill.colour ?? null,
        sizeCm:   prefill.sizeCm ?? null,
        cultivar: cultivarVal,
      },
    }));
    showToast(t.backfillCultivarPrefill);
  }

  async function handleSave(id) {
    const edit = edits[id];
    if (!edit?.typeName) { showToast(t.backfillTypeRequired); return; }
    setSaving(prev => new Set([...prev, id]));
    try {
      await client.patch(`/stock/${id}/variety-attrs`, {
        typeName: edit.typeName,
        colour:   edit.colour ?? null,
        sizeCm:   edit.sizeCm ?? null,
        cultivar: edit.cultivar ?? null,
      });
      setEdits(prev => { const next = { ...prev }; delete next[id]; return next; });
      showToast(t.backfillSaved);
      await loadData();
    } catch (err) {
      showToast(err.response?.data?.error || t.backfillSaveFailed);
    } finally {
      setSaving(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(rows.map(r => r.id || r._pgId))); }
  function deselectAll() { setSelected(new Set()); }

  async function handleBulkApply() {
    if (selected.size === 0) { showToast(t.backfillBulkNoneSelected); return; }
    if (!bulkAttrs.typeName) { showToast(t.backfillTypeRequired); return; }
    setBulkSaving(true);
    try {
      const ids = [...selected];
      await client.patch('/stock/variety-attrs/bulk', {
        ids,
        attrs: {
          typeName: bulkAttrs.typeName || null,
          colour:   bulkAttrs.colour   || null,
          sizeCm:   bulkAttrs.sizeCm   ? Number(bulkAttrs.sizeCm) : null,
          cultivar: bulkAttrs.cultivar  || null,
        },
      });
      setSelected(new Set());
      setBulkAttrs({ typeName: '', colour: '', sizeCm: '', cultivar: '' });
      showToast(`${t.backfillBulkApplied} ${ids.length} ${t.backfillBulkRows}`);
      await loadData();
    } catch (err) {
      showToast(err.response?.data?.error || t.backfillSaveFailed);
    } finally {
      setBulkSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-600 text-sm px-4 py-8">{error}</p>;
  }

  const displayedRows = rows.filter(row =>
    !bulkFilter || (row['Display Name'] || '').toLowerCase().includes(bulkFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Status banner */}
      <section className={`rounded-xl px-4 py-3 text-sm font-medium ${
        banner.remaining === 0
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-amber-50 text-amber-800 border border-amber-200'
      }`}>
        {banner.remaining === 0
          ? t.backfillBannerNone
          : `${banner.remaining} ${t.backfillBannerOf} ${banner.total} ${t.backfillBannerRemaining}`}
      </section>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { setShowAll(v => !v); setSelected(new Set()); }}
          className="px-3 py-1.5 text-sm rounded-lg border border-ios-border text-ios-secondary hover:bg-gray-50"
        >
          {showAll ? t.backfillToggleHideAll : t.backfillToggleShowAll}
        </button>
        <button type="button" onClick={selectAll}   className="text-sm text-brand-600 hover:underline">{t.backfillSelectAll}</button>
        <button type="button" onClick={deselectAll} className="text-sm text-ios-secondary hover:underline">{t.backfillDeselectAll}</button>
      </div>

      {/* Bulk-edit panel — visible when at least one row is selected */}
      {selected.size > 0 && (
        <section className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-blue-900">{t.backfillBulkPanel} ({selected.size})</h3>
            <input
              type="text"
              value={bulkFilter}
              onChange={e => setBulkFilter(e.target.value)}
              placeholder={t.backfillBulkFilter}
              className="text-sm border border-blue-200 rounded-lg px-2 py-1 bg-white w-48 focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <AutocompleteInput
              value={bulkAttrs.typeName}
              onChange={v => setBulkAttrs(a => ({ ...a, typeName: v || '' }))}
              suggestions={suggestions.typeName}
              placeholder={t.backfillColType}
            />
            <AutocompleteInput
              value={bulkAttrs.colour}
              onChange={v => setBulkAttrs(a => ({ ...a, colour: v || '' }))}
              suggestions={suggestions.colour}
              placeholder={t.backfillColColour}
            />
            <input
              type="number"
              min="0"
              value={bulkAttrs.sizeCm}
              onChange={e => setBulkAttrs(a => ({ ...a, sizeCm: e.target.value }))}
              placeholder={t.backfillColSize}
              className="text-sm border border-blue-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
            <AutocompleteInput
              value={bulkAttrs.cultivar}
              onChange={v => setBulkAttrs(a => ({ ...a, cultivar: v || '' }))}
              suggestions={suggestions.cultivar}
              placeholder={t.backfillColCultivar}
            />
          </div>
          <button
            type="button"
            onClick={handleBulkApply}
            disabled={bulkSaving || !bulkAttrs.typeName}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-200 disabled:cursor-not-allowed"
          >
            {bulkSaving ? t.backfillBulkApplying : t.backfillBulkApply}
          </button>
        </section>
      )}

      {/* Row table */}
      <section className="bg-white border border-ios-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-ios-secondary uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 w-8" />
              <th className="text-left px-3 py-2">{t.backfillColLegacyName}</th>
              <th className="text-left px-3 py-2">{t.backfillColType}</th>
              <th className="text-left px-3 py-2">{t.backfillColColour}</th>
              <th className="text-left px-3 py-2">{t.backfillColSize}</th>
              <th className="text-left px-3 py-2">{t.backfillColCultivar}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ios-secondary text-sm">
                  {t.backfillBannerNone}
                </td>
              </tr>
            )}
            {displayedRows.map(row => {
              const id = row.id || row._pgId;
              return (
                <tr key={id} className={`border-t border-ios-border ${row['Type'] != null && !edits[id] ? 'bg-green-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggleSelect(id)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-300"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-ios-label">
                    {row['Display Name']}
                  </td>
                  <td className="px-3 py-2 w-36">
                    <AutocompleteInput
                      value={edits[id]?.typeName ?? row['Type'] ?? ''}
                      onChange={v => handleChange(id, 'typeName', v)}
                      suggestions={suggestions.typeName}
                      placeholder={t.backfillColType}
                    />
                  </td>
                  <td className="px-3 py-2 w-32">
                    <AutocompleteInput
                      value={edits[id]?.colour ?? row['Colour'] ?? ''}
                      onChange={v => handleChange(id, 'colour', v)}
                      suggestions={suggestions.colour}
                      placeholder={t.backfillColColour}
                    />
                  </td>
                  <td className="px-3 py-2 w-24">
                    <input
                      type="number"
                      min="0"
                      value={edits[id]?.sizeCm ?? row['Size'] ?? ''}
                      onChange={e => handleChange(id, 'sizeCm', e.target.value ? Number(e.target.value) : null)}
                      placeholder={t.backfillColSize}
                      className="w-full text-sm border border-ios-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                  </td>
                  <td className="px-3 py-2 w-40">
                    <AutocompleteInput
                      value={edits[id]?.cultivar ?? row['Cultivar'] ?? ''}
                      onChange={v => {
                        handleChange(id, 'cultivar', v);
                        if (v) handleCultivarPrefill(id, v);
                      }}
                      suggestions={suggestions.cultivar}
                      placeholder={t.backfillColCultivar}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleSave(id)}
                      disabled={saving.has(id) || !edits[id]?.typeName}
                      className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {saving.has(id) ? t.backfillSaving : t.backfillSave}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
