// CustomersTab — CRM view for the owner.
// Split-view layout: insights bar up top, then list pane (left) + detail pane (right).

import { useState, useEffect, useMemo, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import CustomerDetailView from './CustomerDetailView.jsx';
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

  // Insights-bar RFM card click: toggle rfmSegment filter
  const toggleRfm = useCallback(segKey => {
    setFilters(prev => ({
      ...prev,
      rfmSegment: prev.rfmSegment === segKey ? null : segKey,
    }));
  }, []);

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

  return (
    <div className="space-y-4">
      {/* Insights bar — unchanged visually; clicks now mutate filter state */}
      {insights?.rfm?.summary && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{t.customerHealth}</p>
          <div className="grid grid-cols-5 gap-3">
            {[
              { key: 'Champions', color: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: '\u2605' },
              { key: 'Loyal',     color: 'bg-blue-50 border-blue-200 text-blue-700', icon: '\u2665' },
              { key: 'At Risk',   color: 'bg-amber-50 border-amber-200 text-amber-700', icon: '\u26A0' },
              { key: 'Lost',      color: 'bg-rose-50 border-rose-200 text-rose-700', icon: '\u2717' },
              { key: 'New',       color: 'bg-purple-50 border-purple-200 text-purple-700', icon: '\u2726' },
            ].map(seg => {
              const count = insights.rfm.summary[seg.key] || 0;
              const rev = insights.rfm.revenue?.[seg.key] || 0;
              const active = filters.rfmSegment === seg.key;
              return (
                <button key={seg.key}
                  onClick={() => toggleRfm(seg.key)}
                  className={`rounded-xl border p-3 text-center transition-all ${seg.color} ${
                    active ? 'ring-2 ring-brand-400 shadow-md' : 'hover:shadow-sm'
                  }`}>
                  <div className="text-lg">{seg.icon}</div>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs font-medium">{t[`rfm${seg.key.replace(' ', '')}`] || seg.key}</div>
                  {rev > 0 && <div className="text-xs opacity-70 mt-0.5">{Math.round(rev)} {t.zl}</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {insights?.acquisitionBySource && Object.keys(insights.acquisitionBySource).length > 0 && (
        <div className="mb-4">
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

      {insights && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Object.entries(insights.segments || {}).map(([seg, count]) => (
            <div key={seg} className="bg-white rounded-2xl shadow-sm px-4 py-3 text-center">
              <p className="text-2xl font-bold text-ios-label">{count}</p>
              <p className={`text-xs font-medium mt-1 inline-block px-2 py-0.5 rounded-full ${
                SEGMENT_COLORS[seg] || 'bg-gray-100 text-gray-600'
              }`}>
                {seg}
              </p>
              {insights.segmentRevenue?.[seg] > 0 && (
                <p className="text-xs text-ios-tertiary mt-1">{Math.round(insights.segmentRevenue[seg])} {t.zl}</p>
              )}
            </div>
          ))}

          {insights.churnRisk?.length > 0 && (
            <div
              onClick={toggleChurn}
              className={`bg-white rounded-2xl shadow-sm px-4 py-3 text-center cursor-pointer hover:bg-ios-orange/10 transition-colors ${
                filters.churnRisk ? 'ring-2 ring-ios-orange' : ''
              }`}>
              <p className="text-2xl font-bold text-ios-orange">{insights.churnRisk.length}</p>
              <p className="text-xs text-ios-orange font-medium mt-1">{t.churnRisk}</p>
              {insights.totalRevenueAtRisk > 0 && (
                <span className="text-xs text-rose-500 font-medium ml-1">
                  {Math.round(insights.totalRevenueAtRisk)} {t.zl} {t.revenueAtRisk}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {loading && <SkeletonTable rows={6} cols={4} />}

      {/* Split view: list pane left, detail pane right (or below on narrow viewports) */}
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
          <div className="bg-white rounded-2xl shadow-sm overflow-auto">
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
    </div>
  );
}
