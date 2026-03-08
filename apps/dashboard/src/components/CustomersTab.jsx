// CustomersTab — CRM view for the owner.
// Like a customer relationship database: search, view profiles,
// track spending patterns, spot churn risks.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import CustomerDetailPanel from './CustomerDetailPanel.jsx';

const SEGMENT_COLORS = {
  Constant:         'bg-ios-green/15 text-ios-green',
  New:              'bg-ios-blue/15 text-ios-blue',
  Rare:             'bg-ios-orange/15 text-ios-orange',
  'DO NOT CONTACT': 'bg-ios-red/15 text-ios-red',
};

export default function CustomersTab({ initialFilter }) {
  const f = initialFilter || {};
  const [customers, setCustomers]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState(f.search || '');
  const [expandedId, setExpanded]   = useState(null);
  const [insights, setInsights]     = useState(null);
  const [showAtRisk, setShowAtRisk] = useState(false);
  const [rfmFilter, setRfmFilter]   = useState(null);
  const [sourceFilter, setSourceFilter] = useState(null);
  const { showToast } = useToast();

  // Search customers — fetches on every search change (including clearing)
  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? { search } : {};
      const res = await client.get('/customers', { params });
      setCustomers(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [search, showToast]);

  // Fetch on mount and when search changes (debounced)
  useEffect(() => {
    const timer = setTimeout(doSearch, 300);
    return () => clearTimeout(timer);
  }, [search, doSearch]);

  // Fetch insights once
  useEffect(() => {
    client.get('/customers/insights').then(r => setInsights(r.data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* RFM Health Cards — auto-scored customer segments */}
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
              return (
                <button key={seg.key}
                  onClick={() => setRfmFilter(rfmFilter === seg.key ? null : seg.key)}
                  className={`rounded-xl border p-3 text-center transition-all ${seg.color} ${
                    rfmFilter === seg.key ? 'ring-2 ring-brand-400 shadow-md' : 'hover:shadow-sm'
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

      {/* Acquisition source pills */}
      {insights?.acquisitionBySource && Object.keys(insights.acquisitionBySource).length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{t.acquisitionSource}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(insights.acquisitionBySource)
              .sort(([,a], [,b]) => b - a)
              .map(([src, count]) => (
                <button key={src}
                  onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                  className={`px-3 py-1 rounded-full text-sm transition-all ${
                    sourceFilter === src
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-gray-100 text-ios-label hover:bg-gray-200'
                  }`}>
                  {src === 'Unknown' ? t.notRecorded : src} <span className={sourceFilter === src ? 'text-white/70' : 'text-ios-tertiary'}>{count}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Insights summary bar */}
      {insights && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Segment distribution */}
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

          {/* Churn risk count — clickable to toggle at-risk list */}
          {insights.churnRisk?.length > 0 && (
            <div
              onClick={() => setShowAtRisk(!showAtRisk)}
              className="bg-white rounded-2xl shadow-sm px-4 py-3 text-center cursor-pointer hover:bg-ios-orange/10 transition-colors">
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

      {/* Top customers */}
      {insights?.topCustomers?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.topCustomers}
          </h3>
          <div className="flex flex-wrap gap-2">
            {insights.topCustomers.slice(0, 10).map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-xs">
                <span className="font-semibold text-brand-700">#{i + 1}</span>
                <span className="text-ios-label">{c.Name || c.Nickname}</span>
                <span className="text-ios-tertiary">{(c['App Total Spend'] || 0).toFixed(0)} {t.zl}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 relative">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search + ' (name, phone, Instagram, email)...'}
          className="field-input w-full pr-8"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 text-xs flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>

      {/* Active filters bar */}
      {(search || rfmFilter || sourceFilter) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] text-ios-tertiary">{t.activeFilters}:</span>
          {search && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
              {t.search}: {search}
              <button onClick={() => setSearch('')} className="ml-0.5 text-brand-400 hover:text-brand-700">×</button>
            </span>
          )}
          {rfmFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
              RFM: {rfmFilter}
              <button onClick={() => setRfmFilter(null)} className="ml-0.5 text-purple-400 hover:text-purple-700">×</button>
            </span>
          )}
          {sourceFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-medium">
              {t.source}: {sourceFilter === 'Unknown' ? t.notRecorded : sourceFilter}
              <button onClick={() => setSourceFilter(null)} className="ml-0.5 text-sky-400 hover:text-sky-700">×</button>
            </span>
          )}
          <button
            onClick={() => { setSearch(''); setRfmFilter(null); setSourceFilter(null); }}
            className="text-xs text-ios-secondary hover:text-ios-red underline"
          >
            {t.clearAll}
          </button>
        </div>
      )}

      {/* At-risk customers list — shown when churn risk card is clicked */}
      {showAtRisk && insights?.churnRisk?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-orange uppercase tracking-wide mb-3">
            {t.atRiskCustomers} — {t.churnRisk}
          </h3>
          <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
            {insights.churnRisk.map(c => (
              <div key={c.id}
                onClick={() => { setExpanded(c.id); setShowAtRisk(false); }}
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors">
                <div>
                  <span className="text-sm font-medium text-ios-label">{c.Name || c.Nickname || '—'}</span>
                  {c.Segment && (
                    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${SEGMENT_COLORS[c.Segment] || 'bg-gray-100 text-gray-600'}`}>
                      {c.Segment}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {c.daysSinceLastOrder && (
                    <span className="text-xs text-ios-orange">{c.daysSinceLastOrder} {t.daysSinceLastOrder}</span>
                  )}
                  <span className="text-sm font-semibold text-ios-label">{(c['App Total Spend'] || 0).toFixed(0)} {t.zl}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Column headers */}
      {!loading && customers.length > 0 && (
        <div className="bg-white/40 rounded-xl px-4 py-2 flex items-center gap-4 text-[11px] text-ios-tertiary font-medium uppercase tracking-wide">
          <span className="w-40">{t.customerName}</span>
          <span className="w-28">{t.nickname}</span>
          <span className="w-28">{t.phone}</span>
          <span className="flex-1">{t.link}</span>
          <span className="w-20 shrink-0">{t.segment}</span>
          <span className="w-24 shrink-0">{t.lastOrder}</span>
          <span className="w-20 text-right shrink-0">{t.totalSpend}</span>
          <span className="w-8 text-right shrink-0">#</span>
          <span className="w-4"></span>
        </div>
      )}

      {/* Customer list */}
      {!loading && customers.length === 0 && search && (
        <div className="text-center py-8 text-ios-tertiary">{t.noResults}</div>
      )}

      {!loading && customers
        .filter(c => c.Name || c.Nickname || c.Phone || (c['App Order Count'] || 0) > 0)
        .filter(c => !rfmFilter || insights?.rfm?.byCustomer?.[c.id]?.label === rfmFilter)
        .filter(c => !sourceFilter || (sourceFilter === 'Unknown' ? !c.Source : c.Source === sourceFilter))
        .map(cust => {
        const isExpanded = expandedId === cust.id;
        const isDNC = cust.Segment === 'DO NOT CONTACT';

        return (
          <div key={cust.id} className={`bg-white rounded-2xl shadow-sm overflow-hidden ${isDNC ? 'ring-2 ring-ios-red/30' : ''}`}>
            <div
              onClick={() => setExpanded(isExpanded ? null : cust.id)}
              className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-white/30 transition-colors"
            >
              <span className="text-sm font-medium text-ios-label w-40 truncate">
                {cust.Name || cust.Nickname || '—'}
              </span>
              {cust.Nickname && cust.Name && (
                <span className="text-xs text-ios-tertiary w-28 truncate">
                  @{cust.Nickname}
                </span>
              )}
              <span className="text-xs text-ios-secondary w-28 truncate">
                {cust.Phone || '—'}
              </span>
              <span className="text-xs text-ios-secondary flex-1 truncate">
                {cust.Link || cust.Email || '—'}
              </span>
              {cust.Segment && (
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
                  SEGMENT_COLORS[cust.Segment] || 'bg-gray-100 text-gray-600'
                }`}>
                  {isDNC ? '\u26D4 ' + t.doNotContact : cust.Segment}
                </span>
              )}
              <span className="w-24 shrink-0">
                {(() => {
                  const dateStr = insights?.lastOrderDates?.[cust.id];
                  if (!dateStr) return <span className="text-ios-tertiary">—</span>;
                  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
                  const color = days > 120 ? 'text-rose-600' : days > 60 ? 'text-amber-600' : 'text-ios-secondary';
                  const label = days === 0 ? t.today : days < 30 ? `${days}d ago` : days < 365 ? `${Math.floor(days/30)}mo ago` : `${Math.floor(days/365)}y ago`;
                  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
                })()}
              </span>
              <span className="text-sm font-semibold text-ios-label w-20 text-right shrink-0">
                {(cust['App Total Spend'] || 0).toFixed(0)} {t.zl}
              </span>
              <span className="text-xs text-ios-tertiary w-8 text-right shrink-0">
                {cust['App Order Count'] || 0}
              </span>
              <span className="text-ios-tertiary text-sm">{isExpanded ? '\u25B2' : '\u25BC'}</span>
            </div>

            {isExpanded && (
              <CustomerDetailPanel
                customerId={cust.id}
                onUpdate={() => { setExpanded(null); doSearch(); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
