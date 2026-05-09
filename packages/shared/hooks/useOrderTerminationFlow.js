import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Shared hook for order termination flows (cancellation + deletion).
 *
 * Owns confirm-state, both cancel endpoints, and toast composition so that
 * all three consumer sites (OrderCard, OrderDetailPage, OrderDetailPanel)
 * produce identical UX without duplicated logic.
 *
 * Slice 1: cancel paths only (cancelWithReturn, cancelOnly, requestCancel, dismiss).
 * Slice 4 will add: requestDelete, deleteWithReturn, pendingKind='delete'.
 *
 * Toast composition rules:
 *   cancel + return + non-empty returnedItems → "${t.orderCancelled}. ${t.stockReturned}: name: +qty, ..."
 *   cancel + return + empty returnedItems     → "${t.orderCancelled}"
 *   cancel-only                               → no toast (PATCH route / host owns toast)
 *
 * DI pattern matches useOrderPatching — t, apiClient, showToast injected by host.
 */
export default function useOrderTerminationFlow({
  orderId,
  apiClient,   // axios-like: { post, patch, delete }
  showToast,   // (msg, kind) => void
  t,           // host translations object
  onSuccess,   // ({ kind: 'cancel'|'delete', returnedItems }) => void
  onError,     // optional (err) => void; default: showToast error
}) {
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [pendingKind,  setPendingKind]  = useState(null);   // 'cancel' | 'delete' | null
  const [saving,       setSaving]       = useState(false);

  // Guard against calling callbacks after unmount (onSuccess may trigger navigation/setState)
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Build the stock-return summary line used in both cancel + delete toasts
  function buildReturnSummary(returnedItems) {
    if (!returnedItems || returnedItems.length === 0) return '';
    return returnedItems
      .map(r => `${r.flowerName}: +${r.quantityReturned}`)
      .join(', ');
  }

  const cancelWithReturn = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiClient.post(`/orders/${orderId}/cancel-with-return`);
      const returnedItems = res.data?.returnedItems || [];
      const summary = buildReturnSummary(returnedItems);
      const msg = summary
        ? `${t.orderCancelled}. ${t.stockReturned}: ${summary}`
        : t.orderCancelled;
      showToast(msg, 'success');
      if (mountedRef.current) {
        setConfirmOpen(false);
        setPendingKind(null);
        onSuccess?.({ kind: 'cancel', returnedItems, withStockReturn: true });
      }
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
      if (onError) {
        onError(err);
      }
      if (mountedRef.current) setSaving(false);
      return;
    }
    if (mountedRef.current) setSaving(false);
  }, [orderId, apiClient, showToast, t, onSuccess, onError]);

  const cancelOnly = useCallback(async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/orders/${orderId}`, { Status: 'Cancelled' });
      // No toast here — caller / host's patch helper owns the success toast
      // to avoid double-toast (see plan: Cancel-only quirk).
      if (mountedRef.current) {
        setConfirmOpen(false);
        setPendingKind(null);
        onSuccess?.({ kind: 'cancel', returnedItems: [], withStockReturn: false });
      }
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
      if (onError) {
        onError(err);
      }
      if (mountedRef.current) setSaving(false);
      return;
    }
    if (mountedRef.current) setSaving(false);
  }, [orderId, apiClient, showToast, t, onSuccess, onError]);

  const deleteWithReturn = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiClient.delete(`/orders/${orderId}`);
      const returnedItems = res.data?.returnedItems || [];
      const summary = buildReturnSummary(returnedItems);
      const msg = summary
        ? `${t.orderDeleted}. ${t.stockReturned}: ${summary}`
        : t.orderDeleted;
      showToast(msg, 'success');
      if (mountedRef.current) {
        setConfirmOpen(false);
        setPendingKind(null);
        onSuccess?.({ kind: 'delete', returnedItems, withStockReturn: true });
      }
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
      if (onError) {
        onError(err);
      }
      if (mountedRef.current) setSaving(false);
      return;
    }
    if (mountedRef.current) setSaving(false);
  }, [orderId, apiClient, showToast, t, onSuccess, onError]);

  const requestCancel = useCallback(() => {
    setPendingKind('cancel');
    setConfirmOpen(true);
  }, []);

  const requestDelete = useCallback(() => {
    setPendingKind('delete');
    setConfirmOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setConfirmOpen(false);
    setPendingKind(null);
  }, []);

  return {
    confirmOpen,
    pendingKind,
    saving,
    requestCancel,
    requestDelete,
    cancelWithReturn,
    cancelOnly,
    deleteWithReturn,
    dismiss,
  };
}
