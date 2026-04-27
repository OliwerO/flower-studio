// Tests for orderService.editBouquetLines — the owner/role gate.
//
// Bug 11 (migration-blocking): owner needed full bouquet-edit control in
// every status, including Delivered/Picked Up/Cancelled, to stop direct
// Airtable edits. These tests pin that behaviour and guard the florist
// role from accidentally inheriting the same power.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: {
    ORDERS: 'tblOrders',
    ORDER_LINES: 'tblOrderLines',
    STOCK: 'tblStock',
    STOCK_LOSS_LOG: 'tblStockLoss',
  },
}));

vi.mock('../services/airtable.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

import * as db from '../services/airtable.js';
import { editBouquetLines } from '../services/orderService.js';
import { ORDER_STATUS } from '../constants/statuses.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editBouquetLines — status gate', () => {
  const orderId = 'recOrder123';

  it('allows owner to edit a Delivered order', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.DELIVERED });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true)
    ).resolves.toEqual({ updated: true, createdLines: [] });
  });

  it('allows owner to edit a Picked Up order', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.PICKED_UP });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true)
    ).resolves.toEqual({ updated: true, createdLines: [] });
  });

  it('allows owner to edit a Cancelled order', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.CANCELLED });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true)
    ).resolves.toEqual({ updated: true, createdLines: [] });
  });

  it('rejects non-owner on a Delivered order with a 400', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.DELIVERED });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ false)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-owner on a Picked Up order with a 400', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.PICKED_UP });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ false)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows non-owner to edit a New order', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.NEW });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ false)
    ).resolves.toEqual({ updated: true, createdLines: [] });
  });

  it('allows non-owner to edit a Ready order', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.READY });
    await expect(
      editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ false)
    ).resolves.toBeTruthy();
  });
});

describe('editBouquetLines — status auto-revert', () => {
  const orderId = 'recOrder456';

  it('reverts Ready → New when the owner edits', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.READY });
    await editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true);
    expect(db.update).toHaveBeenCalledWith(
      'tblOrders',
      orderId,
      { Status: ORDER_STATUS.NEW },
    );
  });

  it('does NOT revert a Delivered order when the owner edits', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.DELIVERED });
    await editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true);
    // The only db.update call should NOT target Status. In this no-op edit
    // case, db.update is not called at all.
    const statusUpdate = db.update.mock.calls.find(
      ([table, , fields]) => table === 'tblOrders' && 'Status' in (fields || {})
    );
    expect(statusUpdate).toBeUndefined();
  });

  it('does NOT revert a Cancelled order when the owner edits', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.CANCELLED });
    await editBouquetLines(orderId, { lines: [], removedLines: [] }, /*isOwner*/ true);
    const statusUpdate = db.update.mock.calls.find(
      ([table, , fields]) => table === 'tblOrders' && 'Status' in (fields || {})
    );
    expect(statusUpdate).toBeUndefined();
  });
});

// Regression: the dashboard's "Flowers Needed" panel filters order lines by
// {Stock Deferred} = TRUE. If the backend doesn't persist that field on new
// order lines, deferred demand is invisible to purchase planning even though
// the florist UI flagged it. Pin the field write for both branches here.
describe('editBouquetLines — persists Stock Deferred on new lines', () => {
  const orderId = 'recOrder789';

  it('writes Stock Deferred: true when adding a deferred line and does NOT deduct stock', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.NEW });
    db.create.mockResolvedValue({ id: 'recLine1' });

    await editBouquetLines(
      orderId,
      {
        lines: [{
          stockItemId: 'recStock1',
          flowerName: 'Rose',
          quantity: 5,
          costPricePerUnit: 10,
          sellPricePerUnit: 20,
          stockDeferred: true,
        }],
        removedLines: [],
      },
      /*isOwner*/ false,
    );

    expect(db.create).toHaveBeenCalledWith(
      'tblOrderLines',
      expect.objectContaining({ 'Stock Deferred': true }),
    );
    // Deferred = no stock deduction.
    expect(db.atomicStockAdjust).not.toHaveBeenCalled();
  });

  it('omits Stock Deferred when the flag is absent and DOES deduct stock', async () => {
    db.getById.mockResolvedValue({ id: orderId, Status: ORDER_STATUS.NEW });
    db.create.mockResolvedValue({ id: 'recLine2' });

    await editBouquetLines(
      orderId,
      {
        lines: [{
          stockItemId: 'recStock2',
          flowerName: 'Tulip',
          quantity: 3,
          costPricePerUnit: 8,
          sellPricePerUnit: 15,
          // no stockDeferred
        }],
        removedLines: [],
      },
      /*isOwner*/ false,
    );

    // Create payload should NOT carry Stock Deferred at all — the field is
    // optional in Airtable and writing false works too, but keeping the
    // payload minimal avoids noise when auditing field-level writes.
    const [, createdFields] = db.create.mock.calls[0];
    expect(createdFields).not.toHaveProperty('Stock Deferred');

    // Non-deferred line = stock deducted by its quantity.
    expect(db.atomicStockAdjust).toHaveBeenCalledWith('recStock2', -3);
  });
});
