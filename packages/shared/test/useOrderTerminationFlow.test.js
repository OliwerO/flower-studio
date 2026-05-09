// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOrderTerminationFlow from '../hooks/useOrderTerminationFlow.js';

const ORDER_ID = 'ord-42';

function makeProps(overrides = {}) {
  return {
    orderId:   ORDER_ID,
    apiClient: {
      post:   vi.fn(),
      patch:  vi.fn(),
      delete: vi.fn(),
    },
    showToast: vi.fn(),
    t: {
      orderCancelled: 'Order cancelled',
      stockReturned:  'Stock returned',
      updateError:    'Update error',
    },
    onSuccess: vi.fn(),
    onError:   vi.fn(),
    ...overrides,
  };
}

describe('useOrderTerminationFlow', () => {
  // ── cancelWithReturn ──────────────────────────────────────────────────────

  it('cancelWithReturn - POSTs correct endpoint, composes toast, calls onSuccess', async () => {
    const props = makeProps();
    props.apiClient.post.mockResolvedValue({
      data: {
        returnedItems: [
          { flowerName: 'Rose', quantityReturned: 3 },
          { flowerName: 'Tulip', quantityReturned: 5 },
        ],
      },
    });

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelWithReturn();
    });

    expect(props.apiClient.post).toHaveBeenCalledWith(`/orders/${ORDER_ID}/cancel-with-return`);
    expect(props.showToast).toHaveBeenCalledWith(
      'Order cancelled. Stock returned: Rose: +3, Tulip: +5',
      'success',
    );
    expect(props.onSuccess).toHaveBeenCalledWith({
      kind:            'cancel',
      returnedItems:   [
        { flowerName: 'Rose', quantityReturned: 3 },
        { flowerName: 'Tulip', quantityReturned: 5 },
      ],
      withStockReturn: true,
    });
  });

  it('cancelWithReturn - empty returnedItems shows only orderCancelled', async () => {
    const props = makeProps();
    props.apiClient.post.mockResolvedValue({
      data: { returnedItems: [] },
    });

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelWithReturn();
    });

    expect(props.showToast).toHaveBeenCalledWith('Order cancelled', 'success');
    expect(props.onSuccess).toHaveBeenCalledWith({
      kind:            'cancel',
      returnedItems:   [],
      withStockReturn: true,
    });
  });

  it('cancelWithReturn - missing returnedItems field treated as empty', async () => {
    const props = makeProps();
    props.apiClient.post.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelWithReturn();
    });

    expect(props.showToast).toHaveBeenCalledWith('Order cancelled', 'success');
  });

  // ── cancelOnly ────────────────────────────────────────────────────────────

  it('cancelOnly - PATCHes correct endpoint + payload, does NOT toast, calls onSuccess', async () => {
    const props = makeProps();
    props.apiClient.patch.mockResolvedValue({ data: { Status: 'Cancelled' } });

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelOnly();
    });

    expect(props.apiClient.patch).toHaveBeenCalledWith(`/orders/${ORDER_ID}`, { Status: 'Cancelled' });
    expect(props.showToast).not.toHaveBeenCalled();
    expect(props.onSuccess).toHaveBeenCalledWith({
      kind:            'cancel',
      returnedItems:   [],
      withStockReturn: false,
    });
  });

  // ── error path ────────────────────────────────────────────────────────────

  it('error path - post rejects with response.data.error, shows toast, calls onError', async () => {
    const props = makeProps();
    const apiErr = { response: { data: { error: 'Stock locked' } } };
    props.apiClient.post.mockRejectedValue(apiErr);

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelWithReturn();
    });

    expect(props.showToast).toHaveBeenCalledWith('Stock locked', 'error');
    expect(props.onError).toHaveBeenCalledWith(apiErr);
    expect(props.onSuccess).not.toHaveBeenCalled();
  });

  it('error path - post rejects without response, falls back to t.updateError', async () => {
    const props = makeProps();
    const apiErr = {};
    props.apiClient.post.mockRejectedValue(apiErr);

    const { result } = renderHook(() => useOrderTerminationFlow(props));

    await act(async () => {
      await result.current.cancelWithReturn();
    });

    expect(props.showToast).toHaveBeenCalledWith('Update error', 'error');
  });

  // ── requestCancel / dismiss ───────────────────────────────────────────────

  it('requestCancel sets confirmOpen=true, pendingKind=cancel', () => {
    const props = makeProps();
    const { result } = renderHook(() => useOrderTerminationFlow(props));

    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.pendingKind).toBeNull();

    act(() => {
      result.current.requestCancel();
    });

    expect(result.current.confirmOpen).toBe(true);
    expect(result.current.pendingKind).toBe('cancel');
  });

  it('dismiss closes confirmOpen', () => {
    const props = makeProps();
    const { result } = renderHook(() => useOrderTerminationFlow(props));

    act(() => {
      result.current.requestCancel();
    });
    expect(result.current.confirmOpen).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.pendingKind).toBeNull();
  });

  // ── saving state ──────────────────────────────────────────────────────────

  it('saving is true during cancelWithReturn, false after', async () => {
    const props = makeProps();
    let resolveFn;
    props.apiClient.post.mockReturnValue(
      new Promise(res => { resolveFn = () => res({ data: { returnedItems: [] } }); }),
    );

    const { result } = renderHook(() => useOrderTerminationFlow(props));
    expect(result.current.saving).toBe(false);

    let promise;
    act(() => {
      promise = result.current.cancelWithReturn();
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveFn();
      await promise;
    });
    expect(result.current.saving).toBe(false);
  });
});
