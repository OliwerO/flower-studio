//
// The distance module (ADR-0019) — the only thing in this feature that
// touches the network. Isolated behind resolveDistance() so the rest of the
// system (deliveryPricingService, the quote route, order creation) never
// knows which map provider is in use, or whether one is configured at all.
//
// Caches by normalised address (in-memory — volume is ~25 deliveries/month,
// overwhelmingly one-off addresses per issue #618's own measurement, so this
// exists to stop an unchanged address being re-billed when an Order is
// re-edited in the same process run, not to survive a redeploy).

import { fetchDistanceKm as orsFetchDistanceKm } from './distanceProviders/openRouteService.js';
import { getConfig } from './configService.js';

const cache = new Map();

/** Cache key: trimmed, lowercased, whitespace-collapsed. */
export function normaliseAddressKey(address) {
  return String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve the driving distance from the studio to an address.
 *
 * Never throws — an unresolvable address, a missing provider key, a missing
 * studio address, or a provider error all resolve to null so order creation
 * is never blocked (ADR-0019).
 *
 * @param {string} address
 * @param {object} [opts]
 * @param {function} [opts.fetchDistanceKm] Injectable for tests — defaults to the real ORS provider.
 * @param {string} [opts.originAddress]     Injectable for tests — defaults to getConfig('studioAddress').
 * @returns {Promise<{distanceKm: number, resolvedAddress: string}|null>}
 */
export async function resolveDistance(address, opts = {}) {
  if (!address) return null;

  // Playwright E2E harness only — the real ORS provider is gated off
  // (ORS_API_KEY unset) in every test environment, so a UI click-through
  // spec needs a deterministic distance without hitting the network or
  // requiring a configured studioAddress. Set ONLY by start-test-backend.js;
  // vitest's setupPgHarness never sets this, so every existing integration
  // test still observes the real null-when-unresolvable behavior.
  if (process.env.HARNESS_STUB_DISTANCE_KM !== undefined && !opts.fetchDistanceKm) {
    return { distanceKm: Number(process.env.HARNESS_STUB_DISTANCE_KM), resolvedAddress: address };
  }

  const fetcher = opts.fetchDistanceKm || orsFetchDistanceKm;
  const origin = opts.originAddress ?? getConfig('studioAddress');
  if (!origin) return null;

  // Fold the resolved origin into the cache key — the studio address is
  // going to become owner-editable (a later settings-editor task). If the
  // key were destination-only, changing the studio address would leave
  // every previously-cached destination silently returning the distance
  // computed from the OLD origin for the rest of the process's life.
  const key = `${normaliseAddressKey(origin)}::${normaliseAddressKey(address)}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const result = await fetcher(origin, address);
    if (!result) return null;
    cache.set(key, result);
    return result;
  } catch (err) {
    console.error('[DISTANCE] provider call failed:', err.message);
    return null;
  }
}

/** Test-only: empty the in-memory cache between test cases. */
export function __clearDistanceCacheForTests() {
  cache.clear();
}
