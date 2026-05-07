import { useState, useCallback } from 'react';

/**
 * Shared PATCH helpers for order and delivery fields.
 *
 * patchOrder — PATCH /orders/:orderId with fields, merges server response
 *   into local state, shows a success toast.
 * patchDelivery — PATCH /deliveries/:deliveryId with fields, merges fields
 *   into the nested delivery sub-object in local state.
 *
 * Both handle saving state and error toasts. Pass onUpdate to trigger a
 * re-fetch after patchOrder succeeds. Pass onSuccess(data) for any extra
 * side-effects that need the server response (e.g. propagating to a parent
 * list component).
 */
export default function useOrderPatching({
  orderId,
  apiClient,
  showToast,
  t,
  setOrder,
  onUpdate,   // called after successful patchOrder (optional)
  onSuccess,  // called with server response data after patchOrder (optional)
}) {
  const [saving, setSaving] = useState(false);

  const patchOrder = useCallback(async (fields) => {
    setSaving(true);
    try {
      const res = await apiClient.patch(`/orders/${orderId}`, fields);
      setOrder(prev => prev ? { ...prev, ...res.data } : res.data);
      showToast(t.orderUpdated || t.updated, 'success');
      onUpdate?.();
      onSuccess?.(res.data);
      return res.data;
    } catch (err) {
      showToast(err.response?.data?.error || t.updateError || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }, [orderId, apiClient, showToast, t, setOrder, onUpdate, onSuccess]);

  const patchDelivery = useCallback(async (fields, deliveryId) => {
    if (!deliveryId) return;
    setSaving(true);
    try {
      await apiClient.patch(`/deliveries/${deliveryId}`, fields);
      setOrder(prev => prev ? { ...prev, delivery: { ...prev.delivery, ...fields } } : prev);
      showToast(t.orderUpdated || t.updated, 'success');
      return true;
    } catch (err) {
      showToast(err.response?.data?.error || t.updateError || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }, [apiClient, showToast, t, setOrder]);

  return { saving, setSaving, patchOrder, patchDelivery };
}
