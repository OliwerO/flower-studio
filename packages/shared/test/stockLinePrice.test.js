import { describe, it, expect } from 'vitest';
import { resolveStockLinePrice } from '../utils/stockLinePrice.js';

const card = (qty, cost, sell) => ({
  'Current Quantity': qty,
  'Current Cost Price': cost,
  'Current Sell Price': sell,
});

describe('resolveStockLinePrice (#377)', () => {
  it('uses the pending PO sell when the flower has no physical stock', () => {
    // The owner priced a fresh PO at 60; the card still shows the last-received 65.
    const out = resolveStockLinePrice(card(0, 22.64, 65), { sell: 60, cost: 21.27 });
    expect(out.sellPricePerUnit).toBe(60);
    expect(out.costPricePerUnit).toBe(21.27);
  });

  it('keeps the card price when physical stems are on hand', () => {
    // Real stems were received at 65 — a newer pending PO must not retro-price them.
    const out = resolveStockLinePrice(card(30, 22.64, 65), { sell: 60, cost: 21.27 });
    expect(out.sellPricePerUnit).toBe(65);
    expect(out.costPricePerUnit).toBe(22.64);
  });

  it('falls back to the card price when there is no pending PO entry', () => {
    const out = resolveStockLinePrice(card(0, 10, 25), undefined);
    expect(out).toEqual({ costPricePerUnit: 10, sellPricePerUnit: 25 });
  });

  it('falls back to the card price when the pending PO line is unpriced (sell 0)', () => {
    const out = resolveStockLinePrice(card(0, 10, 25), { sell: 0, cost: 0 });
    expect(out).toEqual({ costPricePerUnit: 10, sellPricePerUnit: 25 });
  });

  it('keeps the card cost when the pending PO carries a sell but no cost', () => {
    const out = resolveStockLinePrice(card(0, 12, 30), { sell: 28, cost: 0 });
    expect(out.sellPricePerUnit).toBe(28);
    expect(out.costPricePerUnit).toBe(12);
  });

  it('treats negative on-hand (demand entry) as no physical stock', () => {
    const out = resolveStockLinePrice(card(-15, 22.64, 65), { sell: 60, cost: 21.27 });
    expect(out.sellPricePerUnit).toBe(60);
  });

  it('coerces string-numeric inputs and tolerates a missing stock item', () => {
    const out = resolveStockLinePrice(
      { 'Current Quantity': '0', 'Current Cost Price': '22.64', 'Current Sell Price': '65' },
      { sell: '60', cost: '21.27' },
    );
    expect(out.sellPricePerUnit).toBe(60);
    expect(resolveStockLinePrice(null, null)).toEqual({ costPricePerUnit: 0, sellPricePerUnit: 0 });
  });
});
