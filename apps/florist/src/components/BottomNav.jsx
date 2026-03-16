// BottomNav — fixed tab bar at the bottom of every authenticated screen.
// Replaces the crowded header icon buttons with a clean 4-tab layout.
// Think of it as the main corridor signage in a factory — always visible,
// showing you the 4 most important departments at a glance.
// The "More" tab opens a slide-up menu for less-frequent actions.

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import t from '../translations.js';

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, logout } = useAuth();
  const { dark, toggle: toggleDark } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const isOwner = role === 'owner';

  // Tab configuration differs by role — florists see Hours, owner sees Shopping
  const tabs = isOwner
    ? [
        { key: 'orders',   icon: '📋', label: t.tabOrders,   path: '/orders' },
        { key: 'stock',    icon: '📦', label: t.tabStock,    path: '/stock' },
        { key: 'shopping', icon: '🛒', label: t.tabShopping, path: '/shopping-support' },
        { key: 'more',     icon: '☰',  label: t.tabMore,     path: null },
      ]
    : [
        { key: 'orders', icon: '📋', label: t.tabOrders, path: '/orders' },
        { key: 'stock',  icon: '📦', label: t.tabStock,  path: '/stock' },
        { key: 'hours',  icon: '⏱',  label: t.tabHours,  path: '/hours' },
        { key: 'more',   icon: '☰',  label: t.tabMore,   path: null },
      ];

  function isActive(tab) {
    if (!tab.path) return false;
    // Match exact path or child paths (e.g. /orders/123 → orders tab active)
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

  // "More" menu items differ by role
  const moreItems = isOwner
    ? [
        { label: t.daySummary,    action: () => navigate('/day-summary') },
        { label: t.floristHours,  action: () => navigate('/hours') },
        { label: t.help,          action: () => navigate('/orders') }, // Help handled by HelpPanel on OrderListPage
        { label: t.logout,        action: logout, destructive: true },
      ]
    : [
        { label: t.stockEvaluation || 'Stock Evaluation', action: () => navigate('/stock-evaluation') },
        { label: t.logout,        action: logout, destructive: true },
      ];

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          {/* Semi-transparent backdrop */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Slide-up card */}
          <div
            className="absolute bottom-16 left-0 right-0 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-3 mb-2 bg-white dark:bg-dark-elevated rounded-2xl shadow-lg overflow-hidden">
              {moreItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { setMoreOpen(false); item.action(); }}
                  className={`w-full text-left px-5 py-3.5 text-sm font-medium active:bg-gray-100 dark:active:bg-gray-700
                    ${i > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}
                    ${item.destructive ? 'text-red-500' : 'text-ios-label dark:text-dark-label'}`}
                >
                  {item.label}
                </button>
              ))}

              {/* Dark mode toggle inside More menu */}
              <button
                onClick={toggleDark}
                className="w-full text-left px-5 py-3.5 text-sm font-medium active:bg-gray-100 dark:active:bg-gray-700
                  border-t border-gray-100 dark:border-gray-700 text-ios-label dark:text-dark-label"
              >
                {dark ? '☀️ Light mode' : '🌙 Dark mode'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 glass-bar h-16 safe-area-bottom">
        <div className="flex items-center justify-around h-full max-w-lg mx-auto">
          {tabs.map(tab => {
            const active = isActive(tab);
            return (
              <button
                key={tab.key}
                onClick={() => handleTab(tab)}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full active-scale
                  ${active ? 'text-brand-600' : 'text-ios-tertiary dark:text-gray-500'}`}
              >
                <span className="text-lg leading-none">{tab.icon}</span>
                <span className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
