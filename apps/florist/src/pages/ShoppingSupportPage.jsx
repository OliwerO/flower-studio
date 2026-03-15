// ShoppingSupportPage — owner's real-time view of active purchase orders.
// Think of it as a supervisory control panel: the driver is on the shop floor
// filling the order, and the owner watches progress + fills in data the driver
// can't type (flower names, cost prices, alternatives).
// Polls every 15s, skips lines with focused inputs to avoid clobbering mid-edit.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';

const DRIVER_STATUSES = ['Pending', 'Found All', 'Partial', 'Not Found'];

export default function ShoppingSupportPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  // Track which line IDs have a focused input — skip them during poll refresh
  const focusedLines = useRef(new Set());

  // ── Fetch active POs (same pattern as StockPickupPage) ──
  const fetchOrders = useCallback(async (poll = false) => {
    try {
      const [sentRes, shoppingRes, reviewRes] = await Promise.all([
        client.get('/stock-orders?status=Sent&include=lines'),
        client.get('/stock-orders?status=Shopping&include=lines'),
        client.get('/stock-orders?status=Reviewing&include=lines'),
      ]);
      const fresh = [...sentRes.data, ...shoppingRes.data, ...reviewRes.data];

      if (poll) {
        // Merge: replace lines that aren't being edited, keep focused ones intact
        setOrders(prev => {
          const freshMap = new Map(fresh.map(o => [o.id, o]));
          return prev.map(o => {
            const fo = freshMap.get(o.id);
            if (!fo) return o;
            return {
              ...fo,
              lines: fo.lines.map(fl => {
                if (focusedLines.current.has(fl.id)) {
                  // Keep local version for lines being edited
                  const local = o.lines.find(l => l.id === fl.id);
                  return local || fl;
                }
                return fl;
              }),
            };
          }).concat(
            // Add any new POs that weren't in previous state
            fresh.filter(fo => !prev.some(o => o.id === fo.id))
          );
        });
      } else {
        setOrders(fresh);
      }
    } catch {
      if (!poll) showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // SSE listener for real-time updates from driver/owner + fallback poll every 30s
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const pin = client.defaults?.headers?.['X-Auth-PIN'] || '';
    const source = new EventSource(`${backendUrl}/api/events${pin ? `?pin=${pin}` : ''}`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (['stock_order_line_updated', 'stock_review_ready', 'stock_evaluation_ready'].includes(data.type)) {
          fetchOrders(true);
        }
      } catch {}
    };
    // Fallback poll every 30s in case SSE drops
    const interval = setInterval(() => {
      if (!document.hidden) fetchOrders(true);
    }, 30000);
    const onVisible = () => { if (!document.hidden) fetchOrders(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      source.close();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchOrders]);

  // ── Auto-save a line field on blur ──
  async function updateLine(orderId, lineId, fields) {
    setSaving(prev => ({ ...prev, [lineId]: true }));
    try {
      await client.patch(`/stock-orders/${orderId}/lines/${lineId}`, fields);
      setOrders(prev => prev.map(o => o.id === orderId ? {
        ...o,
        lines: o.lines.map(l => l.id === lineId ? { ...l, ...fields } : l),
      } : o));
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSaving(prev => ({ ...prev, [lineId]: false }));
    }
  }

  // ── Supplier payment (keystroke → local, blur → API) ──
  function setLocalPayment(orderId, supplier, amount) {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      let payments = {};
      try { payments = JSON.parse(o['Supplier Payments'] || '{}'); } catch {}
      payments[supplier] = amount === '' ? '' : Number(amount) || 0;
      return { ...o, 'Supplier Payments': JSON.stringify(payments) };
    }));
  }

  async function saveSupplierPayment(orderId, supplier) {
    const order = orders.find(o => o.id === orderId);
    let payments = {};
    try { payments = JSON.parse(order['Supplier Payments'] || '{}'); } catch {}
    if (payments[supplier] === '') payments[supplier] = 0;
    try {
      await client.patch(`/stock-orders/${orderId}`, {
        'Supplier Payments': JSON.stringify(payments),
      });
    } catch {
      showToast(t.error, 'error');
    }
  }

  async function approveReview(orderId) {
    try {
      await client.post(`/stock-orders/${orderId}/approve-review`);
      showToast(t.stockOrderApproved || 'Sent to florist for evaluation');
      fetchOrders();
    } catch {
      showToast(t.error, 'error');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ios-bg">
      {/* Header — compact for phone */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-sm">
            ‹ {t.navOrders}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.shopping.title}</h1>
          <button
            onClick={() => fetchOrders()}
            className="text-brand-600 text-sm font-medium"
          >↻</button>
        </div>
      </header>

      <main className="px-4 py-4 pb-32 space-y-6">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-2">🛒</p>
            <p className="text-ios-tertiary text-sm">{t.shopping.empty}</p>
          </div>
        ) : (
          orders.map(order => {
            // Group lines by supplier
            const bySupplier = {};
            for (const line of order.lines) {
              const sup = line.Supplier || '—';
              if (!bySupplier[sup]) bySupplier[sup] = [];
              bySupplier[sup].push(line);
            }

            let payments = {};
            try { payments = JSON.parse(order['Supplier Payments'] || '{}'); } catch {}

            return (
              <div key={order.id} className="space-y-3">
                {/* PO info bar */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ios-tertiary uppercase">
                    PO #{order['Stock Order ID'] || '—'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      order.Status === 'Shopping' ? 'bg-amber-100 text-amber-700' :
                      order.Status === 'Reviewing' ? 'bg-orange-100 text-orange-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {order.Status}
                    </span>
                    {order.Status === 'Reviewing' && (
                      <button
                        onClick={() => approveReview(order.id)}
                        className="px-3 py-1 rounded-xl bg-purple-600 text-white text-xs font-semibold active-scale"
                      >{t.shopping.sendToFlorist || 'Send to florist'}</button>
                    )}
                  </div>
                </div>
                {order['Assigned Driver'] && (
                  <p className="text-xs text-ios-secondary -mt-1">
                    {t.shopping.driver}: {order['Assigned Driver']}
                  </p>
                )}

                {Object.entries(bySupplier).map(([supplier, lines]) => (
                  <div key={supplier} className="ios-card overflow-hidden">
                    {/* Supplier header */}
                    <div className="bg-brand-50 px-4 py-2">
                      <span className="text-sm font-semibold text-brand-700">{supplier}</span>
                    </div>

                    {/* Lines */}
                    <div className="divide-y divide-gray-100">
                      {lines.map(line => (
                        <ShoppingLineItem
                          key={line.id}
                          line={line}
                          orderId={order.id}
                          onUpdate={updateLine}
                          isSaving={saving[line.id]}
                          onFocus={() => focusedLines.current.add(line.id)}
                          onBlurLine={() => focusedLines.current.delete(line.id)}
                        />
                      ))}
                    </div>

                    {/* Per-supplier payment */}
                    <div className="px-4 py-3 bg-gray-50">
                      <label className="text-xs text-ios-secondary mb-1 block">
                        {t.shopping.paidTo} {supplier}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={payments[supplier] ?? ''}
                          onChange={e => setLocalPayment(order.id, supplier, e.target.value)}
                          onBlur={() => saveSupplierPayment(order.id, supplier)}
                          placeholder="0"
                          className="flex-1 text-sm font-medium border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                        />
                        <span className="text-sm text-ios-tertiary">zł</span>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Driver payment for this PO */}
                <div className="ios-card px-4 py-3">
                  <label className="text-xs text-ios-secondary mb-1 block">
                    {t.shopping.driverPayment || 'Driver payment'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={order['Driver Payment'] ?? ''}
                      onChange={e => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, 'Driver Payment': e.target.value } : o))}
                      onBlur={async () => {
                        try {
                          await client.patch(`/stock-orders/${order.id}`, {
                            'Driver Payment': Number(order['Driver Payment']) || 0,
                          });
                        } catch { showToast(t.error, 'error'); }
                      }}
                      placeholder="0"
                      className="flex-1 text-sm font-medium border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                    />
                    <span className="text-sm text-ios-tertiary">zł</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}

// ── Individual line — always-visible editable fields (no expand/collapse) ──
// On a phone this stacks vertically: flower info → status pills → inputs
function ShoppingLineItem({ line, orderId, onUpdate, isSaving, onFocus, onBlurLine }) {
  const [local, setLocal] = useState({
    qtyFound:     line['Quantity Found'] ?? '',
    costPrice:    line['Cost Price'] ?? '',
    altFlower:    line['Alt Flower Name'] || '',
    altSupplier:  line['Alt Supplier'] || '',
    altQty:       line['Alt Quantity Found'] ?? '',
    altCost:      line['Alt Cost'] ?? '',
    notes:        line.Notes || '',
  });

  // Sync from upstream when line prop changes (poll refresh)
  const lineRef = useRef(line);
  useEffect(() => {
    if (lineRef.current !== line) {
      lineRef.current = line;
      setLocal({
        qtyFound:     line['Quantity Found'] ?? '',
        costPrice:    line['Cost Price'] ?? '',
        altFlower:    line['Alt Flower Name'] || '',
        altSupplier:  line['Alt Supplier'] || '',
        altQty:       line['Alt Quantity Found'] ?? '',
        notes:        line.Notes || '',
      });
    }
  }, [line]);

  const status = line['Driver Status'] || 'Pending';
  const needed = line['Quantity Needed'] || 0;
  const lotSize = Number(line['Lot Size']) || 1;
  const lots = lotSize > 1 ? Math.ceil(needed / lotSize) : 0;

  const statusColor = status === 'Found All' ? 'bg-emerald-100 text-emerald-700' :
                      status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                      status === 'Not Found' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-500';

  const statusLabel = status === 'Found All' ? t.shopping.foundAll :
                      status === 'Partial' ? t.shopping.partial :
                      status === 'Not Found' ? t.shopping.notFound :
                      t.shopping.pending;

  function handleChange(key, value) {
    setLocal(prev => ({ ...prev, [key]: value }));
  }

  function handleBlur(fieldMap) {
    onBlurLine();
    onUpdate(orderId, line.id, fieldMap);
  }

  function handleStatusOverride(newStatus) {
    // Save any pending local edits before changing status
    const pendingFields = {
      'Quantity Found': Number(local.qtyFound) || 0,
      'Cost Price': Number(local.costPrice) || 0,
      'Alt Flower Name': local.altFlowerName || '',
      'Alt Supplier': local.altSupplier || '',
      'Alt Quantity Found': Number(local.altQty) || 0,
      Notes: local.notes || '',
      'Driver Status': newStatus,
    };
    if (newStatus === 'Found All') {
      const fullQty = lots > 0 ? lots * lotSize : needed;
      pendingFields['Quantity Found'] = fullQty;
      setLocal(prev => ({ ...prev, qtyFound: fullQty }));
    }
    onBlurLine();
    onUpdate(orderId, line.id, pendingFields);
  }

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Line header: flower name + qty + saving indicator */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ios-label truncate">{line['Flower Name']}</p>
          <p className="text-xs text-ios-tertiary">
            {t.shopping.need}: {needed}
            {lots > 0 && ` — ${lots} ${t.packs} × ${lotSize}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSaving && (
            <div className="w-4 h-4 border border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Driver Status override — pill buttons */}
      <div className="flex gap-1.5">
        {DRIVER_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => handleStatusOverride(s)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium active-scale transition-colors ${
              status === s
                ? s === 'Found All' ? 'bg-emerald-500 text-white' :
                  s === 'Partial' ? 'bg-amber-500 text-white' :
                  s === 'Not Found' ? 'bg-red-500 text-white' :
                  'bg-gray-400 text-white'
                : 'bg-gray-100 text-ios-secondary'
            }`}
          >
            {s === 'Found All' ? '✓' : s === 'Partial' ? '½' : s === 'Not Found' ? '✗' : '⏳'}
          </button>
        ))}
      </div>

      {/* Editable fields — always visible, stacked for phone */}
      <div className="space-y-2">
        {/* Qty Found + Cost Price — two compact rows */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.qtyFound}</label>
            <input
              type="number"
              inputMode="numeric"
              value={local.qtyFound}
              onChange={e => handleChange('qtyFound', e.target.value)}
              onFocus={onFocus}
              onBlur={() => handleBlur({ 'Quantity Found': Number(local.qtyFound) || 0 })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.costPrice}</label>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                value={local.costPrice}
                onChange={e => handleChange('costPrice', e.target.value)}
                onFocus={onFocus}
                onBlur={() => handleBlur({ 'Cost Price': local.costPrice === '' ? '' : Number(local.costPrice) || 0 })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8 bg-white outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ios-tertiary">zł</span>
            </div>
          </div>
        </div>

        {/* ── Alternative supplier block — separate visual section ── */}
        {(local.altFlower || local.altSupplier || Number(local.altQty) > 0 || status === 'Partial' || status === 'Not Found') && (
          <div className="bg-indigo-50 rounded-xl px-3 py-2.5 space-y-2 border border-indigo-100">
            <p className="text-[10px] text-indigo-600 uppercase font-semibold tracking-wide">
              {t.shopping.altSection || 'Alternative supplier'}
            </p>
            <div>
              <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.altFlower}</label>
              <input
                type="text"
                value={local.altFlower}
                onChange={e => handleChange('altFlower', e.target.value)}
                onFocus={onFocus}
                onBlur={() => handleBlur({ 'Alt Flower Name': local.altFlower })}
                placeholder={t.shopping.altFlowerHint}
                className="w-full text-sm border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.altSupplier}</label>
                <input
                  type="text"
                  value={local.altSupplier}
                  onChange={e => handleChange('altSupplier', e.target.value)}
                  onFocus={onFocus}
                  onBlur={() => handleBlur({ 'Alt Supplier': local.altSupplier })}
                  className="w-full text-sm border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.altQty}</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={local.altQty}
                  onChange={e => handleChange('altQty', e.target.value)}
                  onFocus={onFocus}
                  onBlur={() => handleBlur({ 'Alt Quantity Found': Number(local.altQty) || 0 })}
                  className="w-full text-sm border border-indigo-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                />
              </div>
            </div>
            {/* Pre-filled cost = known cost × alt qty (editable) */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.altCost || 'Alt cost total'}</label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={local.altCost ?? (Number(local.costPrice || 0) * Number(local.altQty || 0) || '')}
                    onChange={e => handleChange('altCost', e.target.value)}
                    onFocus={onFocus}
                    onBlur={() => handleBlur({ 'Alt Cost': local.altCost === '' ? '' : Number(local.altCost) || 0 })}
                    placeholder={(Number(local.costPrice || 0) * Number(local.altQty || 0)).toFixed(0) || '0'}
                    className="w-full text-sm border border-indigo-200 rounded-xl px-3 py-2.5 pr-8 bg-white outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ios-tertiary">zł</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-[10px] text-ios-tertiary uppercase mb-0.5 block">{t.shopping.notes}</label>
          <input
            type="text"
            value={local.notes}
            onChange={e => handleChange('notes', e.target.value)}
            onFocus={onFocus}
            onBlur={() => handleBlur({ Notes: local.notes })}
            placeholder={t.shopping.notesHint}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
          />
        </div>
      </div>
    </div>
  );
}
