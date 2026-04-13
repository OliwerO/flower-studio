// PendingArrivalsSection — shows flowers arriving from pending POs
// cross-referenced with committed orders. Mobile card layout.

import { useState, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import t from '../translations.js';

export default function PendingArrivalsSection({ stock, committedMap, onOrderClick }) {
  const [pendingPO, setPendingPO] = useState({});
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    client.get('/stock/pending-po')
      .then(r => setPendingPO(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const nameMap = useMemo(() => {
    const m = {};
    for (const s of (stock || [])) m[s.id] = s['Display Name'] || s['Purchase Name'] || '—';
    return m;
  }, [stock]);

  const rows = useMemo(() => {
    const ids = new Set(Object.keys(pendingPO));
    return [...ids].map(stockId => {
      const po = pendingPO[stockId] || { ordered: 0, pos: [] };
      const com = (committedMap || {})[stockId] || { committed: 0, orders: [] };
      const net = po.ordered - com.committed;
      return {
        stockId,
        name: nameMap[stockId] || '—',
        ordered: po.ordered,
        committed: com.committed,
        net,
        pos: po.pos || [],
        orders: com.orders || [],
        plannedDate: po.plannedDate || null,
      };
    }).filter(r => r.ordered > 0)
      .sort((a, b) => a.net - b.net);
  }, [pendingPO, committedMap, nameMap]);

  if (loading || rows.length === 0) return null;

  return (
    <div className="ios-card overflow-hidden mb-3">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-50/80"
      >
        <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
          {t.pendingArrivals}
        </span>
        <span className="text-xs text-indigo-500">
          {rows.length} {t.items || 'items'} {collapsed ? '▼' : '▲'}
        </span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {rows.map(row => (
            <div key={row.stockId}>
              <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer active:bg-indigo-50/30"
                onClick={() => setExpandedId(expandedId === row.stockId ? null : row.stockId)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ios-label truncate">{row.name}</p>
                  <p className="text-[10px] text-ios-tertiary">
                    {row.pos.map(p => p.number || `PO-${p.id.slice(-4)}`).join(', ')}
                    {row.plannedDate ? ` · ${row.plannedDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-indigo-600 tabular-nums">{row.ordered}</p>
                    <p className="text-[9px] text-ios-tertiary">{t.ordered}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-amber-600 tabular-nums">{row.committed || '—'}</p>
                    <p className="text-[9px] text-ios-tertiary">{t.committedToOrders}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-bold tabular-nums ${
                      row.net > 0 ? 'text-green-600' : row.net < 0 ? 'text-red-600' : 'text-ios-label'
                    }`}>
                      {row.net > 0 ? '+' : ''}{row.net}
                    </p>
                    <p className="text-[9px] text-ios-tertiary">{t.netQty}</p>
                  </div>
                </div>
              </div>

              {expandedId === row.stockId && row.orders.length > 0 && (
                <div className="bg-amber-50/50 px-5 py-1.5 space-y-0.5">
                  {row.orders.map((o, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-[10px] text-amber-700 cursor-pointer active:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOrderClick?.(o.orderId);
                      }}
                    >
                      <span>#{o.appOrderId} — {o.customerName} ({o.requiredBy || '—'})</span>
                      <span className="tabular-nums font-medium">{o.qty} {t.stems}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
