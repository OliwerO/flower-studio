// Split "Rose Red (14.Mar.)" into { name: "Rose Red", batch: "14.Mar." }.
//
// Y-model display names also include ISO dates like
// "Peony Pink 50cm (2026-05-13)" — we normalise those to the short tag form
// so the dropdown badge is consistent across all rows.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortenIso(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const day = Number(m[3]);
  const month = MONTHS_SHORT[Number(m[2]) - 1] || m[2];
  return `${day}.${month}.`;
}

export default function parseBatchName(displayName) {
  const raw = displayName || '';
  // Short tag "(14.Mar.)" first — matches the legacy display name shape.
  const short = raw.match(/^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/);
  if (short) return { name: short[1], batch: short[2] };
  // ISO date "(2026-05-13)" → "13.May." — Y-model display names.
  const iso = raw.match(/^(.+?)\s*\((\d{4}-\d{2}-\d{2})\)$/);
  if (iso) return { name: iso[1], batch: shortenIso(iso[2]) };
  return { name: raw, batch: null };
}
