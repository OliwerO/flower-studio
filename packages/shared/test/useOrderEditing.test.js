// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { findDuplicateStockItem, isStockItemVisible, findAllMatchingVariety } from '../hooks/useOrderEditing.js';
import useOrderEditing from '../hooks/useOrderEditing.js';

describe('findDuplicateStockItem', () => {
  const stock = [
    { id: 'rec1', 'Display Name': 'Antirrhinum Yellow' },
    { id: 'rec2', 'Display Name': 'Hydrangea Pink' },
    { id: 'rec3', 'Display Name': '  Peony Coral  ' },
  ];

  it('finds an exact case-insensitive match', () => {
    expect(findDuplicateStockItem(stock, 'antirrhinum yellow')?.id).toBe('rec1');
    expect(findDuplicateStockItem(stock, 'HYDRANGEA PINK')?.id).toBe('rec2');
  });

  it('trims surrounding whitespace on both sides', () => {
    expect(findDuplicateStockItem(stock, '  Antirrhinum Yellow  ')?.id).toBe('rec1');
    expect(findDuplicateStockItem(stock, 'Peony Coral')?.id).toBe('rec3');
  });

  it('returns null when nothing matches', () => {
    expect(findDuplicateStockItem(stock, 'Tulip')).toBeNull();
    expect(findDuplicateStockItem(stock, 'Antirrhinum White')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(findDuplicateStockItem(stock, '')).toBeNull();
    expect(findDuplicateStockItem(stock, '   ')).toBeNull();
    expect(findDuplicateStockItem(stock, null)).toBeNull();
    expect(findDuplicateStockItem(stock, undefined)).toBeNull();
  });

  it('handles items missing a Display Name without throwing', () => {
    const messy = [{ id: 'rec1' }, { id: 'rec2', 'Display Name': 'Rose' }];
    expect(findDuplicateStockItem(messy, 'Rose')?.id).toBe('rec2');
    expect(findDuplicateStockItem(messy, 'Anything')).toBeNull();
  });
});

describe('isStockItemVisible', () => {
  it('hides a depleted dated Batch with no pending PO', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(false);
  });

  it('shows a depleted dated Batch that has pending PO demand', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, { rec1: { ordered: 5 } })).toBe(true);
  });

  it('shows a dated Batch with positive qty regardless of pending PO', () => {
    const item = { id: 'rec2', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 6 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows an undated Demand Entry regardless of negative qty', () => {
    const item = { id: 'rec3', 'Display Name': 'Rose', 'Current Quantity': -5 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows a non-dated zero-qty item (pending demand)', () => {
    const item = { id: 'rec4', 'Display Name': 'Lavender', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('defaults pendingPO to empty object when omitted', () => {
    const item = { id: 'rec5', 'Display Name': 'Tulip (10.Apr.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item)).toBe(false);
  });
});

describe('findAllMatchingVariety', () => {
  const stock = [
    { id: 'rec1', 'Display Name': 'Pink Peonies (06.May.)' },
    { id: 'rec2', 'Display Name': 'Pink Peonies (15.Apr.)' },
    { id: 'rec3', 'Display Name': 'Pink Peonies' },
    { id: 'rec4', 'Display Name': 'Rose' },
    { id: 'rec5', 'Display Name': 'Rose (01.May.)' },
  ];

  it('returns Batches and Demand Entry for matching variety', () => {
    const result = findAllMatchingVariety(stock, 'Pink Peonies');
    expect(result.map(s => s.id)).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('is case-insensitive', () => {
    expect(findAllMatchingVariety(stock, 'pink peonies')).toHaveLength(3);
    expect(findAllMatchingVariety(stock, 'ROSE')).toHaveLength(2);
  });

  it('returns empty array for unknown variety', () => {
    expect(findAllMatchingVariety(stock, 'Tulip')).toEqual([]);
  });

  it('returns empty array for empty or null input', () => {
    expect(findAllMatchingVariety(stock, '')).toEqual([]);
    expect(findAllMatchingVariety(stock, null)).toEqual([]);
  });

  it('handles items with no Display Name', () => {
    const messy = [{ id: 'x1' }, { id: 'x2', 'Display Name': 'Rose' }];
    expect(findAllMatchingVariety(messy, 'Rose').map(s => s.id)).toEqual(['x2']);
  });
});

// ── createDemandEntry ──────────────────────────────────────────────────────
// Tests use renderHook + a mocked apiClient. stockItems starts empty so the
// duplicate-entry check never fires (no pre-existing Demand Entry).

function makeHookProps(overrides = {}) {
  return {
    orderId:   'ord-1',
    apiClient: {
      get:  vi.fn().mockResolvedValue({ data: [] }),
      post: vi.fn().mockResolvedValue({
        data: { id: 'stock-new', 'Display Name': 'New Item', 'Current Cost Price': 0, 'Current Sell Price': 0 },
      }),
    },
    showToast: vi.fn(),
    t: { updateError: 'Error' },
    ...overrides,
  };
}

describe('createDemandEntry', () => {
  // ── Legacy string path ────────────────────────────────────────────────────

  it('legacy string: POSTs /stock with displayName only (no 4-tuple fields)', async () => {
    const props = makeHookProps();
    const { result } = renderHook(() => useOrderEditing(props));

    await act(async () => {
      await result.current.createDemandEntry('Rose');
    });

    expect(props.apiClient.post).toHaveBeenCalledWith('/stock', {
      displayName: 'Rose',
      quantity: 0,
      costPrice: 0,
      sellPrice: 0,
    });
    // 4-tuple fields must NOT be present
    const body = props.apiClient.post.mock.calls[0][1];
    expect(body).not.toHaveProperty('typeName');
    expect(body).not.toHaveProperty('colour');
    expect(body).not.toHaveProperty('sizeCm');
    expect(body).not.toHaveProperty('cultivar');
  });

  // ── 4-tuple draft, no baseName (auto-computed displayName) ───────────────

  it('4-tuple draft without baseName: auto-computes displayName via varietyDisplayName', async () => {
    const props = makeHookProps();
    const { result } = renderHook(() => useOrderEditing(props));

    await act(async () => {
      await result.current.createDemandEntry({
        type_name: 'Rose',
        colour: 'Pink',
        size_cm: 60,
        cultivar: null,
      });
    });

    expect(props.apiClient.post).toHaveBeenCalledWith('/stock', {
      displayName: 'Rose Pink 60cm',
      typeName: 'Rose',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: null,
      quantity: 0,
      costPrice: 0,
      sellPrice: 0,
    });
  });

  // ── 4-tuple draft with explicit baseName (wins over auto-computed) ────────

  it('4-tuple draft with explicit baseName: baseName wins over auto-computed name', async () => {
    const props = makeHookProps();
    const { result } = renderHook(() => useOrderEditing(props));

    await act(async () => {
      await result.current.createDemandEntry({
        baseName: 'My Rose',
        type_name: 'Rose',
      });
    });

    const body = props.apiClient.post.mock.calls[0][1];
    expect(body.displayName).toBe('My Rose');
    expect(body.typeName).toBe('Rose');
    // colour/sizeCm/cultivar absent from draft → not sent
    expect(body).not.toHaveProperty('colour');
    expect(body).not.toHaveProperty('sizeCm');
    expect(body).not.toHaveProperty('cultivar');
  });

  // ── Existing Demand Entry path (regression: addFlowerFromStock, no POST) ─

  it('when Demand Entry already exists: calls addFlowerFromStock, skips POST', async () => {
    // Seed stockItems with a pre-existing Demand Entry for 'Rose'
    const existingEntry = {
      id: 'stock-existing',
      'Display Name': 'Rose',        // no batch date → Demand Entry
      'Current Cost Price': 5,
      'Current Sell Price': 10,
      'Current Quantity': -3,
    };
    const props = makeHookProps({
      apiClient: {
        get:  vi.fn().mockResolvedValue({ data: [existingEntry] }),
        post: vi.fn(),
      },
    });
    const { result } = renderHook(() => useOrderEditing(props));

    // Boot stockItems by triggering startEditing (which calls apiClient.get)
    await act(async () => {
      result.current.startEditing([]);
    });
    // Wait for the async fetches inside startEditing to settle
    await act(async () => {});

    // Clear any POST calls that may have happened during startEditing
    props.apiClient.post.mockClear();

    await act(async () => {
      await result.current.createDemandEntry('Rose');
    });

    // Should NOT have posted a new stock item
    expect(props.apiClient.post).not.toHaveBeenCalledWith('/stock', expect.anything());
    // Should have added the existing entry to editLines instead
    expect(result.current.editLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stockItemId: 'stock-existing' }),
      ]),
    );
  });
});
