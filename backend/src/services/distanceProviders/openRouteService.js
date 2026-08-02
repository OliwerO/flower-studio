//
// OpenRouteService-shaped distance provider. Gated behind ORS_API_KEY — unset
// means "no provider configured", not an error: resolveDistance() falls back
// to the Owner filling the cost in by hand (non-blocking by design).
//
// Two ORS calls: geocode (address → coordinates) then Directions (driving-car
// profile, coordinates → route distance). Any failure at any step returns
// null rather than throwing — the caller (distanceService.resolveDistance)
// already wraps this in try/catch, but this file stays defensive on its own
// so a future direct caller doesn't get a surprise network error.

const ORS_BASE = 'https://api.openrouteservice.org';

async function geocode(address, apiKey) {
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(apiKey)}` +
    `&text=${encodeURIComponent(address)}&size=1&boundary.country=PL`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const coords = data?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(coords) ? coords : null;
}

/**
 * Driving distance between two addresses, via OpenRouteService.
 *
 * @param {string} originAddress       The studio address.
 * @param {string} destinationAddress  The delivery address.
 * @returns {Promise<{distanceKm: number, resolvedAddress: string}|null>}
 */
export async function fetchDistanceKm(originAddress, destinationAddress) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;

  const originCoord = await geocode(originAddress, apiKey);
  const destCoord = await geocode(destinationAddress, apiKey);
  if (!originCoord || !destCoord) return null;

  const res = await fetch(`${ORS_BASE}/v2/directions/driving-car`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [originCoord, destCoord] }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const meters = data?.routes?.[0]?.summary?.distance;
  if (meters == null) return null;

  return {
    distanceKm: Math.round((meters / 1000) * 100) / 100,
    resolvedAddress: destinationAddress,
  };
}
