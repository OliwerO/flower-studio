// CustomerListPage — mobile Customer tab entry.
// Loads the enriched customer list (with _agg aggregates) + insights,
// manages filter state with localStorage persistence, and renders
// CustomerListPane. Tap a row → push /customers/:id.
//
// Parallels apps/dashboard/src/components/CustomersTab.jsx at the data
// layer but simpler: no split-view detail pane, no tab-switching
// navigation, no `filterKey` remount tricks. Pure list-then-push.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  EMPTY_FILTERS,
  serializeFilters,
  deserializeFilters,
  IconButton,
} from '@flower-studio/shared';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import CustomerListPane from '../components/CustomerListPane.jsx';
import t from '../translations.js';

// localStorage key intentionally distinct from dashboard's
// 'dashboard_customer_filters' — an owner switching between phone and
// laptop might want different default views on each device.
const FILTERS_KEY = 'florist_customer_filters';

export default function CustomerListPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filters, setFilters]     = useState(() => {
    try {
      return deserializeFilters(localStorage.getItem(FILTERS_KEY));
    } catch {
      return { ...EMPTY_FILTERS };
    }
  });

  // Persist filter state on every change (debounce unnecessary — writes are cheap).
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, serializeFilters(filters));
    } catch { /* quota exceeded — not blocking */ }
  }, [filters]);

  // Fetch customer list + insights in parallel. Insights is used only to
  // populate RFM labels in the filter state (so RFM-pill clicks would work
  // on a future insights bar). Missing insights doesn't block the list.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [custRes, insightsRes] = await Promise.all([
          client.get('/customers'),
          client.get('/customers/insights').catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        setCustomers(custRes.data || []);
        const rfmMap = insightsRes.data?.rfm?.byCustomer;
        if (rfmMap) {
          const flat = {};
          Object.entries(rfmMap).forEach(([id, row]) => { flat[id] = row.label; });
          setFilters(prev => ({ ...prev, rfmLabelByCustomer: flat }));
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err.response?.data?.error || (t.loadError || 'Failed to load'), 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [showToast]);

  const clearAll = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS });
  }, []);

  const onSelect = useCallback((customerId) => {
    navigate(`/customers/${customerId}`);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-ios-bg dark:bg-dark-bg pb-16 flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 glass-nav safe-area-top px-2 py-2 flex items-center gap-2">
        <IconButton onClick={() => navigate('/orders')} ariaLabel={t.back || 'Back'}>
          <ArrowLeft size={22} />
        </IconButton>
        <h1 className="text-base font-semibold text-ios-label dark:text-dark-label flex-1">
          {t.tabCustomers || t.customers || 'Customers'}
        </h1>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <CustomerListPane
          customers={customers}
          filters={filters}
          setFilters={setFilters}
          search={search}
          setSearch={setSearch}
          selectedId={null}
          onSelect={onSelect}
          onClearAll={clearAll}
        />
      )}
    </div>
  );
}
