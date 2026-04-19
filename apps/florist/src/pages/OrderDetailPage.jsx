// OrderDetailPage — full-page order detail view.
// Replaces the bottom sheet approach which had CSS stacking context issues.
// A separate page is the most resilient pattern — no overlays, no z-index.

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';

// Split "Rose Red (14.Mar.)" into { name: "Rose Red", batch: "14.Mar." }
function parseBatchName(displayName) {
  const m = (displayName || '').match(/^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/);
  return m ? { name: m[1], batch: m[2] } : { name: displayName, batch: null };
}

// Florist flow: New → Ready → Delivered/Picked Up.
// "Out for Delivery" is set automatically by drivers — florists don't need that button.
const ALLOWED_TRANSITIONS = {
  'New':              ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],
  'Ready':            ['Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],   // can still advance if driver started it
  'Delivered':        [],
  'Picked Up':        [],
  'Cancelled':        ['New'],
};

function Pills({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => !disabled && onChange(o.value)}
          disabled={disabled}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
            value === o.value
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
      <span className="text-sm text-ios-label text-right">{value}</span>
    </div>
  );
}

// Inline-editable date field for order details
function EditableDate({ label, value, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const display = value ? new Date(value + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  if (!editing) {
    return (
      <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
        <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
        <button
          onClick={() => { setDraft(value || ''); setEditing(true); }}
          className="text-sm text-ios-label text-right hover:text-brand-600"
        >
          {display || <span className="text-ios-tertiary italic">{t.tapToEdit || 'Tap to add'}</span>}
        </button>
      </div>
    );
  }
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary block mb-1">{label}</span>
      <div className="flex gap-2 items-center">
        <input
          type="date"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          className="flex-1 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm"
        />
        <button
          onClick={async () => { await onSave(draft); setEditing(false); }}
          disabled={disabled}
          className="text-xs px-3 py-1.5 rounded bg-brand-600 text-white font-semibold"
        >{t.save || 'Save'}</button>
        <button onClick={() => setEditing(false)} className="text-xs px-2 py-1.5 text-ios-tertiary">{t.cancel}</button>
      </div>
    </div>
  );
}

// Inline-editable card text — usable in any order stage (per owner request).
function EditableCardText({ value, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
        <span className="text-sm text-ios-tertiary shrink-0">{t.cardText || 'Card msg'}</span>
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="text-sm text-ios-label text-right flex-1 truncate hover:text-brand-600"
        >
          {value || <span className="text-ios-tertiary italic">{t.tapToEdit || 'Tap to add'}</span>}
        </button>
      </div>
    );
  }
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary block mb-1">{t.cardText || 'Card msg'}</span>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        autoFocus
        rows={3}
        className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm"
      />
      <div className="flex gap-2 mt-1.5 justify-end">
        <button onClick={() => setEditing(false)} className="text-xs px-3 py-1 rounded text-ios-tertiary">{t.cancel}</button>
        <button
          onClick={async () => { await onSave(draft); setEditing(false); }}
          disabled={disabled}
          className="text-xs px-3 py-1 rounded bg-brand-600 text-white font-semibold"
        >
          {t.save || 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isOwner = role === 'owner';
  const { showToast } = useToast();
  const { paymentMethods, timeSlots, drivers } = useConfigLists();

  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [removeDialog, setRemoveDialog] = useState(null);
  const [addingFlower, setAddingFlower] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [stockItems, setStockItems] = useState([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    client.get(`/orders/${id}`)
      .then(r => setOrder(r.data))
      .catch(() => {
        setError(true);
        showToast('Failed to load order.', 'error');
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${id}`, fields);
      setOrder(prev => ({ ...prev, ...res.data }));
      showToast('Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update order.';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Patch the linked delivery record (address, recipient, fee, driver assignment).
  // Mirrors OrderCard.patchDelivery so the full-page detail and the list card stay in sync.
  async function patchDelivery(fields) {
    const deliveryId = order?.delivery?.id;
    if (!deliveryId) return;
    setSaving(true);
    try {
      await client.patch(`/deliveries/${deliveryId}`, fields);
      setOrder(prev => prev ? { ...prev, delivery: { ...prev.delivery, ...fields } } : prev);
      showToast(t.updated || 'Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError || 'Failed to update delivery.';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Total = Price Override (when set, already includes delivery) OR (flowers + delivery fee).
  // Match backend cascade in routes/orders.js so list and detail show the same number.
  const _delFee    = order?.['Delivery Type'] === 'Delivery' ? Number(order?.['Delivery Fee'] || 0) : 0;
  const _sellTotal = Number(order?.['Sell Total'] || 0);
  const price      = order?.['Final Price'] || order?.['Price Override'] || (_sellTotal + _delFee);
  const isPaid     = order?.['Payment Status'] === 'Paid';
  const isDelivery = order?.['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(order?.Status);

  return (
    <div className="min-h-screen">
      {/* Header with back button */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/orders')}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-ios-secondary dark:text-gray-300 text-sm active-scale hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ios-label truncate">
              {order?.['Customer Name'] || '—'}
            </p>
            <p className="text-xs text-ios-tertiary">
              {order?.['Order Date']} · {isDelivery ? 'Delivery' : 'Pickup'}
              {price > 0 && ` · ${price} zł`}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-4 py-4 max-w-2xl mx-auto flex flex-col gap-5 pb-24">

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : error || !order ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-4xl">😕</p>
            <p className="text-ios-tertiary text-sm">Could not load order details.</p>
            <button
              onClick={() => navigate('/orders')}
              className="px-5 py-2 rounded-full bg-brand-600 text-white text-sm font-medium active-scale"
            >
              Back to orders
            </button>
          </div>
        ) : (
          <>
            {/* Customer info — who placed the order */}
            <div>
              <p className="ios-label">Customer</p>
              <div className="ios-card px-4 py-2">
                <Row label="Name" value={order['Customer Name']} />
                {order['Customer Nickname'] && order['Customer Nickname'] !== order['Customer Name'] && (
                  <Row label="Nickname" value={order['Customer Nickname']} />
                )}
                {order['Customer Phone'] && (
                  <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-ios-tertiary shrink-0">Phone</span>
                    <a href={`tel:${order['Customer Phone']}`} className="text-sm text-brand-600 font-medium">
                      {order['Customer Phone']}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Customer request */}
            {order['Customer Request'] && (
              <div className="ios-card px-4 py-3">
                <p className="text-xs text-ios-tertiary mb-1">Customer request</p>
                <p className="text-sm text-ios-label">{order['Customer Request']}</p>
              </div>
            )}

            {/* Order lines */}
            {order.orderLines?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="ios-label !mb-0">{t.bouquetContents || 'Bouquet'}</p>
                  {(!isTerminal || isOwner) && !editingBouquet && (
                    <button
                      onClick={() => {
                        setEditLines(order.orderLines.map(l => ({
                          id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                          flowerName: l['Flower Name'], quantity: l.Quantity,
                          _originalQty: l.Quantity,
                          sellPricePerUnit: l['Sell Price Per Unit'] || 0,
                        })));
                        setRemovedLines([]);
                        setAddingFlower(false);
                        setFlowerSearch('');
                        setEditingBouquet(true);
                        if (stockItems.length === 0) {
                          client.get('/stock').then(r => setStockItems(r.data)).catch(() => {});
                        }
                      }}
                      className="text-xs text-brand-600 font-medium px-1"
                    >{t.editBouquet}</button>
                  )}
                </div>

                {editingBouquet ? (
                  <div className="ios-card px-4 py-3 space-y-2">
                    {editLines.map((line, idx) => (
                      <div key={line.id || idx} className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
                        <input
                          type="number" min="1" value={line.quantity}
                          onChange={e => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) || 1 } : l))}
                          className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1.5"
                        />
                        <button onClick={() => setRemoveDialog(idx)} className="text-red-400 text-sm px-1">✕</button>
                      </div>
                    ))}

                    {/* Add flower picker — shows stock with sell price and quantity */}
                    {!addingFlower ? (
                      <button onClick={() => setAddingFlower(true)}
                        className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg"
                      >+ {t.addFlower}</button>
                    ) : (
                      <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
                        <input type="text" value={flowerSearch}
                          onChange={e => setFlowerSearch(e.target.value)}
                          placeholder={t.flowerSearch}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                          autoFocus />
                        {/* Column headers */}
                        <div className="flex items-center text-[10px] text-ios-tertiary uppercase tracking-wide px-2 pt-1">
                          <span className="flex-1">{t.flowers}</span>
                          <span className="w-14 text-right">{t.sellPrice}</span>
                          <span className="w-12 text-right">{t.quantity}</span>
                        </div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                          {stockItems
                            .filter(s => {
                              const name = (s['Display Name'] || '').toLowerCase();
                              const qty = Number(s['Current Quantity']) || 0;
                              if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
                              if (editLines.some(l => l.stockItemId === s.id)) return false;
                              if (flowerSearch) return name.includes(flowerSearch.toLowerCase());
                              return true;
                            })
                            .slice(0, 20)
                            .map(s => {
                              const qty = Number(s['Current Quantity']) || 0;
                              const sell = Number(s['Current Sell Price']) || 0;
                              const { name: flowerName, batch } = parseBatchName(s['Display Name']);
                              return (
                                <button key={s.id} type="button"
                                  onClick={() => {
                                    setEditLines(p => [...p, {
                                      id: null, stockItemId: s.id, flowerName: s['Display Name'],
                                      quantity: 1, _originalQty: 0,
                                      sellPricePerUnit: sell,
                                    }]);
                                    setFlowerSearch('');
                                  }}
                                  className={`w-full flex items-center px-2 py-1.5 text-sm hover:bg-gray-50 rounded ${
                                    qty <= 0 ? 'bg-amber-50/50' : ''
                                  }`}
                                >
                                  <span className="flex-1 font-medium text-left truncate">
                                    {flowerName}
                                    {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 dark:bg-gray-700 rounded px-1 py-0.5">{batch}</span>}
                                  </span>
                                  <span className="w-14 text-right text-xs text-ios-secondary">{sell > 0 ? `${sell.toFixed(0)}` : '—'}</span>
                                  <span className={`w-12 text-right text-xs font-medium ${qty <= 0 ? 'text-amber-600' : 'text-ios-label'}`}>{qty}</span>
                                </button>
                              );
                            })}
                        </div>
                        <button onClick={() => { setAddingFlower(false); setFlowerSearch(''); }}
                          className="text-xs text-ios-tertiary">{t.cancel}</button>
                      </div>
                    )}

                    {removeDialog != null && (
                      <div className="bg-amber-50 rounded-xl px-3 py-2 space-y-2">
                        <p className="text-sm text-amber-800">{editLines[removeDialog]?.flowerName}</p>
                        <div className="flex gap-2">
                          <button onClick={() => {
                            const l = editLines[removeDialog];
                            setRemovedLines(p => [...p, { lineId: l.id, stockItemId: l.stockItemId, quantity: l._originalQty, action: 'return' }]);
                            setEditLines(p => p.filter((_, i) => i !== removeDialog));
                            setRemoveDialog(null);
                          }} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-medium">
                            {t.returnToStock || 'Return'}
                          </button>
                          <button onClick={() => {
                            const l = editLines[removeDialog];
                            setRemovedLines(p => [...p, { lineId: l.id, stockItemId: l.stockItemId, quantity: l._originalQty, action: 'writeoff', reason: 'Bouquet edit' }]);
                            setEditLines(p => p.filter((_, i) => i !== removeDialog));
                            setRemoveDialog(null);
                          }} className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium">
                            {t.writeOff || 'Write off'}
                          </button>
                        </div>
                        <button onClick={() => setRemoveDialog(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await client.put(`/orders/${id}/lines`, { lines: editLines, removedLines });
                            setEditingBouquet(false);
                            setAddingFlower(false);
                            setFlowerSearch('');
                            setRemoveDialog(null);
                            const res = await client.get(`/orders/${id}`);
                            setOrder(res.data);
                            showToast(t.bouquetUpdated);
                          } catch (err) {
                            showToast(err.response?.data?.error || t.error, 'error');
                          } finally { setSaving(false); }
                        }}
                        disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                      >{saving ? '...' : t.saveBouquet}</button>
                      <button onClick={() => { setEditingBouquet(false); setRemoveDialog(null); setAddingFlower(false); setFlowerSearch(''); }}
                        className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm"
                      >{t.cancel}</button>
                    </div>
                  </div>
                ) : (
                  <div className="ios-card overflow-hidden divide-y divide-gray-100">
                    {order.orderLines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-ios-label">{line['Flower Name']}</p>
                          <p className="text-xs text-ios-tertiary">
                            {line['Sell Price Per Unit']} zł × {line['Quantity']}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-brand-600">
                          {(Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0)).toFixed(0)} zł
                        </p>
                      </div>
                    ))}
                    <div className="flex justify-between px-4 py-3 bg-brand-50/50">
                      <span className="text-sm text-ios-tertiary">Total</span>
                      <span className="text-sm font-bold text-brand-600">
                        {price > 0 ? `${price} zł` : '—'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Date & time — same UI for delivery and pickup */}
            <div>
              <p className="ios-label">{t.deliveryDate || 'Date'}</p>
              <div className="ios-card px-4 py-2">
                <EditableDate label={t.deliveryDate || 'Date'} value={order['Required By'] || ''} onSave={v => patch({ 'Required By': v || null })} disabled={saving} />
                <div className="py-2 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-ios-tertiary block mb-1.5">{t.deliveryTime || 'Time'}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {timeSlots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => !saving && patch({ 'Delivery Time': order['Delivery Time'] === slot ? '' : slot })}
                        disabled={saving}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          order['Delivery Time'] === slot
                            ? 'bg-brand-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
                        }`}
                      >{slot}</button>
                    ))}
                  </div>
                </div>
                <EditableCardText value={order['Greeting Card Text'] || ''} onSave={v => patch({ 'Greeting Card Text': v })} disabled={saving} />
              </div>
            </div>

            {/* Delivery-specific: address, recipient, fee */}
            {isDelivery && order.delivery && (
              <div>
                <p className="ios-label">{t.deliveryDetails || 'Delivery'}</p>
                <div className="ios-card px-4 py-2">
                  <Row label={t.deliveryAddress || 'Address'} value={order.delivery['Delivery Address']} />
                  <Row label={t.recipientName || 'Recipient'} value={order.delivery['Recipient Name']} />
                  {order.delivery['Recipient Phone'] && (
                    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-ios-tertiary shrink-0">{t.recipientPhone || 'Phone'}</span>
                      <a href={`tel:${order.delivery['Recipient Phone']}`} className="text-sm text-brand-600 font-medium">
                        {order.delivery['Recipient Phone']}
                      </a>
                    </div>
                  )}
                  <Row label={t.deliveryFee || 'Fee'} value={order.delivery['Delivery Fee'] ? `${order.delivery['Delivery Fee']} zł` : null} />
                </div>
              </div>
            )}

            {/* Driver assignment — same picker as the expanded OrderCard. */}
            {isDelivery && order.delivery && drivers.length > 0 && (
              <div>
                <p className="ios-label">{t.assignedDriver}</p>
                <div className="ios-card p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {drivers.map(driver => (
                      <button
                        key={driver}
                        onClick={() => patchDelivery({
                          'Assigned Driver': order.delivery['Assigned Driver'] === driver ? '' : driver,
                        })}
                        disabled={saving}
                        className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
                          order.delivery['Assigned Driver'] === driver
                            ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                            : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {driver}
                      </button>
                    ))}
                  </div>
                  {!order.delivery['Assigned Driver'] && (
                    <p className="text-xs text-ios-tertiary mt-2">{t.noDriver}</p>
                  )}
                </div>
              </div>
            )}

            {/* Status */}
            <div>
              <p className="ios-label">Status</p>
              <div className="ios-card p-4">
                {(() => {
                  const current = order['Status'] || 'New';
                  const allowed = ALLOWED_TRANSITIONS[current] || [];
                  const visible = [current, ...allowed];
                  return (
                    <Pills
                      value={current}
                      onChange={val => patch({ 'Status': val })}
                      disabled={saving}
                      options={visible.map(s => ({ value: s, label: s }))}
                    />
                  );
                })()}
              </div>
            </div>

            {/* Payment */}
            <div>
              <p className="ios-label">Payment</p>
              <div className="ios-card p-4 flex flex-col gap-3">
                <Pills
                  value={order['Payment Status'] || 'Unpaid'}
                  onChange={val => patch({
                    'Payment Status': val,
                    ...(val === 'Unpaid' ? { 'Payment Method': '' } : {}),
                  })}
                  disabled={saving}
                  options={[
                    { value: 'Unpaid', label: 'Unpaid' },
                    { value: 'Paid',   label: 'Paid' },
                  ]}
                />
                {isPaid && (
                  <Pills
                    value={order['Payment Method'] || ''}
                    onChange={val => patch({ 'Payment Method': val })}
                    disabled={saving}
                    options={paymentMethods.map(m => ({ value: m, label: m }))}
                  />
                )}
              </div>
            </div>

            {/* Source + notes */}
            {(order['Source'] || order['Notes Original']) && (
              <div>
                <p className="ios-label">Info</p>
                <div className="ios-card px-4 py-2">
                  <Row label="Source" value={order['Source']} />
                  <Row label="Notes"  value={order['Notes Original']} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
