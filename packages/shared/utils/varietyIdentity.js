/**
 * Client-side Variety identity — the mirror of `backend/src/utils/varietyIdentity.js`.
 *
 * Same basename on purpose: `grep -rn varietyIdentity` finds both halves.
 *
 * The server already refuses to create a duplicate (#603 — `POST /stock` matches
 * before it creates). This exists because the SCREEN has to decide, before it
 * posts, whether to tell the user "you already have this flower" or "this will
 * create a new one". If the two disagree, the user is asked to confirm creating
 * something that already exists — and the confirmed path (`newVariety: true`)
 * deliberately bypasses the server guard. A client that under-matches re-opens
 * the door #603 closed, so the two implementations are pinned to each other by
 * `backend/src/__tests__/varietyIdentity.parity.test.js`.
 *
 * Identity is the ADR-0006 4-tuple (Type / Colour / Size / Cultivar), strict and
 * null-aware — a blank Colour matches only a blank Colour, never "any". What is
 * added on top is tolerance for the two ways a human retypes the same flower:
 * different case and stray whitespace.
 *
 * Distinct from `poLineVariety.findVarietyMatch`, which is the PO-line lookup and
 * compares case-SENSITIVELY via `varietyKey`. Distinct from `varietyLookup`,
 * which answers a different question (every row sharing a base name, dated
 * Batches included, so a price can be inherited).
 */

/**
 * A dated Batch is one delivery of a Variety, not the Variety itself:
 * "Peony Pink 60cm (24.Jul.)". Resolving onto one would attach a new order's
 * demand to a closed delivery, so identity lookups skip them entirely
 * (pitfall `batch-variety-attrs`).
 */
export const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;

export function isDatedBatchName(name) {
  return DATE_BATCH_RE.test(String(name || '').trim());
}

/** Normalise one identity value for comparison. Blank of any kind → null. */
export function normaliseIdentityValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.toLowerCase();
}

