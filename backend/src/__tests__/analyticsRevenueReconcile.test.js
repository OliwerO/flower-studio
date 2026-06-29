import { describe, it, expect } from 'vitest';
import { calculateRevenueMetrics } from '../services/analyticsService.js';

// Repro for the prod revenue mismatch: total (net charged) < flowers (gross list)
// when orders carry a Price Override / Final Price discount. The invariant the
// owner expects: total === flowers + delivery.
function order({ id, flowerSell, deliveryFee = 0, override, finalPrice }) {
  const effective = finalPrice ?? ((override ?? flowerSell) + deliveryFee);
  return { id, _flowerSell: flowerSell, _deliveryFee: deliveryFee, _cost: 0, 'Effective Price': effective };
}

describe('computeAnalytics revenue reconciliation', () => {
  it('total must equal flowers + delivery, even with discounts/overrides', () => {
    const orders = [
      order({ id: 'a', flowerSell: 100, deliveryFee: 20 }),               // plain: charged 120
      order({ id: 'b', flowerSell: 200, override: 150 }),                 // discounted to 150
      order({ id: 'c', flowerSell: 300, deliveryFee: 30, finalPrice: 250 }), // final price 250 (incl delivery)
    ];
    const r = calculateRevenueMetrics(orders, orders, 2.2);
    // total = 120 + 150 + 250 = 520
    expect(r.totalRevenue).toBe(520);
    // delivery = 20 + 0 + 30 = 50
    expect(r.deliveryRevenue).toBe(50);
    // THE INVARIANT: flowers must be the net flower portion so it reconciles.
    expect(r.totalRevenue).toBe(r.flowerRevenue + r.deliveryRevenue);
    expect(r.flowerRevenue).toBe(470); // 520 - 50
  });
});
