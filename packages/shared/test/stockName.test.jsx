// @vitest-environment jsdom
//
// stockName — the date-tag badge on a stock row.
//
// It had its own copy of the short-form regex, so an ISO-tagged row like
// `Dahlia Coral (2026-07-23)` rendered the raw parenthesis as part of the
// flower's NAME instead of as a delivery badge. `parseBatchName` has always
// read both forms; these pin that this file uses it rather than a private
// fourth variant.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderStockName, stockBaseName, renderDateTag } from '../utils/stockName.jsx';

const text = (node) => render(<div>{node}</div>).container.textContent;

describe('stockName — both date-tag forms', () => {
  it('splits a short tag into name + badge', () => {
    expect(stockBaseName('Peony Pink (24.Jul.)')).toBe('Peony Pink');
    expect(text(renderDateTag('Peony Pink (24.Jul.)'))).toBe('24.Jul.');
  });

  it('splits an ISO tag too, normalised to the short badge form', () => {
    expect(stockBaseName('Dahlia Coral (2026-07-23)')).toBe('Dahlia Coral');
    expect(text(renderDateTag('Dahlia Coral (2026-07-23)'))).toBe('23.Jul.');
  });

  it('keeps an ISO tag out of the rendered flower name', () => {
    expect(text(renderStockName('Dahlia Coral (2026-07-23)'))).toBe('Dahlia Coral23.Jul.');
  });

  it('leaves an untagged name alone', () => {
    expect(stockBaseName('Peony Pink')).toBe('Peony Pink');
    expect(renderDateTag('Peony Pink')).toBe(null);
    expect(text(renderStockName('Peony Pink'))).toBe('Peony Pink');
  });

  it('falls back to the last-restocked date when the name carries no tag', () => {
    expect(text(renderDateTag('Peony Pink', '2026-07-23'))).toBe('23.Jul.');
  });

  it('is empty-safe', () => {
    expect(renderStockName('')).toBe('');
    expect(stockBaseName(null)).toBe('');
    expect(renderDateTag(undefined)).toBe(null);
  });
});
