// DashboardPage — the main control panel with tab navigation.
// Think of it as a factory floor control room: each tab is a different
// monitoring screen (orders, inventory, customers, operations).
// Cross-tab navigation: clicking a widget on Today navigates to the relevant tab with filters.

import { useState, useCallback } from 'react';
import t from '../translations.js';

import OrdersTab from '../components/OrdersTab.jsx';
import StockTab from '../components/StockTab.jsx';
import CustomersTab from '../components/CustomersTab.jsx';
import DayToDayTab from '../components/DayToDayTab.jsx';
import NewOrderTab from '../components/NewOrderTab.jsx';
import FinancialTab from '../components/FinancialTab.jsx';

const TABS = [
  { key: 'today',     label: t.tabToday },
  { key: 'orders',    label: t.tabOrders },
  { key: 'newOrder',  label: t.tabNewOrder },
  { key: 'stock',     label: t.tabStock },
  { key: 'customers', label: t.tabCustomers },
  { key: 'financial', label: t.tabFinancial },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('today');
  const [tabFilter, setTabFilter] = useState(null);
  // filterKey increments on every cross-tab navigation, forcing the target tab
  // to fully remount with a clean state. Without this, React may reuse the
  // previous component instance and old filter state "leaks" across navigations.
  // Think of it like resetting a workstation between different job orders.
  const [filterKey, setFilterKey] = useState(0);

  // Called by DayToDayTab / FinancialTab when user clicks a widget
  const navigateTo = useCallback(({ tab, filter }) => {
    setActiveTab(tab);
    setTabFilter(filter || null);
    setFilterKey(k => k + 1);
  }, []);

  // When user clicks a tab pill manually, clear any navigation filter
  function handleTabClick(key) {
    setActiveTab(key);
    setTabFilter(null);
    setFilterKey(k => k + 1);
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

        <div /> {/* spacer for flex justify-between */}
      </header>

      {/* Tab content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'today'     && <DayToDayTab onNavigate={navigateTo} />}
        {activeTab === 'orders'    && <OrdersTab key={filterKey} initialFilter={tabFilter} />}
        {activeTab === 'newOrder'  && <NewOrderTab onNavigate={navigateTo} />}
        {activeTab === 'stock'     && <StockTab />}
        {activeTab === 'customers' && <CustomersTab key={filterKey} initialFilter={tabFilter} />}
        {activeTab === 'financial' && <FinancialTab onNavigate={navigateTo} />}
      </main>
    </div>
  );
}
