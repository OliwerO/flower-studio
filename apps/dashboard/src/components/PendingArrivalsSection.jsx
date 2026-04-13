// PendingArrivalsSection — shows flowers arriving from pending POs
// cross-referenced with committed orders. Desktop table layout.

import { useState, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import t from '../translations.js';

export default function PendingArrivalsSection({ stock, onNavigate }) {
  const [pendingPO, setPendingPO] = useState({});
  const [committed, setCommitted] = useState({});
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    Promise.all([
      client.get('/stock/pending-po'),
      client.get('/stock/committed'),
    ]).then(([poRes, comRes]) => {
      setPendingPO(poRes.data);
      setCommitted(comRes.data);
    }).catch(() => {})
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
      const com = committed[stockId] || { committed: 0, orders: [] };
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
      .sort((a, b) => a.net - b.net); // worst net first
  }, [pendingPO, committed, nameMap]);

  if (loading || rows.length === 0) return null;

  return (
    <div className="mb-4 glass-card overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-50/80"
      >
        <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
          {t.pendingArrivals} ({rows.length})
        </span>
        <span className="text-xs text-indigo-500">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-ios-tertiary uppercase border-b border-indigo-100 bg-indigo-50/40">
                <th className="text-left py-1.5 px-3">{t.stockName}</th>
                <th className="text-right py-1.5 px-2">{t.ordered}</th>
                <th className="text-right py-1.5 px-2">{t.committedToOrders}</th>
                <th className="text-right py-1.5 px-2">{t.netQty}</th>
                <th className="text-left py-1.5 px-2">PO</th>
                <th className="text-left py-1.5 px-2">{t.eta}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <FlowerRow
                  key={row.stockId}
                  row={row}
                  expanded={expandedId === row.stockId}
                  onToggle={() => setExpandedId(expandedId === row.stockId ? null : row.stockId)}
                  onNavigate={onNavigate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FlowerRow({ row, expanded, onToggle, onNavigate }) {
  const netColor = row.net > 0 ? 'text-green-600' : row.net < 0 ? 'text-red-600' : 'text-ios-label';
  const poNumbers = row.pos.map(p => p.number || `PO-${p.id.slice(-4)}`).join(', ');

  return (
    <>
      <tr
        className="border-b border-gray-50 cursor-pointer hover:bg-indigo-50/30 transition-colors"
        onClick={onToggle}
      >
        <td className="py-1.5 px-3 font-medium text-ios-label">
          {row.name}
          {row.orders.length > 0 && (
            <span className="ml-1 text-[9px] text-indigo-500">
              ({row.orders.length} {row.orders.length === 1 ? 'order' : 'orders'})
            </span>
          )}
        </td>
        <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-indigo-600">
          {row.ordered}
        </td>
        <td className="py-1.5 px-2 text-right tabular-nums text-amber-600">
          {row.committed || '—'}
        </td>
        <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${netColor}`}>
          {row.net > 0 ? '+' : ''}{row.net}
        </td>
        <td className="py-1.5 px-2 text-ios-tertiary">{poNumbers}</td>
        <td className="py-1.5 px-2 text-ios-tertiary">{row.plannedDate || '—'}</td>
      </tr>

      {expanded && row.orders.length > 0 && (
        <tr className="bg-amber-50/50">
          <td colSpan={6} className="px-6 py-1.5">
            <div className="space-y-0.5">
              {row.orders.map((o, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[10px] cursor-pointer hover:underline text-amber-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.({ tab: 'orders', filter: { orderId: o.orderId } });
                  }}
                >
                  <span>#{o.appOrderId} — {o.customerName} ({o.requiredBy || '—'})</span>
                  <span className="tabular-nums font-medium">{o.qty} stems</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
