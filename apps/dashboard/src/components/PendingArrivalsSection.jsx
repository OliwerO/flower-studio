// PendingArrivalsSection — shows flowers arriving from pending POs
// cross-referenced with committed orders. Matches main stock table styling.

import { useState, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import t from '../translations.js';

function formatPlannedTag(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()}. ${months[d.getMonth()]}.`;
}

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

  // Build name map from stock + pending-po flowerName fallback
  const nameMap = useMemo(() => {
    const m = {};
    for (const s of (stock || [])) m[s.id] = s['Display Name'] || s['Purchase Name'] || '';
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
        name: nameMap[stockId] || po.flowerName || '—',
        ordered: po.ordered,
        committed: com.committed,
        net,
        pos: po.pos || [],
        orders: com.orders || [],
        plannedDate: po.plannedDate || null,
      };
    }).filter(r => r.ordered > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pendingPO, committed, nameMap]);

  if (loading || rows.length === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-indigo-50/60 border-b border-indigo-100"
      >
        <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
          {t.pendingArrivals} ({rows.length})
        </span>
        <span className="text-xs text-indigo-400">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-ios-tertiary border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-2 py-2 font-medium">{t.stockName}</th>
                <th className="text-right px-2 py-2 font-medium">{t.ordered}</th>
                <th className="text-left px-2 py-2 font-medium">{t.eta}</th>
                <th className="text-right px-2 py-2 font-medium">{t.netQty}</th>
                <th className="text-right px-2 py-2 font-medium">{t.committedToOrders}</th>
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
  const plannedTag = formatPlannedTag(row.plannedDate);

  return (
    <>
      <tr
        className={`border-b border-gray-50 cursor-pointer hover:bg-indigo-50/20 transition-colors ${
          row.orders.length > 0 ? '' : ''
        }`}
        onClick={onToggle}
      >
        <td className="px-2 py-2 font-medium text-ios-label">
          {row.name}
        </td>
        <td className="px-2 py-2 text-right tabular-nums font-semibold text-indigo-600">
          {row.ordered}
        </td>
        <td className="px-2 py-2">
          {plannedTag && (
            <span className="inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border-indigo-200">
              {t.planned || 'Planned'} {plannedTag}
            </span>
          )}
        </td>
        <td className={`px-2 py-2 text-right tabular-nums font-semibold ${netColor}`}>
          {row.net > 0 ? '+' : ''}{row.net}
        </td>
        <td className="px-2 py-2 text-right">
          {row.committed > 0 ? (
            <span className="tabular-nums text-amber-600 font-medium">{row.committed}</span>
          ) : (
            <span className="text-ios-tertiary">—</span>
          )}
          {row.orders.length > 0 && (
            <span className="ml-1 text-[9px] text-ios-tertiary">
              ({row.orders.length})
            </span>
          )}
        </td>
      </tr>

      {expanded && row.orders.length > 0 && (
        <tr className="bg-amber-50/50">
          <td colSpan={5} className="px-6 py-1.5">
            <div className="space-y-0.5">
              {row.orders.map((o, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs cursor-pointer hover:underline text-amber-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.({ tab: 'orders', filter: { orderId: o.orderId } });
                  }}
                >
                  <span>#{o.appOrderId} — {o.customerName} ({o.requiredBy || '—'})</span>
                  <span className="tabular-nums font-medium">{o.qty} {t.stems}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
