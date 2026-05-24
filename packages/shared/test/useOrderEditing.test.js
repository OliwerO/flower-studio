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

// ── Batch quantity cap (#311 AC3) ──────────────────────────────────────────
// incrementQty must refuse to push a Batch-linked line past the Stock Item's
// freeQty (current_quantity − premade reservations). Demand-Entry-linked lines
// (negative current_quantity) and unlinked lines remain uncapped — demand is
// allowed to grow.

function makeHookWithStock(stock, premadeMap = {}, lines = []) {
  const props = {
    orderId: 'ord-cap',
    apiClient: {
      get:  vi.fn((path) => {
        if (path === '/stock/premade-committed') return Promise.resolve({ data: premadeMap });
        if (path.startsWith('/stock')) return Promise.resolve({ data: stock });
        return Promise.resolve({ data: {} });
      }),
      post: vi.fn(),
    },
    showToast: vi.fn(),
    t: { batchCapReached: 'Batch only has {n} available' },
  };
  const { result } = renderHook(() => useOrderEditing(props));
  // Force editLines without going through fetchStock so we can drive the API
  // synchronously. The hook exposes startEditing — we use it to enter edit
  // mode, then overwrite editLines via the same setter chain.
  act(() => {
    result.current.startEditing(lines.map((l, i) => ({
      id: `line-${i}`,
      'Stock Item': l.stockItemId ? [l.stockItemId] : [],
      'Flower Name': l.flowerName ?? 'X',
      Quantity: l.quantity,
      'Cost Price Per Unit': 0,
      'Sell Price Per Unit': 0,
    })));
  });
  // Hack stockItems + premadeMap by calling fetchStock-like internal setters
  // — startEditing kicks off async fetches; we await them.
  return { props, result };
}

describe('getLineCap + incrementQty cap (#311 AC3)', () => {
  it('uncapped when line has no stockItemId', () => {
    const { result } = makeHookWithStock(
      [],
      {},
      [{ stockItemId: null, quantity: 5, flowerName: 'Custom' }],
    );
    const cap = result.current.getLineCap(result.current.editLines[0]);
    expect(cap).toBe(Infinity);
  });

  it('uncapped when linked Stock Item is a Demand Entry (current_quantity < 0)', async () => {
    const stock = [{ id: 'de-1', 'Display Name': 'Rose DE', 'Current Quantity': -10 }];
    const { result } = makeHookWithStock(stock, {}, [
      { stockItemId: 'de-1', quantity: 4, flowerName: 'Rose' },
    ]);
    // Wait one tick for stockItems to populate
    await act(async () => { await Promise.resolve(); });
    const cap = result.current.getLineCap(result.current.editLines[0]);
    expect(cap).toBe(Infinity);
  });

  it('caps at current_quantity for a Batch-linked line (no reservations)', async () => {
    const stock = [{ id: 'b-1', 'Display Name': 'Rose Batch', 'Current Quantity': 8 }];
    const { result } = makeHookWithStock(stock, {}, [
      { stockItemId: 'b-1', quantity: 3, flowerName: 'Rose' },
    ]);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.getLineCap(result.current.editLines[0])).toBe(8);
  });

  it('subtracts premade reservations from the Batch cap', async () => {
    const stock = [{ id: 'b-2', 'Display Name': 'Rose Batch', 'Current Quantity': 10 }];
    const premadeMap = { 'b-2': { qty: 3, bouquets: [] } };
    const { result } = makeHookWithStock(stock, premadeMap, [
      { stockItemId: 'b-2', quantity: 1, flowerName: 'Rose' },
    ]);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.getLineCap(result.current.editLines[0])).toBe(7);
  });

  it('incrementQty refuses past cap and fires toast with cap number', async () => {
    const stock = [{ id: 'b-3', 'Display Name': 'Rose Batch', 'Current Quantity': 5 }];
    const { props, result } = makeHookWithStock(stock, {}, [
      { stockItemId: 'b-3', quantity: 5, flowerName: 'Rose' },
    ]);
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.incrementQty(0); });
    expect(result.current.editLines[0].quantity).toBe(5);
    expect(props.showToast).toHaveBeenCalledWith(
      'Batch only has 5 available',
      'error',
    );
  });

  it('incrementQty allows growth past Stock Item current_quantity for a Demand Entry', async () => {
    const stock = [{ id: 'de-2', 'Display Name': 'Rose DE', 'Current Quantity': -10 }];
    const { result } = makeHookWithStock(stock, {}, [
      { stockItemId: 'de-2', quantity: 50, flowerName: 'Rose' },
    ]);
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.incrementQty(0); });
    expect(result.current.editLines[0].quantity).toBe(51);
  });
});
