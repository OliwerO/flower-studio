// Navigation URL builders for external map apps.
// Text-address based — no lat/lng required, since the Delivery record
// only stores the address as free text today.
//
// Apple Maps falls back to Google Maps in the browser on Android, which
// is acceptable: iOS drivers get native Apple Maps, Android drivers
// still reach a map.

const enc = encodeURIComponent;

export function googleMapsUrl(address) {
  return address ? `https://www.google.com/maps/search/?api=1&query=${enc(address)}` : null;
}

export function wazeUrl(address) {
  return address ? `https://waze.com/ul?q=${enc(address)}&navigate=yes` : null;
}

export function appleMapsUrl(address) {
  return address ? `https://maps.apple.com/?q=${enc(address)}` : null;
}
