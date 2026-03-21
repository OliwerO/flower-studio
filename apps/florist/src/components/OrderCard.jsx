import { useState } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';
import { useOrderEditing } from '@flower-studio/shared';
import OrderCardSummary from './OrderCardSummary.jsx';
import OrderCardExpanded from './OrderCardExpanded.jsx';

export default function OrderCard({ order, onOrderUpdated, isOwner, stockShortfalls = {} }) {
  const { paymentMethods: payMethods, timeSlots, drivers } = useConfigLists();
  const { showToast } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const editing = useOrderEditing({ orderId: order.id, apiClient: client, showToast, t });

  const status     = order['Status'] || 'New';
  const isDelivery = order['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(status);
  const price      = order['Price Override'] || order['Sell Total'] || '';
  const isWix      = order['Source'] === 'Wix';
  const needsComposition = isWix && !order['Bouquet Summary'] && status === 'New';

  function toggle() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!detail) {
      setLoading(true);
      client.get(`/orders/${order.id}`)
        .then(r => setDetail(r.data))
        .catch(() => showToast(t.loadError, 'error'))
        .finally(() => setLoading(false));
    }
  }

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${order.id}`, fields);
      setDetail(prev => prev ? { ...prev, ...res.data } : res.data);
      onOrderUpdated?.(order.id, res.data);
      showToast(t.updated, 'success');
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function patchDelivery(fields) {
    const deliveryId = detail?.delivery?.id;
    if (!deliveryId) return;
    setSaving(true);
    try {
      await client.patch(`/deliveries/${deliveryId}`, fields);
      setDetail(prev => ({
        ...prev,
        delivery: { ...prev.delivery, ...fields },
      }));
      onOrderUpdated?.(order.id, {
        'Delivery Date': fields['Delivery Date'] ?? detail.delivery['Delivery Date'],
        'Delivery Time': fields['Delivery Time'] ?? detail.delivery['Delivery Time'],
      });
      showToast(t.updated, 'success');
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doSave(action) {
    const refreshed = await editing.doSave(action);
    if (refreshed) setDetail(refreshed);
  }

  function onSaveClick() {
    const result = editing.handleSaveClick();
    if (result) return result.then(data => { if (data) setDetail(data); });
  }

  async function handleConvertToDelivery(val) {
    const d = detail || order;
    if (val === 'Delivery' && d['Delivery Type'] === 'Pickup' && !detail?.delivery) {
      setSaving(true);
      try {
        const res = await client.post(`/orders/${order.id}/convert-to-delivery`, {});
        setDetail(prev => ({ ...prev, 'Delivery Type': 'Delivery', delivery: res.data }));
        onOrderUpdated?.(order.id, { 'Delivery Type': 'Delivery' });
        showToast(t.updated, 'success');
      } catch (err) {
        showToast(err.response?.data?.error || t.updateError, 'error');
      } finally {
        setSaving(false);
      }
    } else {
      patch({ 'Delivery Type': val });
    }
  }

  const d = detail || order;
  const currentStatus = d['Status'] || 'New';
  const currentPaid   = d['Payment Status'] === 'Paid';
  const detailLineTotal = (detail?.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const detailDeliveryFee = Number(d['Delivery Fee'] || detail?.delivery?.['Delivery Fee'] || 0);
  const currentPrice = d['Price Override'] || (detailLineTotal > 0 ? detailLineTotal + detailDeliveryFee : (d['Sell Total'] || price) ) || 0;

  return (
    <div
      onClick={toggle}
      className={`bg-white rounded-2xl shadow-sm px-4 py-4 transition-colors cursor-pointer ${
        expanded ? 'ring-2 ring-brand-200' : 'active:bg-ios-fill'
      }`}
    >
      <OrderCardSummary
        order={order}
        d={d}
        currentStatus={currentStatus}
        currentPaid={currentPaid}
        currentPrice={currentPrice}
        isDelivery={isDelivery}
        isTerminal={isTerminal}
        expanded={expanded}
        saving={saving}
        needsComposition={needsComposition}
        stockShortfalls={stockShortfalls}
        onPatch={patch}
      />

      {expanded && (
        <OrderCardExpanded
          order={order}
          detail={detail}
          d={d}
          editing={editing}
          loading={loading}
          saving={saving}
          isDelivery={isDelivery}
          isTerminal={isTerminal}
          isOwner={isOwner}
          currentStatus={currentStatus}
          currentPaid={currentPaid}
          currentPrice={currentPrice}
          timeSlots={timeSlots}
          drivers={drivers}
          payMethods={payMethods}
          onPatch={patch}
          onPatchDelivery={patchDelivery}
          doSave={doSave}
          onSaveClick={onSaveClick}
          onCollapse={() => setExpanded(false)}
          onConvertToDelivery={handleConvertToDelivery}
          setDetail={setDetail}
        />
      )}
    </div>
  );
}
