// backend/src/services/deliveryPricingService.js
//
// Pure Delivery Cost / Delivery Margin math (ADR-0019). No I/O, no imports —
// given a driving distance and a Distance Band table, return the band, the
// cost, and (given a fee) the margin. The distance module (distanceService.js)
// is the only thing that talks to the network; this module never does.
//
// Band shape: { id, upToKm: number|null, price: number }, sorted by upToKm
// ascending with `null` (open-ended) last. A band matches when
// distanceKm <= band.upToKm — "up to 5 km" is inclusive of 5.0 exactly.

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
