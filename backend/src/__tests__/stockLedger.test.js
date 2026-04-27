// Tests for atomicStockAdjust ledger-writing behavior.
//
// We mock the Airtable SDK base() function so we can assert which records
// get created/updated and in what order. The point of this test is to
// guarantee that EVERY successful stock adjustment produces exactly one
// ledger row with the correct delta/reason/sourceId/actor — so the ledger
// stays a faithful event log.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock-style table IDs; the values just need to be truthy strings so the
// `if (TABLES.STOCK_LEDGER)` gate inside atomicStockAdjust passes.
const TABLES = {
  STOCK: 'tblStock',
  STOCK_LEDGER: 'tblStockLedger',
};

// Per-table mock record stores. Each mocked table exposes find / update /
// create that the airtable.js code path calls.
const stockStore = new Map();
const ledgerCreates = [];

const mockBase = vi.fn((tableId) => {
  if (tableId === 'tblStock') {
    return {
      find: vi.fn(async (id) => {
        const fields = stockStore.get(id);
        if (!fields) throw new Error(`Stock ${id} not found`);
        return { id, fields };
      }),
      update: vi.fn(async (id, patch) => {
        const fields = stockStore.get(id) || {};
        const merged = { ...fields, ...patch };
        stockStore.set(id, merged);
        return { id, fields: merged };
      }),
    };
  }
  if (tableId === 'tblStockLedger') {
    return {
      create: vi.fn(async (fields) => {
        ledgerCreates.push(fields);
        return { id: `recLedger${ledgerCreates.length}`, fields };
      }),
    };
  }
  throw new Error(`Unexpected table: ${tableId}`);
});

vi.mock('../config/airtable.js', () => ({
  default: mockBase,
  TABLES,
}));

// Import AFTER the mock so the module picks up our mocked base + tables.
const { atomicStockAdjust } = await import('../services/airtable.js');

beforeEach(() => {
  stockStore.clear();
  ledgerCreates.length = 0;
});

describe('atomicStockAdjust + Stock Ledger', () => {
  it('writes a ledger row with delta, prev, new, reason, source, actor', async () => {
    stockStore.set('recRose', { 'Current Quantity': 50 });

    const result = await atomicStockAdjust('recRose', -3, {
      reason: 'order_create',
      sourceType: 'order',
      sourceId: 'recOrder42',
      actor: 'florist',
      note: 'Created order line: Red Rose',
    });

    expect(result).toEqual({ stockId: 'recRose', previousQty: 50, newQty: 47 });
    expect(ledgerCreates).toHaveLength(1);
    expect(ledgerCreates[0]).toMatchObject({
      'Stock Item': ['recRose'],
      'Delta': -3,
      'Previous Quantity': 50,
      'New Quantity': 47,
      'Reason': 'order_create',
      'Source Type': 'order',
      'Source ID': 'recOrder42',
      'Actor': 'florist',
      'Note': 'Created order line: Red Rose',
    });
  });

  it('omits optional fields when ctx is missing them', async () => {
    stockStore.set('recTulip', { 'Current Quantity': 10 });

    await atomicStockAdjust('recTulip', 5, { reason: 'po_receive', sourceType: 'stock_order' });

    const row = ledgerCreates[0];
    expect(row['Reason']).toBe('po_receive');
    expect(row['Source Type']).toBe('stock_order');
    expect(row['Source ID']).toBeUndefined();
    expect(row['Actor']).toBeUndefined();
    expect(row['Note']).toBeUndefined();
  });

  it('defaults reason to "unknown" and sourceType to "manual" when ctx absent', async () => {
    stockStore.set('recPeony', { 'Current Quantity': 20 });

    await atomicStockAdjust('recPeony', -2);

    expect(ledgerCreates[0]['Reason']).toBe('unknown');
    expect(ledgerCreates[0]['Source Type']).toBe('manual');
  });

  it('produces a ledger row with delta=0 if a no-op call is made', async () => {
    stockStore.set('recLily', { 'Current Quantity': 7 });

    await atomicStockAdjust('recLily', 0, { reason: 'manual_correction', actor: 'owner' });

    expect(ledgerCreates).toHaveLength(1);
    expect(ledgerCreates[0]['Delta']).toBe(0);
    expect(ledgerCreates[0]['Previous Quantity']).toBe(7);
    expect(ledgerCreates[0]['New Quantity']).toBe(7);
  });

  it('does not roll back the stock change if the ledger write fails', async () => {
    stockStore.set('recOrchid', { 'Current Quantity': 30 });

    // Re-mock the ledger create to throw
    mockBase.mockImplementationOnce((tableId) => {
      if (tableId === 'tblStock') {
        return {
          find: vi.fn(async () => ({ id: 'recOrchid', fields: { 'Current Quantity': 30 } })),
          update: vi.fn(async (id, patch) => {
            stockStore.set(id, { ...stockStore.get(id), ...patch });
            return { id, fields: stockStore.get(id) };
          }),
        };
      }
      throw new Error('unexpected');
    });

    // Spy on console.error so we assert the loud log
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await atomicStockAdjust('recOrchid', -5, { reason: 'order_create' });

    expect(result.newQty).toBe(25);
    expect(stockStore.get('recOrchid')['Current Quantity']).toBe(25);

    errSpy.mockRestore();
  });
});
