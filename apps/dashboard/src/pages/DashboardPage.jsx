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

const TABS = [
  { key: 'today',     label: t.tabToday },
  { key: 'orders',    label: t.tabOrders },
  { key: 'newOrder',  label: t.tabNewOrder },
  { key: 'stock',     label: t.tabStock },
  { key: 'customers', label: t.tabCustomers },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('today');
  const [tabFilter, setTabFilter] = useState(null);

  // Called by DayToDayTab when user clicks a widget
  const navigateTo = useCallback(({ tab, filter }) => {
    setActiveTab(tab);
    setTabFilter(filter || null);
  }, []);

  // When user clicks a tab pill manually, clear any navigation filter
  function handleTabClick(key) {
    setActiveTab(key);
    setTabFilter(null);
  }

  return (
    <div className="min-h-screen">
      {/* Top nav bar */}
      <header className="glass-nav sticky top-0 z-30 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-700">{t.appName}</h1>

        {/* Tab pills */}
        <nav className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
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
        {activeTab === 'orders'    && <OrdersTab initialFilter={tabFilter} />}
        {activeTab === 'newOrder'  && <NewOrderTab onNavigate={navigateTo} />}
        {activeTab === 'stock'     && <StockTab />}
        {activeTab === 'customers' && <CustomersTab />}
      </main>
    </div>
  );
}