/** Normalise a size to a number or null. `0` is a real size; `''` is not. */
export function normaliseSize(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Case-insensitive sibling of `varietyKey`. Two spellings of one flower give one
 * key; `varietyKey` would give two, which is why it cannot be reused here.
 *
 * @param {{typeName?, colour?, sizeCm?, cultivar?}} attrs
 * @returns {string}
 */
export function identityKey(attrs = {}) {
  const size = normaliseSize(attrs.sizeCm);
  return [
    normaliseIdentityValue(attrs.typeName) ?? '',
    normaliseIdentityValue(attrs.colour) ?? '',
    size != null ? size : '',
    normaliseIdentityValue(attrs.cultivar) ?? '',
  ].join('|');
}

/** Read a stock wire row's 4-tuple in either Pascal (`Type`) or snake (`type_name`) shape. */
export function stockItemIdentity(item = {}) {
  return {
    typeName: item.Type ?? item.type_name ?? null,
    colour:   item.Colour ?? item.colour ?? null,
    sizeCm:   item.Size ?? item.size_cm ?? null,
    cultivar: item.Cultivar ?? item.cultivar ?? null,
  };
}

/**
 * True when both describe the same Variety, ignoring case and whitespace.
 * Arguments are response-shaped (`{Type, Colour, Size, Cultivar}`) to match the
 * backend's `sameVariety` exactly — this signature is the parity contract.
 */
export function sameVariety(a, b) {
  return (
    normaliseIdentityValue(a?.Type)     === normaliseIdentityValue(b?.Type) &&
    normaliseIdentityValue(a?.Colour)   === normaliseIdentityValue(b?.Colour) &&
    normaliseSize(a?.Size)              === normaliseSize(b?.Size) &&
    normaliseIdentityValue(a?.Cultivar) === normaliseIdentityValue(b?.Cultivar)
  );
}

/**
 * Of several rows carrying one identity, pick the card a create should resolve
 * onto: the first undated one **in the order given**.
 *
 * The caller supplies preference order. The server orders by `created_at ASC`
 * (`stockRepo.findVarietyMatch`) so the oldest wins there; the client has no
 * creation date to sort by — `pgToResponse` does not emit one — so it takes the
 * host's stock-array order, which is stable per fetch. Duplicate undated cards
 * are what #603 now prevents, so this tiebreak is a legacy-data concern only.
 *
 * @returns {object|null} null when every candidate is a dated Batch.
 */
export function pickCanonical(rows) {
  const canonical = (rows || []).filter(r => !isDatedBatchName(r['Display Name']));
  return canonical.length ? canonical[0] : null;
}

/**
 * The single client-side answer to "does this flower already exist?".
 * Mirrors `stockRepo.findVarietyMatch` (backend/src/repos/stockRepo.js).
 *
 * @param {Array<object>} stockItems  Stock wire rows.
 * @param {{typeName?, colour?, sizeCm?, cultivar?, name?}} attrs  Form state; strings fine.
 * @returns {{match: object|null, datedBatches: object[], reason: 'match'|'dated-only'|'name-match'|'new'|'no-type'}}
 *   `dated-only` means the flower demonstrably exists — she has a delivery of it —
 *   but has no canonical card yet. That must NOT be offered as "create new": it
 *   would be a lie, and it trains the user to click through the confirm.
 */
export function resolveVariety(stockItems, attrs = {}) {
  const rows = Array.isArray(stockItems) ? stockItems : [];
  const empty = { match: null, datedBatches: [], reason: 'new' };

  // A caller naming a dated Batch is asking for that delivery row, not the card.
  if (isDatedBatchName(attrs.name)) return empty;

  const type = normaliseIdentityValue(attrs.typeName);

  if (type) {
    const key = identityKey(attrs);
    const hits = rows.filter(r => identityKey(stockItemIdentity(r)) === key);
    if (hits.length === 0) return empty;
    const match = pickCanonical(hits);
    const datedBatches = hits.filter(r => isDatedBatchName(r['Display Name']));
    if (!match) return { match: null, datedBatches, reason: 'dated-only' };
    return { match, datedBatches, reason: 'match' };
  }

  const name = normaliseIdentityValue(attrs.name);
  if (!name) return { ...empty, reason: 'no-type' };

  const byName = rows.filter(
    r => !isDatedBatchName(r['Display Name']) && normaliseIdentityValue(r['Display Name']) === name,
  );
  if (byName.length) return { match: byName[0], datedBatches: [], reason: 'name-match' };

  return empty;
}

// ── Seeding a form from a search query ───────────────────────────────────────

const EMPTY_SEED = {
  name: '', typeName: '', colour: '', sizeCm: '', cultivar: '',
  costPrice: '', sellPrice: '', supplier: '', lotSize: '', stockItemId: '',
};

/** Price/lot fields pre-fill blank when the stored value is absent or 0. */
const money = (v) => (v != null && Number(v) > 0 ? String(v) : '');

function adoptCard(query, card) {
  const id = stockItemIdentity(card);
  const size = normaliseSize(id.sizeCm);
  return {
    ...EMPTY_SEED,
    name:        card['Display Name'] || query,
    typeName:    id.typeName ? String(id.typeName) : '',
    colour:      id.colour ? String(id.colour) : '',
    sizeCm:      size != null ? String(size) : '',
    cultivar:    id.cultivar ? String(id.cultivar) : '',
    costPrice:   money(card['Current Cost Price']),
    sellPrice:   money(card['Current Sell Price']),
    supplier:    card.Supplier ? String(card.Supplier) : '',
    lotSize:     money(card['Lot Size']),
    stockItemId: card.id != null ? String(card.id) : '',
  };
}

/**
 * Decompose a free-text search query into a Variety seed, using ONLY values that
 * already exist in stock.
 *
 * **The query is a seed, never an identity.** Every surface used to do the
 * opposite — the raw text became the Type — which is how `Pink Peonies` ended up
 * as a Type beside `Peony / Pink` (#562), and how typing `DA` while looking for
 * Dahlia produced a flower named and typed `DA` (owner, 2026-07-30). When the
 * query cannot be decomposed against known values, this returns a blank Type and
 * lets the user classify it: refusing to guess is the point.
 *
 * @param {string} query
 * @param {Array<object>} stockItems
 * @param {object|null} seedStockItem  A card the host already knows the query means.
 * @returns {typeof EMPTY_SEED} All-string form shape.
 */
export function seedVarietyFromQuery(query, stockItems, seedStockItem = null) {
  const rows = Array.isArray(stockItems) ? stockItems : [];
  const raw = String(query ?? '').trim();

  if (seedStockItem) return adoptCard(raw, seedStockItem);

  // A dated name means one delivery. Seed the name and nothing else.
  if (isDatedBatchName(raw)) return { ...EMPTY_SEED, name: raw };

  if (!raw) return { ...EMPTY_SEED };

  const normalisedQuery = normaliseIdentityValue(raw);
  const exact = rows.find(
    r => !isDatedBatchName(r['Display Name']) && normaliseIdentityValue(r['Display Name']) === normalisedQuery,
  );
  if (exact) return adoptCard(raw, exact);

  // Token decomposition against known values only.
  const known = { typeName: new Map(), colour: new Map(), cultivar: new Map() };
  for (const r of rows) {
    const id = stockItemIdentity(r);
    for (const field of ['typeName', 'colour', 'cultivar']) {
      const v = id[field];
      const k = normaliseIdentityValue(v);
      if (k && !known[field].has(k)) known[field].set(k, String(v).trim());
    }
  }

  const seed = { ...EMPTY_SEED, name: raw };
  for (const token of raw.split(/\s+/)) {
    const k = normaliseIdentityValue(token);
    if (!k) continue;
    if (!seed.typeName && known.typeName.has(k)) { seed.typeName = known.typeName.get(k); continue; }
    if (!seed.colour   && known.colour.has(k))   { seed.colour   = known.colour.get(k);   continue; }
    if (!seed.cultivar && known.cultivar.has(k)) { seed.cultivar = known.cultivar.get(k); continue; }
    // A bare number, or one with a cm/см suffix, is a size.
    const sizeMatch = k.match(/^(\d{1,3})(cm|см)?$/);
    if (!seed.sizeCm && sizeMatch) seed.sizeCm = sizeMatch[1];
  }

  return seed;
}
