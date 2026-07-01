// ExplorerTab — the owner-only linked-record grid (ADR-0010, PRD #485).
//
// A second, human-driven front-end on the SAME query_records engine Ask
// Blossom uses. The tab can only ever emit a validated declarative spec
// (allow-listed entities/fields/ops), so it is safe by construction: no raw
// SQL, no writes. Drilling = a fresh single-hop query seeded by the clicked
// row's key. Editing happens only via deep-links into the real edit screens.
//
// All display logic lives in the shared `explorerSpec` util + `useExplorerQuery`
// hook (both unit-tested); this component is the thin presentation layer.

import { useState, useEffect, useRef, useMemo } from 'react';
import t from '../translations.js';
import {
  useExplorerQuery,
  useLanguage,
  localizeSchema,
  EMPTY_EXPLORER_SPEC,
  resolveColumns,
  buildDrillSpec,
  formatExplorerValue,
  toggleSort,
  getSortDir,
  applyColumnFilter,
  columnFilterValues,
  activeExplorerFilterCount,
  explorerRowsToCsv,
  apiClient,
  ColumnFilterPopover,
} from '@flower-studio/shared';

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
}

// Clickable sort header — mirrors the OrdersTab look (brand ▲/▼ active, faint ⇅ idle).
function SortHeader({ label, dir, onSort }) {
  const active = dir != null;
  return (
    <button
      type="button"
      onClick={onSort}
      className={`group inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
        active ? 'text-brand-600' : 'hover:text-ios-secondary'
      }`}
      title={label}
    >
      <span>{label}</span>
      <span className={`text-[9px] leading-none ${active ? 'text-brand-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  );
}

// Per-column filter form (contains for text, exact for id, range for number/date).
// Local input state resyncs to the applied spec so a global Reset clears it.
function ColumnFilter({ col, spec, onApply }) {
  const cur = columnFilterValues(spec, col.name);
  const curSig = JSON.stringify(cur);
  const [text, setText] = useState(cur.like ?? cur.eq ?? '');
  const [min, setMin] = useState(cur.gte ?? '');
  const [max, setMax] = useState(cur.lte ?? '');

  useEffect(() => {
    setText(cur.like ?? cur.eq ?? '');
    setMin(cur.gte ?? '');
    setMax(cur.lte ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSig]);

  const isRange = col.type === 'number' || col.type === 'date';

  function apply() {
    const entries = [];
    if (isRange) {
      const cast = (v) => (col.type === 'number' ? Number(v) : v);
      if (min !== '' && min != null) entries.push({ field: col.name, op: 'gte', value: cast(min) });
      if (max !== '' && max != null) entries.push({ field: col.name, op: 'lte', value: cast(max) });
    } else if (col.type === 'id') {
      if (text !== '') entries.push({ field: col.name, op: 'eq', value: text });
    } else if (text !== '') {
      entries.push({ field: col.name, op: 'like', value: text });
    }
    onApply(col.name, entries);
  }
  function clear() {
    setText(''); setMin(''); setMax('');
    onApply(col.name, []);
  }

  const inputCls = 'px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs';
  return (
    <div className="space-y-2">
      {isRange ? (
        <div className="flex items-center gap-1">
          <input type={col.type === 'date' ? 'date' : 'number'} value={min} onChange={(e) => setMin(e.target.value)}
            placeholder={t.explorer.from} className={`w-24 ${inputCls}`} />
          <span className="text-xs text-gray-400">–</span>
          <input type={col.type === 'date' ? 'date' : 'number'} value={max} onChange={(e) => setMax(e.target.value)}
            placeholder={t.explorer.to} className={`w-24 ${inputCls}`} />
        </div>
      ) : (
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          placeholder={t.explorer.contains} className={`w-full ${inputCls}`} />
      )}
      <div className="flex gap-1">
        <button onClick={apply} className="flex-1 text-xs bg-brand-600 text-white rounded-lg px-2 py-1">{t.explorer.apply}</button>
        <button onClick={clear} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1">{t.explorer.clear}</button>
      </div>
    </div>
  );
}

const normalizeSpec = (s) => ({ filters: [], sort: [], ...s });

export default function ExplorerTab({ isActive, initialFilter, onNavigate }) {
  const { schema: rawSchema, schemaLoading, schemaError, rows, matchedCount, truncated, loading, error, run } = useExplorerQuery();
  const { lang } = useLanguage();

  const [spec, setSpec] = useState(null);
  const [history, setHistory] = useState([]); // [{ label, spec }] drill breadcrumb
  const [views, setViews] = useState([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const initedRef = useRef(false);
  const viewsRef = useRef(null);

  // Localize entity/field/drill labels to the dashboard language toggle. The
  // spec itself (entities/fields it references) is language-agnostic — only the
  // display labels swap, so re-localizing never re-runs a query.
  const schema = useMemo(() => localizeSchema(rawSchema, lang), [rawSchema, lang]);

  // ── Init once the schema is loaded: use the handoff spec if present, else
  //    default to the first entity. ──
  useEffect(() => {
    if (initedRef.current || schemaLoading || !schema) return;
    initedRef.current = true;
    const seed = initialFilter?.explorerSpec
      ? normalizeSpec(initialFilter.explorerSpec)
      : EMPTY_EXPLORER_SPEC(schema.entities[0]?.key);
    setSpec(seed);
    run(seed);
  }, [schema, schemaLoading, initialFilter, run]);

  useEffect(() => { if (rawSchema) loadViews(); }, [rawSchema]);

  // Close the saved-views dropdown on outside click.
  useEffect(() => {
    if (!viewsOpen) return undefined;
    function onClick(e) { if (viewsRef.current && !viewsRef.current.contains(e.target)) setViewsOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [viewsOpen]);

  async function loadViews() {
    try {
      const { data } = await apiClient.get('/explorer/views');
      setViews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[Explorer] failed to load views:', err);
    }
  }

  function applyAndRun(ns) { setSpec(ns); run(ns); }

  if (schemaLoading || !spec) {
    return schemaError
      ? <div className="p-8 text-center text-red-600">{t.explorer.loadError}: {schemaError}</div>
      : <Spinner />;
  }

  const entities = schema.entities || [];
  const entityByKey = Object.fromEntries(entities.map((e) => [e.key, e]));
  const descriptor = entityByKey[spec.entity];
  const columns = resolveColumns(descriptor, spec);
  const isSummarize = Array.isArray(spec.groupBy) && spec.groupBy.length > 0;
  const groupField = spec.groupBy?.[0] || '';
  const groupCandidates = (descriptor?.fields || []).filter((f) => f.type === 'text' || f.type === 'date');
  const filterCount = activeExplorerFilterCount(spec);
  const entityLabel = (key) => entityByKey[key]?.label || key;

  function changeEntity(key) {
    setHistory([]);
    applyAndRun(EMPTY_EXPLORER_SPEC(key));
  }
  function onSort(name) { applyAndRun(toggleSort(spec, name)); }
  function onApplyFilter(name, entries) { applyAndRun(applyColumnFilter(spec, name, entries)); }
  function resetFilters() { applyAndRun({ ...spec, filters: [] }); }

  function onGroupChange(g) {
    if (!g) applyAndRun({ entity: spec.entity, filters: spec.filters, sort: [] });
    else applyAndRun({
      entity: spec.entity,
      filters: spec.filters,
      groupBy: [g],
      aggregate: [{ fn: 'count', as: 'count' }],
      sort: [{ field: g, dir: 'asc' }],
    });
  }

  function drill(dr, row) {
    const s = buildDrillSpec(dr, row);
    if (!s) return;
    setHistory((h) => [...h, { label: entityLabel(spec.entity), spec }]);
    applyAndRun(normalizeSpec(s));
  }
  function goBack() {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    applyAndRun(prev.spec);
  }

  // Deep-link a row into its real edit screen where one exists.
  function openTarget(row) {
    if (spec.entity === 'orders' && row.id) return { tab: 'orders', filter: { orderId: row.id } };
    if (spec.entity === 'customers' && row.id) return { tab: 'customers', filter: { selectedId: row.id } };
    if ((spec.entity === 'deliveries' || spec.entity === 'order_lines') && row.orderId) return { tab: 'orders', filter: { orderId: row.orderId } };
    return null;
  }

  function downloadCsv() {
    const csv = explorerRowsToCsv(rows, columns);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM → Excel opens UTF-8 correctly
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `explorer-${spec.entity}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveView() {
    const name = saveName.trim();
    if (!name) return;
    setSaveErr('');
    try {
      await apiClient.post('/explorer/views', { name, spec });
      setSaveName('');
      setShowSave(false);
      loadViews();
    } catch (err) {
      setSaveErr(err.response?.data?.error || t.explorer.saveError);
    }
  }
  function loadView(v) {
    setHistory([]);
    setViewsOpen(false);
    applyAndRun(normalizeSpec(v.spec));
  }
  async function deleteView(id) {
    try { await apiClient.delete(`/explorer/views/${id}`); loadViews(); }
    catch (err) { console.error('[Explorer] delete view failed:', err); }
  }
  async function saveRename(id) {
    const name = editTitle.trim();
    setEditingId(null);
    if (!name) return;
    try { await apiClient.patch(`/explorer/views/${id}`, { name }); loadViews(); }
    catch (err) { console.error('[Explorer] rename view failed:', err); }
  }

  const drills = (descriptor?.drills || []);
  const showActions = !isSummarize && (drills.length > 0 || rows.some((r) => openTarget(r)));

  return (
    <div className="pb-10" data-testid="explorer-tab">
      {/* Header */}
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-lg font-bold text-brand-700">{t.explorer.title}</h2>
        <span className="text-xs text-ios-tertiary">{t.explorer.subtitle}</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Entity picker */}
        <label className="text-xs text-ios-secondary">{t.explorer.entity}</label>
        <select
          value={spec.entity}
          onChange={(e) => changeEntity(e.target.value)}
          data-testid="explorer-entity"
          className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm"
        >
          {entities.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>

        {/* Group-by / summarize */}
        <label className="text-xs text-ios-secondary ml-2">{t.explorer.groupBy}</label>
        <select
          value={groupField}
          onChange={(e) => onGroupChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm"
        >
          <option value="">{t.explorer.noGroup}</option>
          {groupCandidates.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
        </select>

        <div className="flex-1" />

        {/* Saved views */}
        <div className="relative" ref={viewsRef}>
          <button
            onClick={() => setViewsOpen((o) => !o)}
            data-testid="explorer-views-toggle"
            className="text-sm px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50"
          >
            {t.explorer.savedViews} ▾
          </button>
          {viewsOpen && (
            <div className="absolute right-0 top-9 z-30 w-64 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 space-y-1">
              {views.length === 0 && <p className="text-xs text-ios-tertiary text-center py-2">{t.explorer.noViews}</p>}
              {views.map((v) => (
                <div key={v.id} className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-gray-100 text-sm">
                  {editingId === v.id ? (
                    <input
                      className="flex-1 border rounded px-1 py-0.5 text-sm min-w-0"
                      value={editTitle}
                      autoFocus
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => saveRename(v.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(v.id); if (e.key === 'Escape') setEditingId(null); }}
                    />
                  ) : (
                    <button className="flex-1 text-left truncate min-w-0" onClick={() => loadView(v)} title={v.name}>{v.name}</button>
                  )}
                  {editingId !== v.id && (
                    <span className="hidden group-hover:flex items-center gap-1 shrink-0">
                      <button aria-label={t.explorer.renameView} className="text-ios-tertiary text-xs px-0.5"
                        onClick={() => { setEditingId(v.id); setEditTitle(v.name); }}>✎</button>
                      <button aria-label={t.explorer.deleteView} className="text-ios-tertiary text-xs px-0.5"
                        onClick={() => deleteView(v.id)}>✕</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save current view */}
        {showSave ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveView(); if (e.key === 'Escape') { setShowSave(false); setSaveErr(''); } }}
              placeholder={t.explorer.viewName}
              data-testid="explorer-save-name"
              className="px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-sm w-40"
            />
            <button onClick={saveView} data-testid="explorer-save-confirm" className="text-sm px-3 py-1.5 rounded-lg bg-brand-600 text-white">{t.explorer.save}</button>
          </div>
        ) : (
          <button onClick={() => setShowSave(true)} data-testid="explorer-save-view" className="text-sm px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">
            {t.explorer.saveView}
          </button>
        )}

        {/* CSV */}
        <button onClick={downloadCsv} disabled={!rows.length} data-testid="explorer-csv"
          className="text-sm px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
          {t.explorer.exportCsv}
        </button>
      </div>

      {saveErr && <p className="text-xs text-red-600 mb-2">{saveErr}</p>}

      {/* Breadcrumb / back */}
      {history.length > 0 && (
        <div className="flex items-center gap-2 mb-2 text-sm">
          <button onClick={goBack} className="text-brand-600 hover:underline">‹ {t.explorer.back}</button>
          <span className="text-ios-tertiary">
            {history.map((h) => h.label).join(' › ')} › <span className="text-ios-label font-medium">{entityLabel(spec.entity)}</span>
          </span>
        </div>
      )}

      {/* Filters summary */}
      {filterCount > 0 && (
        <div className="flex items-center gap-2 mb-2 text-xs">
          <span className="text-ios-secondary">{t.explorer.filters} ({filterCount})</span>
          <button onClick={resetFilters} className="text-brand-600 hover:underline">{t.explorer.reset}</button>
        </div>
      )}

      {error && <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {/* Grid */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white relative">
        {loading && <div className="absolute inset-0 bg-white/60 z-10 flex justify-center pt-8"><div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" /></div>}
        <table className="w-full text-sm" data-testid="explorer-grid">
          <thead>
            <tr className="border-b border-gray-200 text-ios-secondary text-xs">
              {columns.map((col) => {
                const rightAlign = col.type === 'number';
                const filterable = !col.agg && !isSummarize;
                const hasFilter = Object.keys(columnFilterValues(spec, col.name)).length > 0;
                const headLabel = col.agg && col.name === 'count' ? t.explorer.countLabel : col.label;
                return (
                  <th key={col.name} className={`group px-3 py-2 font-medium ${rightAlign ? 'text-right' : 'text-left'}`}>
                    <span className={`inline-flex items-center ${rightAlign ? 'justify-end' : ''}`}>
                      {col.agg
                        ? <span>{headLabel}</span>
                        : <SortHeader label={headLabel} dir={getSortDir(spec, col.name)} onSort={() => onSort(col.name)} />}
                      {filterable && (
                        <ColumnFilterPopover active={hasFilter} title={col.label} align={rightAlign ? 'right' : 'left'}>
                          <ColumnFilter col={col} spec={spec} onApply={onApplyFilter} />
                        </ColumnFilterPopover>
                      )}
                    </span>
                  </th>
                );
              })}
              {showActions && <th className="sticky right-0 z-10 bg-white px-3 py-2 text-right font-medium shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">{t.explorer.drillFrom}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={columns.length + (showActions ? 1 : 0)} className="px-3 py-10 text-center text-ios-tertiary">{t.explorer.noData}</td></tr>
            )}
            {rows.map((row, i) => {
              const target = openTarget(row);
              return (
                <tr key={i} data-testid="explorer-row" className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  {columns.map((col) => (
                    <td key={col.name} className={`px-3 py-2 ${col.type === 'number' ? 'text-right tabular-nums' : ''} ${col.type === 'id' ? 'text-ios-tertiary text-xs font-mono' : 'text-ios-label'}`}>
                      {col.type === 'id'
                        ? <span className="block max-w-[7rem] truncate" title={row[col.key] == null ? '' : String(row[col.key])}>{formatExplorerValue(row[col.key], col.type)}</span>
                        : formatExplorerValue(row[col.key], col.type)}
                    </td>
                  ))}
                  {showActions && (
                    <td className="sticky right-0 z-10 bg-white px-3 py-2 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {drills.map((dr) => {
                          const canDrill = row[dr.localKey] != null && row[dr.localKey] !== '';
                          if (!canDrill) return null;
                          return (
                            <button key={dr.join} onClick={() => drill(dr, row)} title={dr.label}
                              data-testid={`explorer-drill-${dr.join}`}
                              className="text-xs text-brand-600 border border-brand-200 bg-brand-50 rounded-lg px-2 py-0.5 hover:bg-brand-100">
                              {entityLabel(dr.to)} ›
                            </button>
                          );
                        })}
                        {target && onNavigate && (
                          <button onClick={() => onNavigate(target)} title={t.explorer.open}
                            className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-0.5 hover:bg-gray-100">
                            {t.explorer.open}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="mt-2 text-xs text-ios-tertiary">
        {t.explorer.showing} {rows.length} {t.explorer.of} {matchedCount}
        {truncated && <span className="ml-1 text-amber-600">· {t.explorer.truncatedNote}</span>}
      </div>
    </div>
  );
}
