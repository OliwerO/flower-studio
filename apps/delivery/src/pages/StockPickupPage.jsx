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

  function handleFoundAll() {
    onUpdate(orderId, line.id, {
      'Driver Status': 'Found All',
      'Quantity Found': fullLotQty,
    });
    setExpanded(false);
  }

  function handlePartial() {
    setExpanded(true);
    onUpdate(orderId, line.id, { 'Driver Status': 'Partial' });
  }

  function handleNotFound() {
    setExpanded(true);
    onUpdate(orderId, line.id, {
      'Driver Status': 'Not Found',
      'Quantity Found': 0,
    });
  }

  function savePartialDetails() {
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

  function saveNotFoundDetails() {
    const fields = { Notes: note };
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
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-sm font-medium text-ios-label">{line['Flower Name']}</span>
          <span className="text-xs text-ios-tertiary">
            ({t.need}: {needed})
            {lots > 0 && <span className="ml-1 font-medium text-ios-secondary">— {lots} {t.packs} × {lotSize}</span>}
          </span>
        </div>
        {isSaving && (
          <div className="w-4 h-4 border border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        )}
      </div>

      {/* 3-option buttons */}
      {status === 'Pending' && (
        <div className="flex gap-2">
          <button onClick={handleFoundAll}
            className="flex-1 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-semibold active-scale">
            ✓ {t.foundAll}
          </button>
          <button onClick={handlePartial}
            className="flex-1 py-2 rounded-xl bg-amber-100 text-amber-700 text-xs font-semibold active-scale">
            ½ {t.partial}
          </button>
          <button onClick={handleNotFound}
            className="flex-1 py-2 rounded-xl bg-red-100 text-red-700 text-xs font-semibold active-scale">
            ✗ {t.notFound}
          </button>
        </div>
      )}

      {/* Status badge for resolved items */}
      {status !== 'Pending' && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            status === 'Found All' ? 'bg-emerald-100 text-emerald-700' :
            status === 'Partial' ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}
        >
          {status === 'Found All' ? `✓ ${t.foundAll}` :
           status === 'Partial' ? `½ ${t.partial} (${line['Quantity Found'] || 0})` :
           `✗ ${t.notFound}`}
        </button>
      )}

      {/* Expanded partial details */}
      {expanded && status === 'Partial' && (
        <div className="mt-2 bg-amber-50 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ios-secondary w-24">{t.foundAtSupplier}:</span>
            <input
              type="number"
              value={qtyFound}
              onChange={e => setQtyFound(e.target.value)}
              onBlur={savePartialDetails}
              className="w-16 text-center text-sm border border-amber-200 rounded-lg px-2 py-1 bg-white outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-ios-secondary">{t.foundMoreElsewhere}</span>
            <button onClick={() => setShowAlt(true)}
              className={`px-2 py-0.5 rounded text-xs font-medium ${showAlt ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}>
              {t.yes}
            </button>
            <button onClick={() => { setShowAlt(false); setAltFlowerName(''); setAltSupplier(''); setAltQty('');}}
              className={`px-2 py-0.5 rounded text-xs font-medium ${!showAlt ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}>
              {t.no}
            </button>
          </div>

          {showAlt && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={altSupplier}
                onChange={e => setAltSupplier(e.target.value)}
                onBlur={savePartialDetails}
                placeholder={t.altSupplier}
                className="flex-1 text-sm border border-amber-200 rounded-lg px-2 py-1 bg-white outline-none"
              />
              <input
                type="number"
                value={altQty}
                onChange={e => setAltQty(e.target.value)}
                onBlur={savePartialDetails}
                placeholder={t.altAmount}
                className="w-16 text-center text-sm border border-amber-200 rounded-lg px-2 py-1 bg-white outline-none"
              />
            </div>
          )}

          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={savePartialDetails}
            placeholder={t.note}
            className="w-full text-sm border border-amber-200 rounded-lg px-2 py-1 bg-white outline-none"
          />

          <button onClick={() => setExpanded(false)} className="text-xs text-ios-secondary">
            {t.close}
          </button>
        </div>
      )}

      {/* Expanded not-found details */}
      {expanded && status === 'Not Found' && (
        <div className="mt-2 bg-red-50 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ios-secondary">{t.foundAlternative}</span>
            <button onClick={() => setShowAlt(true)}
              className={`px-2 py-0.5 rounded text-xs font-medium ${showAlt ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}>
              {t.yes}
            </button>
            <button onClick={() => { setShowAlt(false); setAltFlowerName(''); setAltSupplier(''); setAltQty('');}}
              className={`px-2 py-0.5 rounded text-xs font-medium ${!showAlt ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}>
              {t.no}
            </button>
          </div>

          {showAlt && (
            <>
              <input
                type="text"
                value={altFlowerName}
                onChange={e => setAltFlowerName(e.target.value)}
                onBlur={saveNotFoundDetails}
                placeholder={t.altFlowerName}
                className="w-full text-sm border border-red-200 rounded-lg px-2 py-1 bg-white outline-none"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={altQty}
                  onChange={e => setAltQty(e.target.value)}
                  onBlur={saveNotFoundDetails}
                  placeholder={t.altAmount}
                  className="w-16 text-center text-sm border border-red-200 rounded-lg px-2 py-1 bg-white outline-none"
                />
                <input
                  type="text"
                  value={altSupplier}
                  onChange={e => setAltSupplier(e.target.value)}
                  onBlur={saveNotFoundDetails}
                  placeholder={t.altSupplier}
                  className="flex-1 text-sm border border-red-200 rounded-lg px-2 py-1 bg-white outline-none"
                />
              </div>
            </>
          )}

          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={saveNotFoundDetails}
            placeholder={t.note}
            className="w-full text-sm border border-red-200 rounded-lg px-2 py-1 bg-white outline-none"
          />

          <button onClick={() => setExpanded(false)} className="text-xs text-ios-secondary">
            {t.close}
          </button>
        </div>
      )}
    </div>
  );
}
