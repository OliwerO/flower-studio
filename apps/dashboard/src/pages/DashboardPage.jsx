// DashboardPage — the main control panel with tab navigation.
// Think of it as a factory floor control room: each tab is a different
// monitoring screen (orders, inventory, customers, operations).
// Cross-tab navigation: clicking a widget on Today navigates to the relevant tab with filters.

import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import t from '../translations.js';
import { LangToggle } from '../context/LanguageContext.jsx';
import HelpPanel from '../components/HelpPanel.jsx';

const DayToDayTab = lazy(() => import('../components/DayToDayTab.jsx'));
const OrdersTab = lazy(() => import('../components/OrdersTab.jsx'));
const NewOrderTab = lazy(() => import('../components/NewOrderTab.jsx'));
const StockTab = lazy(() => import('../components/StockTab.jsx'));
const CustomersTab = lazy(() => import('../components/CustomersTab.jsx'));
const ProductsTab = lazy(() => import('../components/ProductsTab.jsx'));
const AdminTab = lazy(() => import('../components/AdminTab.jsx'));
const SettingsTab = lazy(() => import('../components/SettingsTab.jsx'));
const FinancialTab = lazy(() => import('../components/FinancialTab.jsx'));

function TabFallback() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
}

export default function DashboardPage() {
  // TABS defined inside component so the Proxy reads the current language on each render
  const TABS = [
    { key: 'today',     label: t.tabToday },
    { key: 'orders',    label: t.tabOrders },
    { key: 'newOrder',  label: t.tabNewOrder },
    { key: 'stock',     label: t.tabStock },
    { key: 'customers', label: t.tabCustomers },
    { key: 'financial', label: t.tabFinancial },
    { key: 'products', label: t.tabProducts },
    { key: 'admin',    label: '\u26a0 ' + t.tabAdmin },
    { key: 'settings', label: '\u2699 ' + t.tabSettings },
  ];
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('dashboard_tab') || 'today'; } catch { return 'today'; }
  });
  const [mountedTabs, setMountedTabs] = useState(() => {
    try { return new Set([localStorage.getItem('dashboard_tab') || 'today']); }
    catch { return new Set(['today']); }
  });
  const [tabFilter, setTabFilter] = useState(null);
  // Track whether the financial tab has ever been opened, so we only mount
  // the lazy-loaded Recharts bundle on first visit (not on initial page load).
  const [financialMounted, setFinancialMounted] = useState(activeTab === 'financial');
  // filterKey increments on every cross-tab navigation, forcing the target tab
  // to fully remount with a clean state. Without this, React may reuse the
  // previous component instance and old filter state "leaks" across navigations.
  // Think of it like resetting a workstation between different job orders.
  const [filterKey, setFilterKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setMountedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // Called by DayToDayTab / FinancialTab when user clicks a widget
  const navigateTo = useCallback(({ tab, filter }) => {
    setActiveTab(tab);
    setTabFilter(filter || null);
    setFilterKey(k => k + 1);
    if (tab === 'financial') setFinancialMounted(true);
    try { localStorage.setItem('dashboard_tab', tab); } catch {}
  }, []);

  // When user clicks a tab pill manually, clear any navigation filter.
  // Don't increment filterKey here — CSS hiding keeps tabs alive, so we only
  // force remount on cross-tab navigation (navigateTo) with a new filter.
  function handleTabClick(key) {
    setActiveTab(key);
    setTabFilter(null);
    if (key === 'financial') setFinancialMounted(true);
    try { localStorage.setItem('dashboard_tab', key); } catch {}
  }

  function renderMountedTab(key, children) {
    if (!mountedTabs.has(key)) return null;
    return (
      <div style={{ display: activeTab === key ? 'block' : 'none' }}>
        <Suspense fallback={activeTab === key ? <TabFallback /> : null}>
          {children}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Top nav bar */}
      <header className="glass-nav sticky top-0 z-30 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-700">{t.appName}</h1>

        {/* Tab pills */}
        <nav className="flex gap-1 flex-nowrap">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-ios-secondary hover:bg-white/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if ('caches' in window) { const n = await caches.keys(); await Promise.all(n.map(k => caches.delete(k))); }
              if ('serviceWorker' in navigator) { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(s => s.unregister())); }
              try { sessionStorage.clear(); } catch {}
              window.location.href = window.location.pathname + '?_cb=' + Date.now();
            }}
            className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-gray-500
                       hover:bg-gray-200 transition-colors flex items-center justify-center"
            title={t.refresh}
          >&#x21bb;</button>
          <button
            onClick={() => setShowHelp(true)}
            className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-gray-500
                       hover:bg-gray-200 transition-colors flex items-center justify-center"
          >?</button>
          <LangToggle />
        </div>
      </header>

      {/* Tab content mounts on first visit, then stays alive to preserve local state.
           Hidden polling tabs receive isActive=false so they pause background intervals. */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {renderMountedTab('today',
          <DayToDayTab isActive={activeTab === 'today'} onNavigate={navigateTo} />
        )}
        {renderMountedTab('orders',
          <OrdersTab key={filterKey} isActive={activeTab === 'orders'} initialFilter={tabFilter} onNavigate={navigateTo} />
        )}
        {renderMountedTab('newOrder',
          <>
            {/* No key={filterKey}: the wizard must NOT remount when an unrelated
                tab triggers a cross-tab navigation, otherwise an in-progress
                order is wiped. The matchPremadeId effect inside NewOrderTab
                handles Match-Premade re-entries without a remount. */}
            <NewOrderTab
              onNavigate={navigateTo}
              initialFilter={activeTab === 'newOrder' ? tabFilter : null}
            />
          </>
        )}
        {renderMountedTab('stock',
          <StockTab key={filterKey} isActive={activeTab === 'stock'} initialFilter={tabFilter} onNavigate={navigateTo} />
        )}
        {renderMountedTab('customers',
          <CustomersTab key={filterKey} initialFilter={tabFilter} onNavigate={navigateTo} />
        )}
        {renderMountedTab('products',
          <ProductsTab />
        )}
        {renderMountedTab('admin',
          <AdminTab />
        )}
        {renderMountedTab('settings',
          <SettingsTab />
        )}
        {financialMounted && (
          <div style={{ display: activeTab === 'financial' ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <FinancialTab onNavigate={navigateTo} />
            </Suspense>
          </div>
        )}
      </main>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
