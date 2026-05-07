// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOrderPatching from '../hooks/useOrderPatching.js';

const ORDER_ID = 'ord-1';
const DELIVERY_ID = 'del-1';

function makeProps(overrides = {}) {
  return {
    orderId:   ORDER_ID,
    apiClient: { patch: vi.fn() },
    showToast: vi.fn(),
    t:         { orderUpdated: 'Saved', error: 'Error' },
    setOrder:  vi.fn(),
    onUpdate:  vi.fn(),
    onSuccess: vi.fn(),
    ...overrides,
  };
}

describe('useOrderPatching', () => {
  describe('patchOrder', () => {
    it('PATCHes the order, merges res.data, toasts, calls onUpdate + onSuccess', async () => {
      const props = makeProps();
      props.apiClient.patch.mockResolvedValue({ data: { Status: 'Ready', computed: true } });

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      });

      expect(props.apiClient.patch).toHaveBeenCalledWith(`/orders/${ORDER_ID}`, { Status: 'Ready' });
      expect(props.setOrder).toHaveBeenCalled();
      expect(props.showToast).toHaveBeenCalledWith('Saved', 'success');
      expect(props.onUpdate).toHaveBeenCalled();
      expect(props.onSuccess).toHaveBeenCalledWith({ Status: 'Ready', computed: true });
    });

    it('shows error toast on failure, does not call onUpdate', async () => {
      const props = makeProps();
      props.apiClient.patch.mockRejectedValue({
        response: { data: { error: 'Not found' } },
      });

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      });

      expect(props.showToast).toHaveBeenCalledWith('Not found', 'error');
      expect(props.onUpdate).not.toHaveBeenCalled();
    });

    it('clears saving state after success', async () => {
      const props = makeProps();
      props.apiClient.patch.mockResolvedValue({ data: {} });

      const { result } = renderHook(() => useOrderPatching(props));
      expect(result.current.saving).toBe(false);

      await act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      });

      expect(result.current.saving).toBe(false);
    });

    it('clears saving state after failure', async () => {
      const props = makeProps();
      props.apiClient.patch.mockRejectedValue({ response: { data: { error: 'Oops' } } });

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      });

      expect(result.current.saving).toBe(false);
    });

    it('falls back to t.error when response has no error message', async () => {
      const props = makeProps();
      props.apiClient.patch.mockRejectedValue({});

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      });

      expect(props.showToast).toHaveBeenCalledWith('Error', 'error');
    });

    it('works without optional onUpdate / onSuccess', async () => {
      const props = makeProps({ onUpdate: undefined, onSuccess: undefined });
      props.apiClient.patch.mockResolvedValue({ data: {} });

      const { result } = renderHook(() => useOrderPatching(props));

      await expect(act(async () => {
        await result.current.patchOrder({ Status: 'Ready' });
      })).resolves.not.toThrow();
    });
  });

  describe('patchDelivery', () => {
    it('PATCHes delivery, merges fields into nested delivery object, toasts', async () => {
      const props = makeProps();
      props.apiClient.patch.mockResolvedValue({ data: {} });
      const prevOrder = { id: ORDER_ID, Status: 'New', delivery: { id: DELIVERY_ID, 'Assigned Driver': 'Timur' } };
      props.setOrder.mockImplementation(fn => fn(prevOrder));

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchDelivery({ 'Delivery Address': '123 St' }, DELIVERY_ID);
      });

      expect(props.apiClient.patch).toHaveBeenCalledWith(`/deliveries/${DELIVERY_ID}`, { 'Delivery Address': '123 St' });
      expect(props.setOrder).toHaveBeenCalled();
      expect(props.showToast).toHaveBeenCalledWith('Saved', 'success');
    });

    it('does nothing if deliveryId is falsy', async () => {
      const props = makeProps();
      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchDelivery({ 'Assigned Driver': 'X' }, null);
      });

      expect(props.apiClient.patch).not.toHaveBeenCalled();
      expect(props.showToast).not.toHaveBeenCalled();
    });

    it('shows error toast on delivery patch failure', async () => {
      const props = makeProps();
      props.apiClient.patch.mockRejectedValue({
        response: { data: { error: 'Delivery not found' } },
      });

      const { result } = renderHook(() => useOrderPatching(props));

      await act(async () => {
        await result.current.patchDelivery({ 'Assigned Driver': 'X' }, DELIVERY_ID);
      });

      expect(props.showToast).toHaveBeenCalledWith('Delivery not found', 'error');
    });
  });
});
