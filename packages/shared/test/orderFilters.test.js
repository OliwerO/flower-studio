import { describe, it, expect } from 'vitest';
import {
  EMPTY_ORDER_FILTER,
  clearOrderFilter,
  buildOrderQueryParams,
  orderMatchesClientFilter,
  activeOrderFilterCount,
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
