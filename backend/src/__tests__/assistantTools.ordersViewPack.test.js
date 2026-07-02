import { describe, it, expect } from 'vitest';
import { openOrdersViewHandler } from '../services/assistantTools/ordersViewPack.js';

describe('ordersViewPack.open_orders_view', () => {
  it('normalizes recognized filter keys and echoes the view + both labels', () => {
    const r = openOrdersViewHandler({
      status: 'New',
      paymentStatus: 'Unpaid',
      excludeCancelled: true,
      orderDateFrom: '2026-06-01',
      orderDateTo: '2026-06-30',
      priceMin: 50,
      label: 'Неоплаченные заказы за июнь',
      labelEn: 'Unpaid orders in June',
    });
    expect(r).toEqual({
      view: 'orders',
      filter: {
        status: 'New',
        paymentStatus: 'Unpaid',
        excludeCancelled: true,
        orderDateFrom: '2026-06-01',
        orderDateTo: '2026-06-30',
        priceMin: 50,
      },
      label: 'Неоплаченные заказы за июнь',
      labelEn: 'Unpaid orders in June',
    });
  });

  it('drops keys not in the canonical filter shape', () => {
    const r = openOrdersViewHandler({ status: 'New', bogusKey: 'nope', anotherOne: 123 });
    expect(r.filter).toEqual({ status: 'New' });
    expect(r.filter.bogusKey).toBeUndefined();
    expect(r.filter.anotherOne).toBeUndefined();
  });

  it('coerces types to match EMPTY_ORDER_FILTER (boolean/number/string)', () => {
    const r = openOrdersViewHandler({ excludeCancelled: 'true', priceMax: '120', source: 'Wix' });
    expect(r.filter.excludeCancelled).toBe(true);
    expect(r.filter.priceMax).toBe(120);
    expect(r.filter.source).toBe('Wix');
  });

  it('defaults to an empty filter + default RU/EN labels on empty input, never errors', () => {
    expect(openOrdersViewHandler()).toEqual({ view: 'orders', filter: {}, label: 'Отфильтрованные заказы', labelEn: 'Filtered orders' });
    expect(openOrdersViewHandler({})).toEqual({ view: 'orders', filter: {}, label: 'Отфильтрованные заказы', labelEn: 'Filtered orders' });
  });

  it('ignores a blank/non-string label and falls back to the default (each language independently)', () => {
    const r = openOrdersViewHandler({ status: 'Ready', label: '   ', labelEn: '  ' });
    expect(r.label).toBe('Отфильтрованные заказы');
    expect(r.labelEn).toBe('Filtered orders');
  });

  it('carries a Russian label with a default English label when only label is given', () => {
    const r = openOrdersViewHandler({ label: 'Заказы' });
    expect(r.label).toBe('Заказы');
    expect(r.labelEn).toBe('Filtered orders');
  });

  it('ignores null values for recognized keys (treated as absent)', () => {
    const r = openOrdersViewHandler({ status: null, source: 'Instagram' });
    expect(r.filter).toEqual({ source: 'Instagram' });
  });
});
