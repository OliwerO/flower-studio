import { describe, it, expect } from 'vitest';
import {
  enrichOrderPrices,
  calculateRevenueMetrics,
  calculateWasteMetrics,
  rankTopProducts,
  analyzeFlowerPairings,
  calculateWeeklyRhythm,
  calculateMonthlyBreakdown,
  calculateCompletionFunnel,
  analyzeSourceEfficiency,
  analyzePaymentMethods,
  calculatePrepTimeStats,
  calculateInventoryTurnover,
  buildSupplierScorecard,
  breakdownStockLosses,
} from '../services/analyticsService.js';

// ── Helper: build a fake order ──
function makeOrder(overrides = {}) {
  return {
    id: overrides.id || 'rec' + Math.random().toString(36).slice(2, 8),
    Status: 'Delivered',
    'Payment Status': 'Paid',
    'Order Date': '2026-03-15',
    'Delivery Type': 'Delivery',
    Source: 'Instagram',
    'Payment Method': 'Card',
    ...overrides,
  };
}

// ── enrichOrderPrices ──

describe('enrichOrderPrices', () => {
  it('computes Effective Price from sell totals + delivery fees', () => {
    const orders = [makeOrder({ id: 'o1' })];
    enrichOrderPrices(orders, { o1: 100 }, { o1: 30 }, { o1: 35 });

    expect(orders[0]._flowerSell).toBe(100);
    expect(orders[0]._deliveryFee).toBe(35);
    expect(orders[0]._cost).toBe(30);
    expect(orders[0]['Effective Price']).toBe(135); // 100 + 35
  });

  it('prefers Price Override over computed total', () => {
    const orders = [makeOrder({ id: 'o1', 'Price Override': 200 })];
    enrichOrderPrices(orders, { o1: 100 }, { o1: 30 }, { o1: 35 });

    expect(orders[0]['Effective Price']).toBe(200);
  });

  it('prefers Final Price over Price Override', () => {
    const orders = [makeOrder({ id: 'o1', 'Final Price': 250, 'Price Override': 200 })];
    enrichOrderPrices(orders, { o1: 100 }, {}, {});

    expect(orders[0]['Effective Price']).toBe(250);
  });
});

// ── calculateRevenueMetrics ──

describe('calculateRevenueMetrics', () => {
  it('calculates revenue and margin from paid orders', () => {
    const orders = [
      { ...makeOrder(), _flowerSell: 100, _deliveryFee: 35, _cost: 40, 'Effective Price': 135, 'Payment Status': 'Paid' },
      { ...makeOrder(), _flowerSell: 200, _deliveryFee: 35, _cost: 80, 'Effective Price': 235, 'Payment Status': 'Paid' },
      { ...makeOrder(), _flowerSell: 50, _deliveryFee: 0, _cost: 20, 'Effective Price': 50, 'Payment Status': 'Unpaid' },
    ];
    const paidOrders = orders.filter(o => o['Payment Status'] === 'Paid');

    const result = calculateRevenueMetrics(orders, paidOrders, 2.2);

    expect(result.totalRevenue).toBe(370); // 135 + 235
    expect(result.flowerRevenue).toBe(300); // 100 + 200
    expect(result.deliveryRevenue).toBe(70); // 35 + 35
    expect(result.avgOrderValue).toBe(185); // 370 / 2
    expect(result.paidFlowerCost).toBe(120); // 40 + 80
    expect(result.allFlowerCost).toBe(140); // 40 + 80 + 20 (includes unpaid)
  });

  it('returns zeros when no paid orders', () => {
    const result = calculateRevenueMetrics([], [], 2.2);
    expect(result.totalRevenue).toBe(0);
    expect(result.avgOrderValue).toBe(0);
    expect(result.flowerMargin).toBe(0);
  });
});

// ── calculateWasteMetrics ──

describe('calculateWasteMetrics', () => {
  it('calculates waste from dead stems', () => {
    const stock = [
      { 'Dead/Unsold Stems': 10, 'Current Cost Price': 5 },
      { 'Dead/Unsold Stems': 5, 'Current Cost Price': 8 },
    ];
    const result = calculateWasteMetrics(stock, 500);

    expect(result.totalDeadStems).toBe(15);
    expect(result.unrealisedRevenue).toBe(90); // 10*5 + 5*8
    expect(result.wastePercent).toBe(18); // 90/500 * 100
  });

  it('returns 0% when no flower cost', () => {
    const result = calculateWasteMetrics([], 0);
    expect(result.wastePercent).toBe(0);
  });
});

