// backend/src/__tests__/deliveryPricingService.test.js
import { describe, it, expect } from 'vitest';
import { bandForDistanceKm, computeDeliveryCost, computeDeliveryMargin } from '../services/deliveryPricingService.js';

const BANDS = [
  { id: 1, upToKm: 5,    price: 35 },
  { id: 2, upToKm: 7,    price: 50 },
  { id: 3, upToKm: 10,   price: 65 },
  { id: 4, upToKm: null, price: 80 },
];

describe('bandForDistanceKm', () => {
  it('picks the band for a distance inside its range', () => {
    expect(bandForDistanceKm(3, BANDS)).toEqual(BANDS[0]);
    expect(bandForDistanceKm(6, BANDS)).toEqual(BANDS[1]);
    expect(bandForDistanceKm(9, BANDS)).toEqual(BANDS[2]);
  });

  it('treats the boundary distance as belonging to the lower (cheaper) band — "up to 5 km" includes 5.0', () => {
    expect(bandForDistanceKm(5, BANDS)).toEqual(BANDS[0]);
    expect(bandForDistanceKm(5.01, BANDS)).toEqual(BANDS[1]);
  });

  it('falls into the open-ended band beyond the last bounded one', () => {
    expect(bandForDistanceKm(50, BANDS)).toEqual(BANDS[3]);
  });

  it('returns null for an empty or malformed band table', () => {
    expect(bandForDistanceKm(3, [])).toBeNull();
    expect(bandForDistanceKm(3, null)).toBeNull();
    expect(bandForDistanceKm(3, undefined)).toBeNull();
  });

  it('returns null for a null, negative, or non-finite distance', () => {
    expect(bandForDistanceKm(null, BANDS)).toBeNull();
    expect(bandForDistanceKm(-1, BANDS)).toBeNull();
    expect(bandForDistanceKm(NaN, BANDS)).toBeNull();
  });

  it('has no open-ended band and the distance exceeds every bounded one → null', () => {
    const boundedOnly = [{ id: 1, upToKm: 5, price: 35 }];
    expect(bandForDistanceKm(10, boundedOnly)).toBeNull();
  });

  it('picks the tightest-fitting band regardless of input order', () => {
    const shuffled = [BANDS[3], BANDS[1], BANDS[0], BANDS[2]];
    expect(bandForDistanceKm(3, shuffled)).toEqual(BANDS[0]);
  });
});

describe('computeDeliveryCost', () => {
  it('returns the matched band price', () => {
    expect(computeDeliveryCost(6, BANDS)).toBe(50);
  });

  it('returns null when no band matches', () => {
    expect(computeDeliveryCost(3, [])).toBeNull();
  });
});

describe('computeDeliveryMargin', () => {
  it('computes fee minus cost', () => {
    expect(computeDeliveryMargin(50, 35)).toBe(15);
  });

  it('goes negative when the fee is below cost', () => {
    expect(computeDeliveryMargin(30, 50)).toBe(-20);
  });

  it('treats a missing fee or cost as zero', () => {
    expect(computeDeliveryMargin(null, 35)).toBe(-35);
    expect(computeDeliveryMargin(50, null)).toBe(50);
    expect(computeDeliveryMargin(null, null)).toBe(0);
  });
});
