// backend/src/services/deliveryPricingService.js
//
// Pure Delivery Cost / Delivery Margin math (ADR-0019). No I/O — given a
// driving distance and a Distance Band table, return the band, the cost, and
// (given a fee) the margin. The distance module (distanceService.js) is the
// only thing that talks to the network; this module never does. The one
// import below (statuses.js) is itself dependency-free pure constants, so it
// doesn't compromise that — it just adds a constant dependency.
//
// Band shape: { id, upToKm: number|null, price: number }, sorted by upToKm
// ascending with `null` (open-ended) last. A band matches when
// distanceKm <= band.upToKm — "up to 5 km" is inclusive of 5.0 exactly.

import { DELIVERY_METHOD } from '../constants/statuses.js';

/**
 * Find the Distance Band a driving distance falls into.
 *
 * @param {number|null} distanceKm
 * @param {Array<{id: number, upToKm: number|null, price: number}>} bands
 * @returns {{id: number, upToKm: number|null, price: number}|null}
 */
export function bandForDistanceKm(distanceKm, bands) {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  if (!Array.isArray(bands) || bands.length === 0) return null;

  const sorted = [...bands].sort((a, b) => {
    if (a.upToKm == null) return 1;
    if (b.upToKm == null) return -1;
    return a.upToKm - b.upToKm;
  });

  return sorted.find(band => band.upToKm == null || distanceKm <= band.upToKm) || null;
}

/**
 * The Delivery Cost for a driving distance — the matched band's price, or
 * null if no band matches (empty table, or a distance beyond every bounded
 * band with no open-ended one configured).
 *
 * @param {number|null} distanceKm
 * @param {Array} bands
 * @returns {number|null}
 */
export function computeDeliveryCost(distanceKm, bands) {
  const band = bandForDistanceKm(distanceKm, bands);
  return band ? band.price : null;
}

/**
 * Delivery Margin = Delivery Fee − Delivery Cost. Never derive either input
 * from the other (ADR-0019) — this is the one place they are combined, and
 * only for display.
 *
 * @param {number|null} fee
 * @param {number|null} cost
 * @returns {number}
 */
export function computeDeliveryMargin(fee, cost) {
  return Number(fee || 0) - Number(cost || 0);
}

/**
 * Strip a Distance Band down to the snapshot shape that gets stored and
 * returned for display — {upToKm, price} only. Never include `id`: a
 * snapshot must never look like a reference back to the mutable, owner-
 * editable Distance Bands config (ADR-0019) — that confusion is exactly
 * what a snapshot exists to prevent.
 *
 * @param {{id: number, upToKm: number|null, price: number}|null} band
 * @returns {{upToKm: number|null, price: number}|null}
 */
export function toBandSnapshot(band) {
  if (!band) return null;
  return { upToKm: band.upToKm, price: band.price };
}

/**
 * The delivery-cost fields that must be forced to zero when the effective
 * Delivery Method is Florist — that Florist's time is already paid via
 * Florist Hours, so a nonzero Driver Payout or Taxi Cost would double-count
 * (ADR-0019). Callers merge this into whatever fields they're about to
 * write; an empty object for any other method means "don't touch these
 * fields."
 *
 * @param {string} deliveryMethod
 * @returns {{'Driver Payout'?: number, 'Taxi Cost'?: number}}
 */
export function zeroCostFieldsForMethod(deliveryMethod) {
  if (deliveryMethod === DELIVERY_METHOD.FLORIST) {
    return { 'Driver Payout': 0, 'Taxi Cost': 0 };
  }
  return {};
}