// ── calculateCompletionFunnel ──

describe('calculateCompletionFunnel', () => {
  it('counts completed vs cancelled orders', () => {
    const orders = [
      makeOrder({ Status: 'Delivered' }),
      makeOrder({ Status: 'Picked Up' }),
      makeOrder({ Status: 'New' }),
    ];
    const cancelled = [makeOrder({ Status: 'Cancelled' })];

    const result = calculateCompletionFunnel(orders, cancelled);

    expect(result.totalCreated).toBe(4);
    expect(result.completed).toBe(2);
    expect(result.cancelled).toBe(1);
    expect(result.completionRate).toBe(50);
    expect(result.cancellationRate).toBe(25);
  });

  it('handles empty arrays', () => {
    const result = calculateCompletionFunnel([], []);
    expect(result.totalCreated).toBe(0);
    expect(result.completionRate).toBe(0);
  });
});

// ── rankTopProducts ──

describe('rankTopProducts', () => {
  it('ranks by revenue and computes trends', () => {
    const paidIds = new Set(['o1', 'o2']);
    const lines = [
      { Order: ['o1'], 'Flower Name': 'Roses', Quantity: 10, 'Sell Price Per Unit': 15, 'Cost Price Per Unit': 5 },
      { Order: ['o1'], 'Flower Name': 'Tulips', Quantity: 5, 'Sell Price Per Unit': 10, 'Cost Price Per Unit': 3 },
      { Order: ['o2'], 'Flower Name': 'Roses', Quantity: 8, 'Sell Price Per Unit': 15, 'Cost Price Per Unit': 5 },
    ];
    const prevLines = [
      { Order: ['p1'], 'Flower Name': 'Roses', Quantity: 5 },
    ];
    const prevPaidIds = new Set(['p1']);

    const result = rankTopProducts(lines, paidIds, prevLines, prevPaidIds);

    expect(result[0].name).toBe('Roses');
    expect(result[0].totalQty).toBe(18);
    expect(result[0].revenue).toBe(270); // 18 * 15
    expect(result[0].trend).toBe('up'); // 18 vs 5 (>10% increase)
    expect(result[1].name).toBe('Tulips');
    expect(result[1].trend).toBe('up'); // new product (0 → 5)
  });
});

// ── analyzeFlowerPairings ──

describe('analyzeFlowerPairings', () => {
  it('finds co-occurring flowers across orders', () => {
    const paidIds = new Set(['o1', 'o2']);
    const lines = [
      { Order: ['o1'], 'Flower Name': 'Roses' },
      { Order: ['o1'], 'Flower Name': 'Tulips' },
      { Order: ['o2'], 'Flower Name': 'Roses' },
      { Order: ['o2'], 'Flower Name': 'Tulips' },
    ];

    const result = analyzeFlowerPairings(lines, paidIds);

    expect(result.length).toBe(1);
    expect(result[0].flower1).toBe('Roses');
    expect(result[0].flower2).toBe('Tulips');
    expect(result[0].count).toBe(2);
  });

  it('ignores pairs that appear only once', () => {
    const paidIds = new Set(['o1']);
    const lines = [
      { Order: ['o1'], 'Flower Name': 'Roses' },
      { Order: ['o1'], 'Flower Name': 'Tulips' },
    ];

    const result = analyzeFlowerPairings(lines, paidIds);
    expect(result.length).toBe(0); // only 1 occurrence, needs >= 2
  });
});

// ── calculateWeeklyRhythm ──

describe('calculateWeeklyRhythm', () => {
  it('groups by day of week from Required By', () => {
    // 2026-03-16 is Monday, 2026-03-17 is Tuesday
    const orders = [
      makeOrder({ 'Required By': '2026-03-16', 'Effective Price': 100 }),
      makeOrder({ 'Required By': '2026-03-16', 'Effective Price': 200 }),
      makeOrder({ 'Required By': '2026-03-17', 'Effective Price': 150 }),
    ];

    const result = calculateWeeklyRhythm(orders, orders);

    // Monday = dayIndex 1
    const monday = result.find(d => d.dayIndex === 1);
    expect(monday.orderCount).toBe(2);
    expect(monday.avgRevenue).toBe(150); // (100+200)/2
  });
});

// ── analyzePaymentMethods ──

