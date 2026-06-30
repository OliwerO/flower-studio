// DashboardPage — the main control panel with tab navigation.
// Think of it as a factory floor control room: each tab is a different
// monitoring screen (orders, inventory, customers, operations).
// Cross-tab navigation: clicking a widget on Today navigates to the relevant tab with filters.

import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import t from '../translations.js';
import { LangToggle } from '../context/LanguageContext.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import { FeedbackModal, AskBlossomLauncher } from '@flower-studio/shared';

const DayToDayTab = lazy(() => import('../components/DayToDayTab.jsx'));
const OrdersTab = lazy(() => import('../components/OrdersTab.jsx'));
const NewOrderTab = lazy(() => import('../components/NewOrderTab.jsx'));
const StockTab = lazy(() => import('../components/StockTab.jsx'));
const CustomersTab = lazy(() => import('../components/CustomersTab.jsx'));
const ProductsTab = lazy(() => import('../components/ProductsTab.jsx'));
const AdminTab = lazy(() => import('../components/AdminTab.jsx'));
const SettingsTab = lazy(() => import('../components/SettingsTab.jsx'));
const VarietyBackfillTab = lazy(() => import('../components/VarietyBackfillTab.jsx'));
const FinancialTab = lazy(() => import('../components/FinancialTab.jsx'));
const IssuesTab = lazy(() => import('../components/IssuesTab.jsx'));
// Modals opened from the new-order speed-dial FAB (bottom-right). Lazy so
// neither the AI paste-import nor the premade builder weighs on initial load.
const TextImportModal = lazy(() => import('../components/TextImportModal.jsx'));
const PremadeBouquetCreateModal = lazy(() => import('../components/PremadeBouquetCreateModal.jsx'));
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
    // New Order is no longer a top pill — it's reached via the bottom-right
    // speed-dial FAB (matching the florist app). The 'newOrder' tab content is
    // still rendered below; only its nav pill was removed.
    { key: 'stock',     label: t.tabStock },
    { key: 'customers', label: t.tabCustomers },
    { key: 'financial', label: t.tabFinancial },
    { key: 'products', label: t.tabProducts },
    { key: 'issues',   label: t.tabIssues },
    { key: 'admin',    label: '\u26a0 ' + t.tabAdmin },
    { key: 'backfill', label: t.tabBackfill },
    { key: 'settings', label: '\u2699 ' + t.tabSettings },
  ];
  // Guard against a stale persisted tab that no longer exists (e.g. the removed
  // 'assistant' tab — now the floating launcher) so the owner doesn't land on a
  // blank content area after this deploy.
  const initialTab = () => {
    try { const s = localStorage.getItem('dashboard_tab'); return s && s !== 'assistant' ? s : 'today'; }
    catch { return 'today'; }
  };
  const [activeTab, setActiveTab] = useState(initialTab);
  const [mountedTabs, setMountedTabs] = useState(() => new Set([initialTab()]));
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
  const [reportOpen, setReportOpen] = useState(false);
  // New-order speed-dial FAB (bottom-right) — mirrors the florist app's FAB.
  const [fabOpen, setFabOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPremadeCreate, setShowPremadeCreate] = useState(false);

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
          <button
            onClick={() => setReportOpen(true)}
            className="text-xs font-medium h-7 px-2.5 rounded-lg bg-gray-100 text-gray-500
                       hover:bg-gray-200 transition-colors flex items-center gap-1.5"
            title={t.reportButton}
          >
            <span className="text-xs">!</span>
            <span className="hidden sm:inline text-xs">{t.reportButton}</span>
          </button>
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
        {renderMountedTab('issues',
          <IssuesTab />
        )}
        {renderMountedTab('admin',
          <AdminTab />
        )}
        {renderMountedTab('backfill',
          <VarietyBackfillTab />
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
      {reportOpen && (
        <FeedbackModal
          t={t}
          reporterRole="owner"
          reporterName="Owner"
          appArea="dashboard"
          onClose={() => setReportOpen(false)}
        />
      )}
      {/* New-order speed-dial FAB — tap "+" to expand into paste-import /
          premade / manual, matching the florist app's OrderListPage FAB.
          Sits where the Ask Blossom launcher used to be (bottom-right); the
          launcher is stacked above it so both stay tappable. */}
      {fabOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {fabOpen && (
          <>
            {/* Paste import option */}
            <button
              onClick={() => { setFabOpen(false); setShowImport(true); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active:scale-95 transition-transform"
            >
              <span className="text-sm font-semibold text-ios-label">{t.intake.fabLabel}</span>
              <span className="w-10 h-10 rounded-full bg-amber-500 text-white text-lg flex items-center justify-center">📋</span>
            </button>
            {/* Premade bouquet option — compose without a customer */}
            <button
              onClick={() => { setFabOpen(false); setShowPremadeCreate(true); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active:scale-95 transition-transform"
            >
              <span className="text-sm font-semibold text-ios-label">{t.fabPremade}</span>
              <span className="w-10 h-10 rounded-full bg-pink-500 text-white text-lg flex items-center justify-center">💐</span>
            </button>
            {/* Manual new order option */}
            <button
              onClick={() => { setFabOpen(false); navigateTo({ tab: 'newOrder' }); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active:scale-95 transition-transform"
            >
              <span className="text-sm font-semibold text-ios-label">{t.intake.fabManual}</span>
              <span className="w-10 h-10 rounded-full bg-brand-600 text-white text-lg flex items-center justify-center">✏️</span>
            </button>
          </>
        )}
        {/* Main FAB */}
        <button
          onClick={() => setFabOpen(v => !v)}
          className={`w-14 h-14 bg-brand-600 text-white text-3xl rounded-full shadow-lg
                     flex items-center justify-center active:bg-brand-700 active:scale-95
                     transition-transform duration-200 ${fabOpen ? 'rotate-45' : ''}`}
          aria-label={t.newOrder}
        >
          +
        </button>
      </div>

      {/* Paste-import modal → AI parse → prefill the New Order wizard */}
      {showImport && (
        <Suspense fallback={null}>
          <TextImportModal
            onClose={() => setShowImport(false)}
            onParsed={(draft) => navigateTo({ tab: 'newOrder', filter: { importDraft: draft } })}
          />
        </Suspense>
      )}

      {/* Premade bouquet builder */}
      {showPremadeCreate && (
        <Suspense fallback={null}>
          <PremadeBouquetCreateModal
            onClose={() => setShowPremadeCreate(false)}
            onCreated={() => setShowPremadeCreate(false)}
          />
        </Suspense>
      )}

      {/* bottom-24 (not bottom-6): the new-order FAB now occupies bottom-6 right-6,
          so stack the assistant above it — same pattern as the florist app. */}
      <AskBlossomLauncher t={t} fabClassName="bottom-24 right-6" reporterRole="owner" reporterName="Owner" appArea="dashboard" />
    </div>
  );
}
