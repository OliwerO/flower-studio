// Variety identity — the one place that decides whether two flowers are "the
// same flower" (#562).
//
// A Variety is the 4-tuple Type / Colour / Size / Cultivar (ADR-0006, strict
// and null-aware: a blank Colour is its own identity, never a wildcard). What
// this module adds is tolerance for the two ways a human retypes the same
// flower — different case and stray whitespace — because those are what
// actually produce duplicate cards in production (`peony` beside `Peony`,
// `sarah bernhard` beside `Sarah Bernhardt`).
//
// Keep every comparison in the app going through here. The 2026-07-30 survey
// found seven create-a-flower paths, each with its own ad-hoc name check; one
// of them (`Pink Peonies` → Type `Pink Peonies`) is how #562 happened.

// A dated Batch is one delivery of a Variety, not the Variety itself:
// "Peony Pink (24.Jul.)". The canonical (undated) card is what a create should
// resolve onto — matching a Batch would attach new stems to a closed delivery
// and hide them from the grouped Stock view (pitfall `batch-variety-attrs`).
export const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;

export function isDatedBatchName(name) {
  return DATE_BATCH_RE.test(String(name || '').trim());
}

// Normalise one identity value for comparison. Empty/whitespace-only → null so
// '' and null are the same absence, matching how the repo stores them.
export function normaliseIdentityValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.toLowerCase();
}

// Normalise a size to a number or null — sizes arrive as '60', 60 and ''.
export function normaliseSize(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// True when both rows describe the same Variety, ignoring case and whitespace.
// Each argument is a `{ Type, Colour, Size, Cultivar }` response-shaped object.
export function sameVariety(a, b) {
  return (
    normaliseIdentityValue(a?.Type)     === normaliseIdentityValue(b?.Type) &&
    normaliseIdentityValue(a?.Colour)   === normaliseIdentityValue(b?.Colour) &&
    normaliseSize(a?.Size)              === normaliseSize(b?.Size) &&
    normaliseIdentityValue(a?.Cultivar) === normaliseIdentityValue(b?.Cultivar)
  );
}

// Of several rows carrying one identity, pick the card a create should resolve
// onto: the canonical undated one, oldest first so repeated calls are stable.
// Returns null when every candidate is a dated Batch — the canonical card does
// not exist yet and the caller should create it.
export function pickCanonical(rows) {
  const canonical = (rows || []).filter(r => !isDatedBatchName(r['Display Name']));
  if (canonical.length === 0) return null;
  return canonical.reduce((best, r) => {
    const t = (x) => new Date(x['Created At'] || x.createdAt || 0).getTime();
    return t(r) < t(best) ? r : best;
  }, canonical[0]);
}
