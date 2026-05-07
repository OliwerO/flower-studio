// BottomNav — fixed tab bar at the bottom of every authenticated screen.
// Owner sees 5 tabs (Orders · Stock · Customers · Wix · More); florists see
// 4 (Orders · Stock · Hours · More). On narrow viewports (<360px) the owner's
// Wix tab drops to the More burger menu so the remaining 4 primary tabs stay
// within comfortable touch reach. Customers ranks ahead of Wix because CRM
// lookups are daily-use; Wix sync is occasional.

import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ClipboardList,
  Package,
  Flower2,
  Clock,
  Menu as MenuIcon,
  Sun,
  Moon,
  RefreshCw,
  LogOut,
  ClipboardCheck,
  HelpCircle,
  Users,
  MessageSquareWarning,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import t from '../translations.js';
import { FeedbackModal } from '@flower-studio/shared';
import client from '../api/client.js';

// Re-introduced after Phase B adds the 5th owner tab. On iPhone SE 1st-gen
// (320px) five 64px tabs don't fit comfortably — the owner's Wix tab moves
// to the More burger so the bar stays at 4 primary tabs.
function useNarrowViewport(threshold = 360) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < threshold : false
  );
  useEffect(() => {
    function onResize() { setNarrow(window.innerWidth < threshold); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return narrow;
}

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, logout } = useAuth();
  const { dark, toggle: toggleDark } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const isOwner = role === 'owner';
  const narrow = useNarrowViewport(360);

  // Owner tabs ordering: Orders · Stock · Customers · Wix. Customers is
  // 3rd (kept on narrow) because the owner uses it daily; Wix is 4th
  // (drops to burger on narrow) because its sync buttons are used
  // occasionally.
  let tabs;
  if (isOwner) {
    const ownerTabs = [
      { key: 'orders',    Icon: ClipboardList, label: t.tabOrders,    path: '/orders' },
      { key: 'stock',     Icon: Package,       label: t.tabStock,     path: '/stock' },
      { key: 'customers', Icon: Users,         label: t.tabCustomers, path: '/customers' },
      { key: 'catalog',   Icon: Flower2,       label: t.tabCatalog,   path: '/catalog/bouquets' },
    ];
    const moreTab = { key: 'more', Icon: MenuIcon, label: t.tabMore, path: null };
    tabs = narrow
      ? [...ownerTabs.slice(0, 3), moreTab]    // 3 primary + More = 4; Wix in burger
      : [...ownerTabs, moreTab];               // 4 primary + More = 5
  } else {
    tabs = [
      { key: 'orders', Icon: ClipboardList, label: t.tabOrders, path: '/orders' },
      { key: 'stock',  Icon: Package,       label: t.tabStock,  path: '/stock' },
      { key: 'hours',  Icon: Clock,         label: t.tabHours,  path: '/hours' },
      { key: 'more',   Icon: MenuIcon,      label: t.tabMore,   path: null },
    ];
  }

  function isActive(tab) {
    if (!tab.path) return false;
    if (tab.key === 'catalog') return location.pathname.startsWith('/catalog');
    return location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');
  }

  function handleTab(tab) {
    if (tab.key === 'more') {
      setMoreOpen(v => !v);
    } else {
      setMoreOpen(false);
      navigate(tab.path);
    }
  }

  async function hardRefresh() {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    try { sessionStorage.clear(); } catch {}
    window.location.href = window.location.pathname + '?_cb=' + Date.now();
  }

  // More menu composition:
  //  - floristOnlyItems: Customers (florist reaches it here, not bottom nav)
  //  - wixWhenNarrow: Wix tab falls here on owner <360px viewports
  //  - ownerOnlyItems: Florist Hours
  //  - baseItems: Stock Evaluation (both roles)
  //  - helpItem: Help (owner only)
  const floristOnlyItems = !isOwner
    ? [{ Icon: Users, label: t.tabCustomers || t.customers || 'Customers', action: () => navigate('/customers') }]
    : [];
  const wixWhenNarrow = (isOwner && narrow)
    ? [{ Icon: Flower2, label: t.tabCatalog, action: () => navigate('/catalog/bouquets') }]
    : [];
  const baseItems = [
    { Icon: ClipboardCheck, label: t.stockEvaluation, action: () => navigate('/stock-evaluation') },
  ];
  const ownerOnlyItems = [
    { Icon: Clock, label: t.floristHours, action: () => navigate('/hours') },
  ];
  const helpItem = isOwner
    ? [{ Icon: HelpCircle, label: t.help || 'Help', action: () => navigate('/orders') }]
    : [];

  const moreItems = [
    { Icon: MessageSquareWarning, label: t.reportButton, action: () => setReportOpen(true) },
    ...floristOnlyItems,
    ...wixWhenNarrow,
    ...(isOwner ? ownerOnlyItems : []),
    ...baseItems,
    ...helpItem,
    { Icon: RefreshCw, label: t.refresh, action: hardRefresh },
    { Icon: LogOut,    label: t.logout, action: logout, destructive: true },
  ];

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-20 left-0 right-0 animate-slide-up safe-area-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-3 mb-2 bg-white dark:bg-dark-elevated rounded-2xl shadow-lg overflow-hidden">
              {moreItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { setMoreOpen(false); item.action(); }}
                  className={`w-full min-h-[48px] flex items-center gap-3 px-5 py-3 text-sm font-medium text-left
                    active:bg-gray-100 dark:active:bg-gray-700
                    ${i > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}
                    ${item.destructive ? 'text-red-500' : 'text-ios-label dark:text-dark-label'}`}
                >
                  <item.Icon size={20} className="shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </button>
              ))}

              {/* Dark mode toggle — separate row because it's a toggle, not a navigation action. */}
              <button
                onClick={toggleDark}
                className="w-full min-h-[48px] flex items-center gap-3 px-5 py-3 text-sm font-medium text-left
                  border-t border-gray-100 dark:border-gray-700
                  active:bg-gray-100 dark:active:bg-gray-700 text-ios-label dark:text-dark-label"
              >
                {dark ? <Sun size={20} className="shrink-0" /> : <Moon size={20} className="shrink-0" />}
                <span className="flex-1">{dark ? (t.lightMode || 'Light mode') : (t.darkMode || 'Dark mode')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar — 64 px tall + safe-area padding. Each tab is min-56 px tall
          which keeps icon + label comfortably above the iOS HIG 44 px target. */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 glass-bar safe-area-bottom">
        <div className="flex items-stretch justify-around max-w-lg mx-auto h-16">
          {tabs.map(tab => {
            const active = isActive(tab);
            return (
              <button
                key={tab.key}
                onClick={() => handleTab(tab)}
                className={`relative flex-1 min-w-[44px] flex flex-col items-center justify-center gap-0.5 active-scale
                  ${active ? 'text-brand-600' : 'text-ios-tertiary dark:text-gray-500'}`}
                aria-label={tab.label}
              >
                <tab.Icon size={22} strokeWidth={active ? 2.25 : 2} />
                <span className={`text-[11px] leading-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                  {tab.label}
                </span>
                {/* Active indicator — a subtle pink bar under the selected tab. */}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-brand-600" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
      {reportOpen && (
        <FeedbackModal
          t={t}
          apiClient={client}
          reporterRole={role}
          reporterName={role === 'owner' ? 'Owner' : 'Florist'}
          appArea="florist"
          onClose={() => setReportOpen(false)}
        />
      )}
    </>
  );
}
