import { describe, it, expect } from 'vitest';
import { buildBaseline } from './baseline.js';

describe('baseline scenario', () => {
  it('produces 5 customers, 30 stock items, 12 orders with FK integrity', () => {
    const fx = buildBaseline();
    expect(fx.customers).toHaveLength(5);
    expect(fx.stockItems).toHaveLength(30);
    expect(fx.orders).toHaveLength(12);
    expect(fx.orderLines.length).toBeGreaterThan(0);

    const orderIds = new Set(fx.orders.map(o => o.id));
    for (const ol of fx.orderLines) expect(orderIds.has(ol.order_id)).toBe(true);

    const customerIds = new Set(fx.customers.map(c => c.id));
    for (const o of fx.orders) expect(customerIds.has(o.customer_id)).toBe(true);
  });

  it('is deterministic across two builds', () => {
    const a = buildBaseline();
    const b = buildBaseline();
    // Compare stable fields only — created_at/updated_at use new Date() (wall clock),
    // app_order_id uses a module counter, so full-object equality is intentionally
    // not checked. Ids are faker-derived and must be stable.
    expect(a.customers[0].id).toEqual(b.customers[0].id);
    expect(a.customers[0].name).toEqual(b.customers[0].name);
    expect(a.customers[0].phone).toEqual(b.customers[0].phone);
    expect(a.orders[0].id).toEqual(b.orders[0].id);
    expect(a.stockItems[0].id).toEqual(b.stockItems[0].id);
    expect(a.stockItems[0].display_name).toEqual(b.stockItems[0].display_name);
  });
});
