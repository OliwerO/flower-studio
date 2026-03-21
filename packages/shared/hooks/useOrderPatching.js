import { useState, useCallback } from 'react';

export default function useOrderPatching({ orderId, apiClient, showToast, t, setOrder, onUpdate }) {
  const [saving, setSaving] = useState(false);

  const patchOrder = useCallback(async (fields) => {
    setSaving(true);
    try {
      const res = await apiClient.patch(`/orders/${orderId}`, fields);
      setOrder(prev => prev ? { ...prev, ...fields, ...res.data } : res.data);
      showToast(t.orderUpdated || t.updated, 'success');
      onUpdate?.();
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError || t.error;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [orderId, apiClient, showToast, t, setOrder, onUpdate]);

  const patchDelivery = useCallback(async (fields, deliveryId) => {
    if (!deliveryId) return;
    setSaving(true);
    try {
      await apiClient.patch(`/deliveries/${deliveryId}`, fields);
      setOrder(prev => ({
        ...prev,
        delivery: { ...prev.delivery, ...fields },
      }));
      showToast(t.orderUpdated || t.updated, 'success');
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError || t.error;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [apiClient, showToast, t, setOrder]);

  return { saving, setSaving, patchOrder, patchDelivery };
}
