// lab/tests/api/cancel-with-return.test.js
//
// Integration test for POST /api/orders/:id/cancel-with-return.
//
// Verifies the critical known-pitfall path (CLAUDE.md § Known Pitfalls #7):
//   - order status becomes Cancelled
//   - stock.current_quantity increases by exactly the line quantities
//
// Both assertions are required — either alone is insufficient. The pre-2026-05-02
// bug silently flipped status WITHOUT returning stock; this test is the regression gate.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, startLabBackend, stopLabBackend } from '../../helpers/api.js';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

describe('cancel-with-return returns stems to inventory', () => {
  beforeAll(async () => {
    await resetLabDb();
    await startLabBackend();
  }, 60_000);

  afterAll(stopLabBackend);

  beforeEach(async () => {
    await stopLabBackend();
    await resetLabDb();
    await startLabBackend();
  }, 60_000);

  it('increments stock.current_quantity by exactly the line quantities', async () => {
    const owner = api('owner');
    const pool = labPool();

    try {
      // 1. Find a New order with at least one line whose Stock Item is non-null.
      //    GET /api/orders?status=New returns list format (no lines embedded).
      const ordersRes = await owner.get('/api/orders?status=New');
      expect(ordersRes.status).toBe(200);
      const allOrders = Array.isArray(ordersRes.body) ? ordersRes.body : [];
      expect(allOrders.length).toBeGreaterThan(0);

      // Fetch detail for each order until we find one with stock-linked lines.
      let order = null;
      let linkedLines = [];
      for (const o of allOrders) {
        const detailRes = await owner.get(`/api/orders/${o.id}`);
        expect(detailRes.status).toBe(200);
        const detail = detailRes.body;
        // Detail response attaches lines as `orderLines` (from route line 308: order.orderLines = orderLines)
        const lines = detail.orderLines ?? [];
        // Each line has 'Stock Item': [uuid] (pgLineToResponse format).
        const linked = lines.filter(l => {
          const si = l['Stock Item'];
          return Array.isArray(si) ? si[0] : si;
        });
        if (linked.length > 0) {
          order = detail;
          linkedLines = linked;
          break;
        }
      }

      if (!order) {
        throw new Error(
          'No New order with stock-linked lines in baseline scenario. ' +
          'Inspect lab/scenarios/baseline.js — every makeOrderLine call should pass stockItemId.'
        );
      }

      // 2. Snapshot current_quantity for every linked stock item before cancellation.
      const before = new Map();
      for (const line of linkedLines) {
        const stockId = Array.isArray(line['Stock Item']) ? line['Stock Item'][0] : line['Stock Item'];
        const lineQty = Number(line.Quantity ?? line.quantity ?? 0);
        if (!stockId || lineQty === 0) continue;

        const s = await pool.query('SELECT current_quantity FROM stock WHERE id=$1', [stockId]);
        expect(s.rows.length).toBe(1);
        before.set(stockId, { qty: Number(s.rows[0].current_quantity), addBack: lineQty });
      }

      expect(before.size).toBeGreaterThan(0);

      // 3. Cancel-with-return.
      const cancelRes = await owner.post(`/api/orders/${order.id}/cancel-with-return`);
      expect(cancelRes.status).toBe(200);

      // 4. Assert order status is Cancelled (fetch fresh — route returns { message, returnedItems }).
      const afterDetail = await owner.get(`/api/orders/${order.id}`);
      expect(afterDetail.status).toBe(200);
      // Status field is 'Status' (capital S) per pgOrderToResponse wire format.
      expect(afterDetail.body.Status).toBe('Cancelled');

      // 5. Assert each stock row's current_quantity went up by exactly the line qty.
      for (const [stockId, { qty: prev, addBack }] of before) {
        const s = await pool.query('SELECT current_quantity FROM stock WHERE id=$1', [stockId]);
        expect(Number(s.rows[0].current_quantity)).toBe(prev + addBack);
      }
    } finally {
      await pool.end();
    }
  }, 30_000);
});
