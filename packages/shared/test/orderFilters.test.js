import { describe, it, expect } from 'vitest';
import {
  EMPTY_ORDER_FILTER,
  clearOrderFilter,
  buildOrderQueryParams,
  orderMatchesClientFilter,
  activeOrderFilterCount,
  buildCrossTabNavFilter,
} from '../utils/orderFilters.js';

const order = {
  'App Order ID': 1042,
  'Customer Name': 'Anna Kowalska',
  'Customer Request': 'White peony bouquet',
  'Final Price': 250,
};

describe('buildOrderQueryParams', () => {
  it('returns {} for the empty filter', () => {
    expect(buildOrderQueryParams(EMPTY_ORDER_FILTER)).toEqual({});
  });
  it('maps server fields to GET /orders params', () => {
    const params = buildOrderQueryParams({
      ...EMPTY_ORDER_FILTER,
      status: 'New', source: 'Instagram', deliveryType: 'Delivery',
      paymentStatus: 'Unpaid', paymentMethod: 'Cash', excludeCancelled: true,
      orderDateFrom: '2026-06-01', orderDateTo: '2026-06-30',
      requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20',
    });
    expect(params).toEqual({
      status: 'New', source: 'Instagram', deliveryType: 'Delivery',
      paymentStatus: 'Unpaid', paymentMethod: 'Cash', excludeCancelled: '1',
      dateFrom: '2026-06-01', dateTo: '2026-06-30',
      requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20',
    });
  });
  it('omits client-only fields from query params', () => {
    const params = buildOrderQueryParams({
      ...EMPTY_ORDER_FILTER, customerQuery: 'anna', priceMin: 100,
    });
    expect(params).toEqual({});
  });
});

describe('orderMatchesClientFilter', () => {
  it('passes everything for the empty filter', () => {
    expect(orderMatchesClientFilter(order, EMPTY_ORDER_FILTER)).toBe(true);
  });
  it('matches customer/bouquet/id case-insensitively (contains)', () => {
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, customerQuery: 'KOWAL' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, bouquetQuery: 'peony' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, orderIdQuery: '104' })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, customerQuery: 'zzz' })).toBe(false);
  });
  it('applies price min/max inclusively', () => {
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMin: 250 })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMin: 251 })).toBe(false);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMax: 250 })).toBe(true);
    expect(orderMatchesClientFilter(order, { ...EMPTY_ORDER_FILTER, priceMax: 249 })).toBe(false);
  });
  it('resolves total from Price Override / Sell Total fallbacks', () => {
    expect(orderMatchesClientFilter({ 'Sell Total': 80 }, { ...EMPTY_ORDER_FILTER, priceMax: 100 })).toBe(true);
    expect(orderMatchesClientFilter({ 'Price Override': 120 }, { ...EMPTY_ORDER_FILTER, priceMin: 100 })).toBe(true);
  });
});

describe('activeOrderFilterCount', () => {
  it('is 0 for the empty filter', () => {
    expect(activeOrderFilterCount(EMPTY_ORDER_FILTER)).toBe(0);
  });
  it('counts each active dimension; a date pair counts once', () => {
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, status: 'New' })).toBe(1);
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20' })).toBe(1);
    expect(activeOrderFilterCount({ ...EMPTY_ORDER_FILTER, priceMin: 100, priceMax: 200 })).toBe(1);
  });
});

describe('clearOrderFilter', () => {
  it('returns a fresh empty filter copy', () => {
    const c = clearOrderFilter();
    expect(c).toEqual(EMPTY_ORDER_FILTER);
    expect(c).not.toBe(EMPTY_ORDER_FILTER);
  });
});

describe('buildCrossTabNavFilter', () => {
  // Regression for the Ask Blossom "Open in Orders" deep link bug: orderIdQuery
  // (an App Order ID substring like "1042") was being routed onto the legacy
  // `orderId` key, which OrdersTab/OrderListPage treat as an exact DB-UUID
  // focus target — a substring never equals a UUID, so the deep link rendered
  // an empty order list.
  it('never emits a legacy `orderId` key — orderIdQuery stays a distinct client filter', () => {
    const nav = buildCrossTabNavFilter({ ...EMPTY_ORDER_FILTER, orderIdQuery: '1042' });
    expect(nav.orderIdQuery).toBe('1042');
    expect(nav).not.toHaveProperty('orderId');
  });

  // Regression: order-placed date (orderDateFrom/To) must not collapse into
  // the legacy dateFrom/dateTo keys, which both apps map to the fulfilment
  // date (requiredByFrom/To) — a semantically different field.
  it('keeps orderDateFrom/orderDateTo separate from the legacy dateFrom/dateTo (fulfilment date)', () => {
    const nav = buildCrossTabNavFilter({
      ...EMPTY_ORDER_FILTER,
      requiredByFrom: '2026-06-10', requiredByTo: '2026-06-20',
      orderDateFrom: '2026-06-01', orderDateTo: '2026-06-30',
    });
    expect(nav.dateFrom).toBe('2026-06-10');
    expect(nav.dateTo).toBe('2026-06-20');
    expect(nav.orderDateFrom).toBe('2026-06-01');
    expect(nav.orderDateTo).toBe('2026-06-30');
  });

  it('forwards customerQuery/bouquetQuery/priceMin/priceMax so the opened view matches the model\'s answer', () => {
    const nav = buildCrossTabNavFilter({
      ...EMPTY_ORDER_FILTER,
      customerQuery: 'Ivanov', bouquetQuery: 'peony', priceMin: 100, priceMax: 500,
    });
    expect(nav.customerQuery).toBe('Ivanov');
    expect(nav.bouquetQuery).toBe('peony');
    expect(nav.priceMin).toBe(100);
    expect(nav.priceMax).toBe(500);
  });

  it('translates paymentStatus to the legacy `payment` key', () => {
    const nav = buildCrossTabNavFilter({ ...EMPTY_ORDER_FILTER, paymentStatus: 'Unpaid' });
    expect(nav.payment).toBe('Unpaid');
  });
});