describe('analyzePaymentMethods', () => {
  it('breaks down by payment method and status', () => {
    const orders = [
      makeOrder({ 'Payment Method': 'Card', 'Payment Status': 'Paid', 'Effective Price': 100 }),
      makeOrder({ 'Payment Method': 'Card', 'Payment Status': 'Unpaid', 'Effective Price': 50 }),
      makeOrder({ 'Payment Method': 'Cash', 'Payment Status': 'Paid', 'Effective Price': 200 }),
    ];

    const result = analyzePaymentMethods(orders);

    const card = result.find(m => m.method === 'Card');
    expect(card.count).toBe(2);
    expect(card.paidCount).toBe(1);
    expect(card.revenue).toBe(100);
    expect(card.unpaidCount).toBe(1);
    expect(card.unpaidAmount).toBe(50);
  });
});

// ── calculatePrepTimeStats ──

describe('calculatePrepTimeStats', () => {
  it('computes prep time statistics', () => {
    const orders = [
      makeOrder({ 'Prep Started At': '2026-03-15T10:00:00Z', 'Prep Ready At': '2026-03-15T10:30:00Z' }),
      makeOrder({ 'Prep Started At': '2026-03-15T11:00:00Z', 'Prep Ready At': '2026-03-15T11:45:00Z' }),
    ];

    const result = calculatePrepTimeStats(orders);

    expect(result.count).toBe(2);
    expect(result.avgMinutes).toBe(38); // (30 + 45) / 2 = 37.5, rounded
    expect(result.minMinutes).toBe(30);
    expect(result.maxMinutes).toBe(45);
  });

  it('excludes outliers over 24 hours', () => {
    const orders = [
      makeOrder({ 'Prep Started At': '2026-03-15T10:00:00Z', 'Prep Ready At': '2026-03-16T12:00:00Z' }),
    ];

    const result = calculatePrepTimeStats(orders);
    expect(result).toBeNull();
  });

  it('returns null when no prep data', () => {
    expect(calculatePrepTimeStats([])).toBeNull();
  });
});

// ── calculateInventoryTurnover ──

describe('calculateInventoryTurnover', () => {
  it('calculates annualized turns', () => {
    const stock = [
      { 'Current Quantity': 100, 'Current Cost Price': 5 },  // value = 500
      { 'Current Quantity': -10, 'Current Cost Price': 8 },  // negative = clamped to 0
    ];

    const result = calculateInventoryTurnover(stock, 1000, 30);

    expect(result.currentStockValue).toBe(500);
    expect(result.annualizedCost).toBe(12167); // 1000 * 365/30 ≈ 12167
    expect(result.turnsPerYear).toBe(24.3); // 12167 / 500
  });
});

// ── breakdownStockLosses ──

describe('breakdownStockLosses', () => {
  it('groups losses by reason with percentages', () => {
    const losses = [
      { Reason: 'Wilted', Quantity: 30 },
      { Reason: 'Damaged', Quantity: 10 },
      { Reason: 'Wilted', Quantity: 10 },
    ];

    const result = breakdownStockLosses(losses);

    expect(result.totalQty).toBe(50);
    expect(result.byReason[0]).toEqual({ reason: 'Wilted', qty: 40, percent: 80 });
    expect(result.byReason[1]).toEqual({ reason: 'Damaged', qty: 10, percent: 20 });
  });

  it('handles empty losses', () => {
    const result = breakdownStockLosses([]);
    expect(result.totalQty).toBe(0);
    expect(result.byReason).toEqual([]);
  });
});

// ── buildSupplierScorecard ──

describe('buildSupplierScorecard', () => {
  it('aggregates purchases and merges waste data', () => {
    const purchases = [
      { Supplier: 'Stojek', 'Price Per Unit': 5, 'Quantity Purchased': 100 },
      { Supplier: 'Stojek', 'Price Per Unit': 6, 'Quantity Purchased': 50 },
      { Supplier: '4f', 'Price Per Unit': 8, 'Quantity Purchased': 30 },
    ];
    const losses = [
      { 'Stock Item': ['s1'], Quantity: 10 },
    ];
    const lossStockItems = [
      { id: 's1', Supplier: 'Stojek' },
    ];

    const result = buildSupplierScorecard(purchases, losses, lossStockItems);

    const stojek = result.find(s => s.supplier === 'Stojek');
    expect(stojek.totalSpend).toBe(800); // 5*100 + 6*50
    expect(stojek.totalQty).toBe(150);
    expect(stojek.purchaseCount).toBe(2);
    expect(stojek.wasteQty).toBe(10);
  });
});
