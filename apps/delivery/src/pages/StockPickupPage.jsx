// StockPickupPage — driver's shopping list for purchase orders.
// Grouped by supplier, each line has a 3-option guided UI:
// Found All (one tap) / Partial (expand) / Not Found (expand).
// Every status change auto-saves to the backend immediately.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';

export default function StockPickupPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [confirmDone, setConfirmDone] = useState(null);

  const fetchOrders = useCallback(async () => {
    try {
      // Fetch POs with lines included — single batch instead of N+1 calls
      const [sentRes, shoppingRes] = await Promise.all([
        client.get('/stock-orders?status=Sent&include=lines'),
        client.get('/stock-orders?status=Shopping&include=lines'),
      ]);
      setOrders([...sentRes.data, ...shoppingRes.data]);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // SSE listener: owner edits lines → driver sees changes in real time
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const pin = client.defaults?.headers?.['X-Auth-PIN'] || '';
    const source = new EventSource(`${backendUrl}/api/events${pin ? `?pin=${pin}` : ''}`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'stock_order_line_updated') fetchOrders();
      } catch {}
    };
    // Fallback poll every 30s if SSE drops
    const interval = setInterval(() => {
      if (!document.hidden) fetchOrders();
    }, 30000);
    return () => { source.close(); clearInterval(interval); };
  }, [fetchOrders]);

  // Auto-save line update
  async function updateLine(orderId, lineId, fields) {
    setSaving(prev => ({ ...prev, [lineId]: true }));
    try {
      await client.patch(`/stock-orders/${orderId}/lines/${lineId}`, fields);
      // Update local state
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

  // Supplier payment — local state on every keystroke, API call only on blur
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
    // Normalize empty string to 0 before saving
    if (payments[supplier] === '') payments[supplier] = 0;
    try {
      await client.patch(`/stock-orders/${orderId}`, {
        'Supplier Payments': JSON.stringify(payments),
      });
    } catch {
      showToast(t.error, 'error');
    }
  }

  // Mark shopping done
  async function completeShopping(orderId) {
    try {
      await client.post(`/stock-orders/${orderId}/driver-complete`);
      showToast(t.doneShopping, 'success');
      setConfirmDone(null);
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
      {/* Header */}
      <header className="glass-nav px-4 pt-3 pb-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <button onClick={() => navigate('/deliveries')} className="text-brand-600 font-medium text-sm">
            ‹ {t.deliveries}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockPickups}</h1>
          <span className="w-16" />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 pb-32 space-y-6">
        {orders.length === 0 ? (
          <p className="text-center text-ios-tertiary py-12">{t.noDeliveries}</p>
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

            const allResolved = order.lines.every(l => l['Driver Status'] && l['Driver Status'] !== 'Pending');

            return (
              <div key={order.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ios-tertiary uppercase">
                    PO #{order['Stock Order ID'] || '—'}
                  </span>
                  {order.Notes && (
                    <span className="text-xs text-ios-secondary truncate">{order.Notes}</span>
                  )}
                </div>

                {Object.entries(bySupplier).map(([supplier, lines]) => (
                  <div key={supplier} className="ios-card overflow-hidden">
                    <div className="bg-brand-50 px-4 py-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-700">{supplier}</span>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {lines.map(line => (
                        <PickupLineItem
                          key={line.id}
                          line={line}
                          orderId={order.id}
                          onUpdate={updateLine}
                          isSaving={saving[line.id]}
                        />
                      ))}
                    </div>

                    {/* Per-supplier payment */}
                    <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
                      <span className="text-xs text-ios-secondary flex-1">
                        {t.totalPaidAt} {supplier}:
                      </span>
                      <input
                        type="number"
                        value={payments[supplier] ?? ''}
                        onChange={e => setLocalPayment(order.id, supplier, e.target.value)}
                        onBlur={() => saveSupplierPayment(order.id, supplier)}
                        placeholder="0"
                        className="w-24 text-right text-sm font-medium border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none"
                      />
                      <span className="text-xs text-ios-tertiary">zł</span>
                    </div>
                  </div>
                ))}

                {/* Done Shopping button */}
                {confirmDone === order.id ? (
                  <div className="ios-card px-4 py-3 space-y-2">
                    <p className="text-sm text-ios-label">{t.doneShoppingConfirm}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => completeShopping(order.id)}
                        className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                      >
                        {t.yes}
                      </button>
                      <button
                        onClick={() => setConfirmDone(null)}
                        className="flex-1 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium"
                      >
                        {t.no}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDone(order.id)}
                    disabled={!allResolved}
                    className="w-full py-3.5 rounded-2xl bg-brand-600 text-white text-base font-semibold
                               disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
                  >
                    {t.doneShopping}
                  </button>
                )}
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}

// Individual line item with 3-option driver flow
function PickupLineItem({ line, orderId, onUpdate, isSaving }) {
  const [expanded, setExpanded] = useState(false);
  const [qtyFound, setQtyFound] = useState(line['Quantity Found'] || '');
  const [lotsFound, setLotsFound] = useState('');
  const [actualLotSize, setActualLotSize] = useState(lotSize);
  const [altFlowerName, setAltFlowerName] = useState(line['Alt Flower Name'] || '');
  const [altSupplier, setAltSupplier] = useState(line['Alt Supplier'] || '');
  const [altQty, setAltQty] = useState(line['Alt Quantity Found'] || '');
  const [showAlt, setShowAlt] = useState(!!line['Alt Supplier'] || !!line['Alt Flower Name']);
  const [note, setNote] = useState(line.Notes || '');

  const status = line['Driver Status'] || 'Pending';
  const needed = line['Quantity Needed'] || 0;
  const lotSize = Number(line['Lot Size']) || 1;
  const lots = lotSize > 1 ? Math.ceil(needed / lotSize) : 0;
  const fullLotQty = lots > 0 ? lots * lotSize : needed;

  function selectStatus(newStatus) {
    if (newStatus === 'Found All') {
      onUpdate(orderId, line.id, { 'Driver Status': 'Found All', 'Quantity Found': fullLotQty });
      setQtyFound(fullLotQty);
      setExpanded(false);
    } else if (newStatus === 'Partial') {
      onUpdate(orderId, line.id, { 'Driver Status': 'Partial' });
      setExpanded(true);
    } else {
      onUpdate(orderId, line.id, { 'Driver Status': 'Not Found', 'Quantity Found': 0 });
      setQtyFound(0);
      setExpanded(true);
    }
  }

  function saveDetails() {
    const fields = {
      'Quantity Found': Number(qtyFound) || 0,
      Notes: note,
    };
    if (showAlt) {
      fields['Alt Flower Name'] = altFlowerName;
      fields['Alt Supplier'] = altSupplier;
      fields['Alt Quantity Found'] = Number(altQty) || 0;
    }
    onUpdate(orderId, line.id, fields);
  }

  const statusColor = status === 'Found All' ? 'bg-emerald-500' :
                      status === 'Partial' ? 'bg-amber-500' :
                      status === 'Not Found' ? 'bg-red-500' : 'bg-gray-300';

  return (
    <div className="px-4 py-3">
      {/* Line header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <span className="text-base font-medium text-ios-label">{line['Flower Name']}</span>
        </div>
        {isSaving && (
          <div className="w-4 h-4 border border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        )}
      </div>

      {/* Quantity needed with lot info */}
      <div className="text-sm text-ios-secondary mb-3">
        {t.need}: <strong>{needed}</strong>
        {lots > 0 && <span className="ml-1">({lots} {t.packs} × {lotSize})</span>}
      </div>

      {/* 3 action buttons — ALWAYS visible, current selection highlighted */}
      <div className="flex gap-2 mb-2">
        <button onClick={() => selectStatus('Found All')}
          className={`flex-1 py-3.5 rounded-xl text-sm font-semibold active-scale transition-all ${
            status === 'Found All'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}>
          ✓ {t.foundAll}
        </button>
        <button onClick={() => selectStatus('Partial')}
          className={`flex-1 py-3.5 rounded-xl text-sm font-semibold active-scale transition-all ${
            status === 'Partial'
              ? 'bg-amber-600 text-white shadow-md'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
          ½ {t.partial}
        </button>
        <button onClick={() => selectStatus('Not Found')}
          className={`flex-1 py-3.5 rounded-xl text-sm font-semibold active-scale transition-all ${
            status === 'Not Found'
              ? 'bg-red-600 text-white shadow-md'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
          ✗ {t.notFound}
        </button>
      </div>

      {/* Expanded details for Partial or Not Found */}
      {expanded && (status === 'Partial' || status === 'Not Found') && (
        <div className={`mt-1 rounded-xl p-3 space-y-3 ${status === 'Partial' ? 'bg-amber-50' : 'bg-red-50'}`}>
          {/* Quantity found — for Partial: lots-based entry */}
          {status === 'Partial' && (
            <div className="space-y-2">
              {lotSize > 1 ? (
                <>
                  <div>
                    <label className="text-xs text-ios-secondary font-medium block mb-1">
                      {t.lotsFound || 'Lots found'} ({t.lotSize}: {actualLotSize})
                    </label>
                    <input
                      type="number"
                      value={lotsFound}
                      onChange={e => {
                        const lots = e.target.value;
                        setLotsFound(lots);
                        const stems = (Number(lots) || 0) * actualLotSize;
                        setQtyFound(stems);
                      }}
                      onBlur={saveDetails}
                      className="w-full text-base border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-ios-secondary font-medium block mb-1">
                        = {t.totalStems || 'Total stems'}
                      </label>
                      <input
                        type="number"
                        value={qtyFound}
                        onChange={e => setQtyFound(e.target.value)}
                        onBlur={saveDetails}
                        className="w-full text-base border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-xs text-ios-secondary font-medium block mb-1">
                        {t.lotSize}
                      </label>
                      <input
                        type="number"
                        value={actualLotSize}
                        onChange={e => {
                          const newSize = Number(e.target.value) || 1;
                          setActualLotSize(newSize);
                          if (lotsFound) setQtyFound((Number(lotsFound) || 0) * newSize);
                        }}
                        onBlur={saveDetails}
                        className="w-full text-base border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs text-ios-secondary font-medium block mb-1">{t.howManyFound}</label>
                  <input
                    type="number"
                    value={qtyFound}
                    onChange={e => setQtyFound(e.target.value)}
                    onBlur={saveDetails}
                    className="w-full text-base border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          )}

          {/* Alt supplier / substitute toggle */}
          <div>
            <label className="text-xs text-ios-secondary font-medium block mb-1">
              {status === 'Not Found' ? t.foundAlternative : t.foundMoreElsewhere}
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowAlt(true)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${showAlt ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200'}`}>
                {t.yes}
              </button>
              <button onClick={() => { setShowAlt(false); setAltFlowerName(''); setAltSupplier(''); setAltQty(''); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${!showAlt ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200'}`}>
                {t.no}
              </button>
            </div>
          </div>

          {showAlt && (
            <div className="space-y-2">
              <input type="text" value={altFlowerName} onChange={e => setAltFlowerName(e.target.value)}
                onBlur={saveDetails} placeholder={t.altFlowerName}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={altSupplier} onChange={e => setAltSupplier(e.target.value)}
                  onBlur={saveDetails} placeholder={t.altSupplier}
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none" />
                <input type="number" value={altQty} onChange={e => setAltQty(e.target.value)}
                  onBlur={saveDetails} placeholder={t.altAmount}
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none" />
              </div>
            </div>
          )}

          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            onBlur={saveDetails} placeholder={t.note}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none" />

          <button onClick={() => setExpanded(false)} className="text-xs text-ios-secondary">
            {t.close || 'Close'}
          </button>
        </div>
      )}
    </div>
  );
}
