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

export default function CustomersTab() {
  const [customers, setCustomers]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [expandedId, setExpanded]   = useState(null);
  const [insights, setInsights]     = useState(null);
  const { showToast } = useToast();

  // Search customers
  const doSearch = useCallback(async () => {
    if (!search && customers.length > 0) return;
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
      {/* Insights summary bar */}
      {insights && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Segment distribution */}
          {Object.entries(insights.segments || {}).map(([seg, count]) => (
            <div key={seg} className="glass-card px-4 py-3 text-center">
              <p className="text-2xl font-bold text-ios-label">{count}</p>
              <p className={`text-xs font-medium mt-1 inline-block px-2 py-0.5 rounded-full ${
                SEGMENT_COLORS[seg] || 'bg-gray-100 text-gray-600'
              }`}>
                {seg}
              </p>
            </div>
          ))}

          {/* Churn risk count */}
          {insights.churnRisk?.length > 0 && (
            <div className="glass-card px-4 py-3 text-center">
              <p className="text-2xl font-bold text-ios-orange">{insights.churnRisk.length}</p>
              <p className="text-xs text-ios-orange font-medium mt-1">{t.churnRisk}</p>
            </div>
          )}
        </div>
      )}

      {/* Top customers */}
      {insights?.topCustomers?.length > 0 && (
        <div className="glass-card px-4 py-3">
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
      <div className="glass-card px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search + ' (name, phone, Instagram, email)...'}
          className="field-input w-full"
        />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Customer list */}
      {!loading && customers.length === 0 && search && (
        <div className="text-center py-8 text-ios-tertiary">{t.noResults}</div>
      )}

      {!loading && customers.map(cust => {
        const isExpanded = expandedId === cust.id;
        const isDNC = cust.Segment === 'DO NOT CONTACT';

        return (
          <div key={cust.id} className={`glass-card overflow-hidden ${isDNC ? 'ring-2 ring-ios-red/30' : ''}`}>
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
                  {isDNC ? '⛔ ' + t.doNotContact : cust.Segment}
                </span>
              )}
              <span className="text-sm font-semibold text-ios-label w-20 text-right shrink-0">
                {(cust['App Total Spend'] || 0).toFixed(0)} {t.zl}
              </span>
              <span className="text-xs text-ios-tertiary w-8 text-right shrink-0">
                {cust['App Order Count'] || 0}
              </span>
              <span className="text-ios-tertiary text-sm">{isExpanded ? '▲' : '▼'}</span>
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
