// CustomersTab — CRM view for the owner.
// Split-view layout: insights bar up top, then list pane (left) + detail pane (right).

import { useState, useEffect, useMemo, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import CustomerDetailView from './CustomerDetailView.jsx';
import CustomerDrawer from './CustomerDrawer.jsx';
import CustomerListPane from './CustomerListPane.jsx';
import { SkeletonTable } from './Skeleton.jsx';
import {
  EMPTY_FILTERS,
  serializeFilters,
  deserializeFilters,
} from '../utils/customerFilters.js';

const SEGMENT_COLORS = {
  Constant:         'bg-ios-green/15 text-ios-green',
  New:              'bg-ios-blue/15 text-ios-blue',
  Rare:             'bg-ios-orange/15 text-ios-orange',
  'DO NOT CONTACT': 'bg-ios-red/15 text-ios-red',
};

const FILTERS_KEY = 'dashboard_customer_filters';

export default function CustomersTab({ initialFilter, onNavigate }) {
  const f = initialFilter || {};
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [insights, setInsights]   = useState(null);
  const [selectedId, setSelected] = useState(null);
  const [search, setSearch]       = useState(f.search || '');
  const [filters, setFilters]     = useState(() => {
    try { return deserializeFilters(localStorage.getItem(FILTERS_KEY)); }
    catch { return { ...EMPTY_FILTERS }; }
  });
  const { showToast } = useToast();

  // Fetch all customers once (backend returns full 1094 enriched with _agg)
  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/customers');
      setCustomers(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Insights — powers RFM cards + source pills + churn count
  useEffect(() => {
    client.get('/customers/insights').then(r => setInsights(r.data)).catch(() => {});
  }, []);

  // Wire RFM byCustomer into filter state so filter bar can narrow by RFM segment.
  // Not persisted (rebuilt on every insights fetch).
  useEffect(() => {
    if (insights?.rfm?.byCustomer) {
      setFilters(prev => ({
        ...prev,
        rfmLabelByCustomer: Object.fromEntries(
          Object.entries(insights.rfm.byCustomer).map(([id, v]) => [id, v.label])
        ),
      }));
    }
  }, [insights]);

  // Persist filter state (but not the derived rfmLabelByCustomer map)
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, serializeFilters(filters)); }
    catch { /* localStorage full / denied — non-fatal */ }
  }, [filters]);

  function clearAll() {
    setSearch('');
    setFilters(prev => ({
      ...EMPTY_FILTERS,
      // Keep the derived map so future activations still work
      rfmLabelByCustomer: prev.rfmLabelByCustomer,
    }));
  }

  // Insights-bar source pill click: toggle membership in sources Set
  const toggleSource = useCallback(src => {
    setFilters(prev => {
      const next = new Set(prev.sources);
      if (next.has(src)) next.delete(src); else next.add(src);
      return { ...prev, sources: next };
    });
  }, []);

  // Churn card click: toggle churnRisk filter
  const toggleChurn = useCallback(() => {
    setFilters(prev => ({ ...prev, churnRisk: !prev.churnRisk }));
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedId) || null,
    [customers, selectedId]
  );

  // Toggle membership in the segments Set (same pattern as Acquisition Source).
  // Reuses the existing filters.segments state so the + Filter chip and these
  // pills stay in sync as a single source of truth.
  const toggleSegment = useCallback(seg => {
    setFilters(prev => {
      const next = new Set(prev.segments);
      if (next.has(seg)) next.delete(seg); else next.add(seg);
      return { ...prev, segments: next };
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Acquisition Source pills — click to toggle the 'sources' multi-filter */}
      {insights?.acquisitionBySource && Object.keys(insights.acquisitionBySource).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{t.acquisitionSource}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(insights.acquisitionBySource)
              .sort(([,a], [,b]) => b - a)
              .map(([src, count]) => {
                const active = filters.sources.has(src);
                return (
                  <button key={src}
                    onClick={() => toggleSource(src)}
                    className={`px-3 py-1 rounded-full text-sm transition-all ${
                      active ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-ios-label hover:bg-gray-200'
                    }`}>
                    {src === 'Unknown' ? t.notRecorded : src}{' '}
                    <span className={active ? 'text-white/70' : 'text-ios-tertiary'}>{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Segment (client) pills — click to toggle the 'segments' multi-filter.
           Same interaction model as Acquisition Source for a single mental model. */}
      {insights && Object.keys(insights.segments || {}).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{t.segment}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(insights.segments || {})
              .sort(([,a], [,b]) => b - a)
              .map(([seg, count]) => {
                const active = filters.segments.has(seg);
                const color = SEGMENT_COLORS[seg] || 'bg-gray-100 text-ios-label';
                return (
                  <button key={seg}
                    onClick={() => toggleSegment(seg)}
                    className={`px-3 py-1 rounded-full text-sm transition-all ${
                      active ? 'bg-brand-600 text-white shadow-sm' : `${color} hover:opacity-80`
                    }`}>
                    {seg}{' '}
                    <span className={active ? 'text-white/70' : 'opacity-60'}>{count}</span>
                  </button>
                );
              })}
            {insights.churnRisk?.length > 0 && (
              <button onClick={toggleChurn}
                className={`px-3 py-1 rounded-full text-sm transition-all ${
                  filters.churnRisk ? 'bg-ios-orange text-white shadow-sm' : 'bg-ios-orange/15 text-ios-orange hover:bg-ios-orange/25'
                }`}>
                {t.churnRisk}{' '}
                <span className={filters.churnRisk ? 'text-white/70' : 'opacity-60'}>{insights.churnRisk.length}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {loading && <SkeletonTable rows={6} cols={4} />}

      {/* Desktop split-view (≥1280px): list + inline detail pane side by side.
           Below 1280px the inline detail pane is hidden (xl:block); a
           CustomerDrawer slides in instead — see below. */}
      {!loading && (
        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4" style={{ height: '70vh', minHeight: 500 }}>
          <div className="h-full">
            <CustomerListPane
              customers={customers}
              filters={filters}
              setFilters={setFilters}
              search={search}
              setSearch={setSearch}
              selectedId={selectedId}
              onSelect={setSelected}
              onClearAll={clearAll}
            />
          </div>
          <div className="hidden xl:block bg-white rounded-2xl shadow-sm overflow-auto">
            {selectedCustomer ? (
              <CustomerDetailView
                customerId={selectedCustomer.id}
                onUpdate={fetchCustomers}
                onNavigate={onNavigate}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-ios-tertiary text-sm p-8 text-center">
                {t.selectCustomerToView}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Narrow-viewport drawer (<1280px). Hidden on desktop via xl:hidden
           inside the component, so on wide screens the inline pane above
           handles the detail view. */}
      <CustomerDrawer
        customerId={selectedCustomer?.id || null}
        onUpdate={fetchCustomers}
        onNavigate={onNavigate}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
