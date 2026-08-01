# Bouquet-builder Variety picker — implementation plan

> Generated 2026-07-30 from a 8-agent survey of the five bouquet create-a-flower surfaces.
> Issue: #605. Inventory: `docs/superpowers/reports/2026-07-30-variety-entry-surface-inventory.md` rows 4-8.
> Owner report that pinned the naming half (2026-07-30): typing `DA` then "+ Add new" saved `DA` as the flower NAME and pre-filled it as the Type.

# Shared "create a flower" component — implementation design

Branch context: worktree `bouquet-variety`, HEAD `36c2829` (PR #603 landed). All paths below are absolute-from-repo-root under `/Users/oliwer/Projects/flower-studio/.claude/worktrees/bouquet-variety/`.

---

## 0. The one rule the whole design turns on

**The typed search string is a seed for the form. It is never an identity.**

All five surfaces today violate this: the raw query becomes `typeName` (via `createBouquetDemand.js:144` in `fallback` mode, or via the hosts' own `typeName: q` pre-fills at `OrderDetailPanel.jsx:834`, florist `steps/Step2Bouquet.jsx:643`, dashboard `steps/Step2Bouquet.jsx:435`). That is the exact `Pink Peonies`-as-a-Type shape of #562. The new component decomposes the query against what already exists, and **refuses to guess a Type** when it cannot. Everything else — the dropdowns, the badge, the confirm — is machinery serving that rule.

---

## 1. The component

### File
`packages/shared/components/BouquetFlowerForm.jsx` — deliberate sibling of `packages/shared/components/PoLineForm.jsx`. Same idiom, same badge vocabulary, same amber confirm, different domain (a bouquet demand, not a PO line).

Supporting new files:
- `packages/shared/utils/varietyIdentity.js` — client mirror of `backend/src/utils/varietyIdentity.js` (§4)
- `packages/shared/test/varietyIdentity.test.js`
- `packages/shared/test/BouquetFlowerForm.test.jsx`
- `tests/e2e/bouquet-flower-form.spec.js`

### Exact props contract

```js
export default function BouquetFlowerForm({
  // ── identity seed ────────────────────────────────────────────────
  seedQuery,        // string   — REQUIRED. The raw text the user typed in the
                    //            host's flower search. Used ONLY to seed; never
                    //            sent as an identity. Host supplies.
  seedStockItem,    // object|null — default null. A stock wire row the host
                    //            already knows the query means (exact display-name
                    //            hit). When given, the form opens fully resolved.
                    //            Host supplies (or passes null and lets
                    //            seedVarietyFromQuery find it).
  nameEditable,     // boolean  — default false. true on the two wizards (rows 7/8),
                    //            false on the three order editors (rows 4/5/6).

  // ── data (already loaded on every host — see §3) ────────────────
  stockItems,       // Array<stockWireRow> — REQUIRED. The full
                    //            `/stock?includeEmpty=true&includeInactive=true`
                    //            array. Source of BOTH the dropdown options and
                    //            the identity resolution. Host supplies.
  apiClient,        // axios instance — REQUIRED. The host app's own client
                    //            (`apps/<app>/src/api/client.js`). Host supplies.

  // ── optional fields (visibility only, never layout — PoLineForm rule) ──
  fields,           // { supplier?: boolean, lotSize?: boolean }
                    //            default { supplier: false, lotSize: false }
  suppliers,        // string[]  — default []. Datalist values for the supplier
                    //            input. Host supplies from useConfigLists().
  targetMarkup,     // number    — default 0. >0 enables cost→sell suggestion.
                    //            Host supplies from useConfigLists().

  // ── presentation ─────────────────────────────────────────────────
  dense,            // boolean   — default false. true = phone-tight (rows 4/5):
                    //            text-sm, tighter padding, 4-tuple collapsed
                    //            behind the "Уточнить" disclosure. See §5.
  idPrefix,         // string    — REQUIRED, unique per mount point. datalist ids.
                    //            e.g. 'bff-florist-card', 'bff-dash-odp'.
  t,                // object    — REQUIRED. The host app's translations proxy.
  showToast,        // (msg, type) => void — REQUIRED. Host's useToast().

  // ── outcomes ─────────────────────────────────────────────────────
  onCreated,        // ({ stockItem, line, resolved, form }) => void — REQUIRED.
                    //            Fired ONLY on a successful write. `line` is
                    //            createBouquetDemand's canonical line;
                    //            `stockItem` is the created-or-resolved card;
                    //            `resolved` is true when an existing card was
                    //            reused (200 / client match) rather than created;
                    //            `form` is the final form state (hosts that need
                    //            the supplier string for a settings write-back).
  onCancel,         // () => void — REQUIRED. User pressed Cancel. The component
                    //            NEVER self-closes on error (today all five
                    //            hosts wipe the form on failure).
})
```

**No host needs an adapter.** The five differences that used to force divergence are all props: `nameEditable`, `fields`, `dense`, `suppliers`/`targetMarkup`, and `onCreated` (which lets each host keep its own line-append convention — `setEditLines(p => [...p, line])` on rows 4/5/6, `addOne(...)` on rows 7/8).

Two things stay in the host and must not be pulled in:
- **The affordance itself** (the `+ Добавить новый "<query>"` row). It lives inside each host's picker list, uses `onPointerDown` in `OrderCard.jsx:705` for tap-region reasons, and is styled to continue the list. The component is the *form*, mounted where each host mounts its form today.
- **The florist wizard's supplier settings write-back** (`steps/Step2Bouquet.jsx:796-798`) — explicitly a call-site concern per its own comment. It moves into that host's `onCreated`, keyed off `form.supplier` vs `configSuppliers`.

### Internal state

```js
const [form, setForm]      = useState(() => seedVarietyFromQuery(seedQuery, stockItems, seedStockItem));
// form = { name, typeName, colour, sizeCm, cultivar, costPrice, sellPrice, supplier, lotSize }
//        all strings, exactly like today's four form states.
const [refineOpen, setRefineOpen] = useState(!form.typeName); // dense-mode disclosure
const [confirming, setConfirming] = useState(false);          // amber prompt showing
const [saving, setSaving]         = useState(false);          // double-submit lock
```

Derived every render (no extra state — the PoLineForm lesson):

```js
const resolution = resolveVariety(stockItems, form);   // §4
const sizeOptions = useMemo(...)  // identical to PoLineForm.jsx:77-87: sizes stocked for this Type
const suggestions = useMemo(...)  // existing Varieties of this Type (or top Types when no Type yet)
```

### Testids
`bouquet-flower-form` (root), `bff-name`, `bff-resolved-name`, `bff-variety-badge`, `bff-suggestions` / `bff-suggestion`, `bff-refine-toggle`, `bff-cost`, `bff-sell`, `bff-supplier`, `bff-lot`, `bff-submit`, `bff-cancel`, `bff-new-variety-prompt`, `bff-new-variety-confirm`, `bff-new-variety-cancel`. The 4-tuple inputs keep `NewVarietyFields`' existing `nv-type` / `nv-colour` / `nv-size` / `nv-cultivar` — unchanged, so `NewVarietyFields.test.jsx` and the PO specs still hold.

---

## 2. The interaction, step by step

The badge is the whole UI contract. Three states, matching `PoLineForm.jsx:182-186` so the owner learns one idiom:

| state | condition | badge | submit |
|---|---|---|---|
| `none` | no Type | gray `{t.varietyNone}` «не выбран» | **disabled** |
| `linked` | tuple resolves to an existing card (incl. "exists only as dated Batches") | emerald `{t.varietyLinked}` «из карточки склада» + the card's Display Name | submits straight through |
| `new` | Type present, nothing matches | amber `{t.newVariety}` «Новый сорт» | opens the confirm |

### (a) Picking an existing flower

She taps `+ Добавить новый "пион"`. The form opens with `seedVarietyFromQuery` having already run:

- If `"пион"` case-insensitively equals a known **Type** in `stockItems` → `typeName: "Пион"`, everything else blank. Badge is `new` (Пион with blank Colour/Size/Cultivar may not exist as a card).
- Immediately under the header, the **suggestion chips** appear: every existing Variety of Type Пион, rendered through `varietyDisplayName` — `Пион Розовый 60см`, `Пион Белый Sarah B.`, `Пион Красный`. One tap fills all four fields.
- Tapping a chip → badge flips emerald, header shows the card's Display Name, and cost/sell **pre-fill from that card** when they're still blank (`Current Cost Price` / `Current Sell Price`; a `0` pre-fills as blank exactly as today).
- She types a price if she wants a different one, presses `{t.addToCart}` «Добавить в букет». No confirm. `createBouquetDemand` takes its reuse branch and PATCHes the price onto that card's undated Demand Entry — same behaviour as today, now visibly so.

This is the literal answer to the owner's ask: the chips are the "drop-down of what you've had before", visible without focusing a field (a `<datalist>` on a phone is invisible until you tap into the input — that's why chips, not only datalists).

### (b) Typing something that resolves to an existing flower

She ignores the chips and types into the fields: Type `пион` (lowercase), Colour ` Розовый ` (stray space), Size `60`.

`resolveVariety` normalises exactly like the server (`trim().toLowerCase()`, null-aware, dated Batches excluded, oldest undated wins) and finds `Пион Розовый 60см`. Badge flips emerald **as she types**, header switches to the card's real Display Name. **No confirm.** Submit reuses the card.

This is the case today's code gets wrong in the UI: `poLineVariety.findVarietyMatch` does not lowercase (`varietyKey`'s `norm` only maps `''`→null), so `peony` vs `Peony` reads as "new" on the client while the server says "exists". Closing that is §4's job.

Sub-case, and it matters: the tuple matches **only dated Batches** (`Пион Розовый 60см (24.Jul.)`, no undated card). `resolveVariety` returns `reason: 'dated-only'`. That is **treated as `linked`, and must NOT prompt** — the flower demonstrably exists, she has a delivery of it. `createBouquetDemand.js:121-132` correctly creates a fresh undated Demand Entry inheriting the Batch's price. Prompting "create a new variety?" there would be a lie and would train her to click through the prompt.

### (c) Typing something genuinely new

Type `Ранункулюс`, Colour `Персиковый`. Nothing matches. Badge amber. She fills cost/sell and presses «Добавить в букет».

Instead of submitting, the amber prompt renders inline below the fields (same markup shape as `PoLineForm.jsx:223-256`, testid `bff-new-variety-prompt`):

> **Такого цветка ещё нет. Создать новый сорт?**
> **Ранункулюс Персиковый**
> [ Создать новый ] [ Отмена ]

The bold line is `varietyDisplayName(tuple)` — literally the name of the card that will exist. What she sees in the prompt is what gets created.

- **Создать новый** → `createBouquetDemand({ ..., newVariety: true })`. `backend/src/routes/stock.js:426` skips the resolve and 201s a genuinely new Variety carrying all four attrs.
- **Отмена** → prompt closes, **the form stays open with everything she typed**. She can pick a chip instead, or fix a typo. (Today every one of the five hosts wipes the form on any exit — `OrderCard.jsx:766`, `OrderDetailPage.jsx:550`, `OrderDetailPanel.jsx:914-915` all sit outside the try/catch.)

**Where this differs from `PoLineForm` and why.** `PoLineForm.jsx:139` gates the prompt on `!matched && value.stockItemId` — it only protects a line that *already had* a link. A bouquet add starts with no link, so that gate would never fire. The bouquet gate is the opposite: **prompt on submit whenever `reason === 'new'`.** Worth a comment in the file, because a future reader will "fix" it back.

### Russian strings

New keys, added flat (top level) to **both** `apps/florist/src/translations.js` and `apps/dashboard/src/translations.js`, in the `en` and `ru` blocks:

| key | EN | RU |
|---|---|---|
| `newVarietyConfirm` | `No such flower yet. Create it as a new variety?` | `Такого цветка ещё нет. Создать новый сорт?` |
| `newVarietyCreate` | `Create new` | `Создать новый` |
| `varietyResolved` | `Existing flower — will be reused` | `Существующий цветок — будет использован` |
| `varietyTypeRequired` | `Choose a type first` | `Сначала укажите тип` |
| `varietyRefine` | `Refine` | `Уточнить` |
| `varietySuggestions` | `You already have` | `У вас уже есть` |

Plus, **florist only** (dashboard already has them flat at `translations.js:772-774 / 2006-2008`; florist nests them under `t.po`, which a bouquet surface must not read):

| key | EN | RU |
|---|---|---|
| `varietyLinked` | `from stock card` | `из карточки склада` |
| `varietyNone` | `not selected` | `не выбран` |
| `newVariety` | `new variety` | `Новый сорт` |

Plus, **both apps**: `flowerName` → `Название цветка` (florist has it only at `po.flowerName:467`; dashboard only as `flowerNameLabel:755` — which is why both wizards' name placeholder renders the English literal `'Flower name'` in the Russian UI today, `steps/Step2Bouquet.jsx:698` / `:488`).

Already present in both and reused unchanged: `flowerType`, `flowerColour`, `flowerCultivar`, `flowerSizeCm`, `addNewFlower`, `addToCart`, `cancel`, `costPrice`, `sellPrice`, `supplier`, `lotSize`, `error`.

`newVarietyConfirm` / `newVarietyCreate` are also the two keys `PoLineForm.jsx:229,244` falls back to English on **today**, in shipped UI. Adding them fixes the PO screen for free — mention it in the PR.

The component reads them through a `tx` cascade (`PoLineForm.jsx:72` idiom, minus `t.shopping`):

```js
const tx = (key, fallback) => t[key] ?? t.po?.[key] ?? fallback;
```

---

## 3. Where the options come from

**No new endpoint, no new fetch, no new hook. The options are derived in-memory from the `stockItems` array each host already holds.**

Verified per screen — all five already fetch with both flags, so their array includes zero-qty and inactive cards:

| # | screen | array | fetch |
|---|---|---|---|
| 4 | florist `components/OrderCard.jsx` | prop `editorStockItems` | `apps/florist/src/pages/OrderListPage.jsx:380` `cachedGet('/stock?includeEmpty=true&includeInactive=true')` |
| 5 | florist `pages/OrderDetailPage.jsx` | local `stockItems` | `:402`, refetch `:545` |
| 6 | dashboard `components/OrderDetailPanel.jsx` | local `stockItems` | `:169` (Promise.all), refetch `:654` |
| 7 | florist `components/steps/Step2Bouquet.jsx` | prop `stock` | `apps/florist/src/pages/NewOrderPage.jsx:388` |
| 8 | dashboard `components/steps/Step2Bouquet.jsx` | prop `stock` | `apps/dashboard/src/components/NewOrderTab.jsx:269` |

`NewVarietyFields.jsx:25-37` already derives Type/Colour/Cultivar datalists this way (dual-reading `s['Type'] ?? s.type_name`). The component adds two more derivations, both patterned on code already in the repo:

- **`sizeOptions`** — copy of `PoLineForm.jsx:77-87`: the sizes actually stocked for the chosen Type, passed into `NewVarietyFields`' existing `sizeOptions` prop. This makes "pick a different size" read as *choosing an existing Variety* rather than inventing one. None of the five surfaces pass it today, so their Size field has no suggestions at all.
- **`suggestions`** — the chip row: `groupByVariety(stockItems)` (`packages/shared/utils/varietyKey.js:35`) filtered to the chosen Type (or the N most-populated Types when no Type is chosen yet), capped at 12, rendered through `varietyDisplayName`.

### Why NOT `GET /api/stock/distinct/:column`

It exists (`backend/src/routes/stock.js:493`, allow-list `stockRepo.js:1031`, used only by the two florist PO screens) and it would work. It is the wrong choice here for one specific reason:

**It is a second source of truth that can disagree with the array the component resolves against.** `distinctValues` filters only `deleted_at IS NULL` and includes dated-Batch rows; `stockItems` is the `/stock` list. If the dropdown offers a Type that isn't in `stockItems`, the client says "new variety" and raises the confirm for a flower that exists — recreating, on the bouquet side, exactly the client/server skew §4 exists to kill. Derive the options from the same array you resolve against, and the badge can never contradict the dropdown.

Secondary reasons: it costs 2-4 extra requests per form open on screens that already have the data; and it has the `typeName`-not-`type` trap that already shipped an empty dropdown to prod (`apps/florist/src/pages/ShoppingSupportPage.jsx:46-51`).

**The one gap this leaves**, stated honestly: if a future host ever fetches `/stock` *without* `includeEmpty`/`includeInactive`, its option set narrows and a genuinely-existing flower reads as new. The component cannot detect that. The safety net is the server: `POST /stock` without `newVariety: true` still resolves and returns 200 with the existing card, and the component reports `resolved: true` in `onCreated`. On the confirmed path (`newVariety: true`) the server guard is deliberately bypassed — so **the confirm is the last line of defence**, which is why it must be hard to click through (typed identity shown in bold, cancel restores nothing lost).

---

## 4. The client-side identity lookup

### New file: `packages/shared/utils/varietyIdentity.js`

Same basename as `backend/src/utils/varietyIdentity.js` **on purpose** — `grep -rn varietyIdentity` finds both halves of the mirror.

```js
export const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;

export function isDatedBatchName(name)          // mirror of backend :21
export function normaliseIdentityValue(value)   // mirror of backend :27 — trim + toLowerCase, ''→null
export function normaliseSize(value)            // mirror of backend :34 — ''/null→null, Number if finite
export function identityKey(attrs)              // NEW (client-only): the case-insensitive sibling of
                                                // varietyKey — join(normalised 4-tuple, '|')
export function stockItemIdentity(item)         // {Type,Colour,Size,Cultivar} ?? snake → normalised tuple
export function sameVariety(a, b)               // mirror of backend :42
export function pickCanonical(rows)             // mirror of backend :55 — drop dated, oldest Created At

/**
 * The single client-side answer to "does this flower already exist?".
 * Mirrors stockRepo.findVarietyMatch (backend/src/repos/stockRepo.js:658-690).
 *
 * @param {Array<object>} stockItems  Stock wire rows.
 * @param {{typeName, colour, sizeCm, cultivar, name?}} attrs  Form state (strings ok).
 * @returns {{
 *   match: object|null,      // canonical undated card carrying this identity
 *   datedBatches: object[],  // rows with this identity that ARE dated batches
 *   reason: 'match'|'dated-only'|'name-match'|'new'|'no-type',
 * }}
 */
export function resolveVariety(stockItems, attrs)

/**
 * Decompose a free-text search query into a Variety seed, using ONLY values
 * that already exist in stock. Refuses to invent a Type (#562).
 *
 * @returns {{name, typeName, colour, sizeCm, cultivar, costPrice, sellPrice, supplier, lotSize}}
 */
export function seedVarietyFromQuery(query, stockItems, seedStockItem = null)
```

`resolveVariety` branch order, mirroring the server exactly:

1. `isDatedBatchName(attrs.name)` → `{ match: null, reason: 'new' }`. A caller naming a batch is asking for that delivery row; the server refuses to resolve it (`stockRepo.js:664`) and so must we.
2. Type present → filter by `identityKey` equality over the whole 4-tuple (null-aware: blank Colour matches blank Colour only, `size 0` is a real size). `match = pickCanonical(hits)`. If `hits.length && !match` → `reason: 'dated-only'` (and `match` is set to `pickCanonical`'s input head so the UI can name the batch, but `stockItemId` is not adopted).
3. No Type → display-name fallback: `normaliseIdentityValue(s['Display Name']) === normaliseIdentityValue(attrs.name)`, dated excluded → `reason: 'name-match'`. (Mirrors `stockRepo.js:677-678`.)
4. Otherwise `reason: 'new'`, or `'no-type'` when there is neither Type nor name.

`seedVarietyFromQuery` order:

1. `seedStockItem` given, or an exact case/whitespace-insensitive undated Display-Name hit → seed the full tuple + prices + supplier from that card. (This replaces the four hosts' ad-hoc `existing` lookups at `OrderCard.jsx:709`, `OrderDetailPage.jsx:495`, `OrderDetailPanel.jsx:824`, both `steps/Step2Bouquet.jsx:631/:423` — which use bare `===` on Display Name, the thing pitfall `variety-identity-door` forbids.)
2. Token decomposition against **known values only**: split the query on whitespace; a token matching a known Type → `typeName`; a token matching a known Colour → `colour`; a bare `\d+` token (or `60cm`/`60см`) → `sizeCm`; a token matching a known Cultivar → `cultivar`. `"пион розовый 60"` → the full tuple, zero typing.
3. Nothing matched → `{ name: query, typeName: '' }`. **The query never becomes the Type.**

### What happens to `packages/shared/utils/varietyLookup.js`

**It stays, unchanged in behaviour, with two edits.**

It is still correct for what it does: `findAllMatchingVariety(stockItems, baseName)` is a *base-name* lookup that returns the undated Demand Entry **plus every dated Batch** of that name — and `createBouquetDemand.js:125-132` genuinely needs that list to inherit price from the most-recently-restocked Batch. `resolveVariety` cannot replace it; they answer different questions.

Edits:
1. **Doc comment** at the top naming it the name-only fallback and pointing at `varietyIdentity.resolveVariety` as the identity path, so the next session doesn't reach for the wrong one.
2. **Fix the barrel.** `packages/shared/index.js:95` currently re-exports it *through the hook*: `export { findAllMatchingVariety } from './hooks/useOrderEditing.js'`. That drags the entire `useOrderEditing` module — which has **no live app consumer** (`grep -rni orderediting apps` finds only three comments) — into every app's bundle for one 17-line function. Re-point it at `./utils/varietyLookup.js`. Behaviour-identical; build all three apps to confirm.

`useOrderEditing.js` itself is out of scope. It is dead relative to all five surfaces; deleting it (and its two orphan hosts `apps/florist/src/components/OrderCardExpanded.jsx`, `apps/dashboard/src/components/order/BouquetSection.jsx`) is a separate PR, same class as the `StockItem.jsx` corpse removal recorded in pitfall `stock-math`.

### The one change to `createBouquetDemand.js`

Two new **optional** params. No existing caller changes shape.

```js
export async function createBouquetDemand({
  apiClient, stockItems = [], displayName, variety = {}, varietyDraft,
  costPrice = 0, sellPrice = 0, quantity = 1, supplier, lotSize,
  resolvedStockItem,   // NEW: a card the caller has ALREADY resolved. When it is
                       // an undated row, take the reuse branch against it and skip
                       // findAllMatchingVariety entirely — so the badge the user
                       // saw and the record actually written can never disagree.
  newVariety,          // NEW: when true, include `newVariety: true` in POST /stock.
                       // Set ONLY after an explicit user confirm. Never defaulted.
})
```

Implementation: at `:88`, `const demandEntry = resolvedStockItem && parseBatchName(resolvedStockItem['Display Name'] || '').batch === null ? resolvedStockItem : <existing lookup>;`. At `:160`, `if (newVariety === true) postBody.newVariety = true;`.

Why this and not a rewrite of the util's branch logic: six surfaces call it, and its `fallback`/`presence`/`none` tuple modes are load-bearing back-compat. Adding an input the component supplies is a two-line change with a hard back-compat assertion; rewriting the reuse decision is a behaviour change on five call sites this feature isn't touching.

---

## 5. Rows 4 and 5 — attributes without wrecking the phone

`apps/florist/src/components/OrderCard.jsx` (inline editor inside an expanded card inside a scrolling list) and `apps/florist/src/pages/OrderDetailPage.jsx`. Today: search → `+ Добавить новый` → two price inputs → Добавить. Two taps to a line, and `Type` = the whole query, silently.

Bolting four more inputs into that card would kill it. The design is **pre-resolution plus progressive disclosure**, with `dense={true}`:

**What renders, top to bottom, in dense mode:**

1. **One-line resolved header** (`bff-resolved-name` + `bff-variety-badge`) — the composed Variety name and the badge. Read-only (`nameEditable={false}`). It updates live as the tuple changes, so it can never show the old card's name for a changed tuple — the `PoLineForm.jsx:150-154` "White peony called Peony Pink 60cm" lesson, applied here.
2. **Suggestion chips** (`bff-suggestions`) — a single horizontally-scrolling row, max 2 lines tall, of Varieties she already has. One tap fills the tuple. This is the whole dropdown, visible, thumb-sized, no keyboard.
3. **Prices** — the same `grid grid-cols-2` two inputs at the same place on the screen as today (`OrderCard.jsx:733-748`).
4. **`Уточнить ▾` disclosure** (`bff-refine-toggle`) — collapsed by default, containing `NewVarietyFields`' 2×2 grid. Auto-expanded **only** when the seed produced no Type (case (c) in §2), which is exactly when the fields are the point.
5. Submit / Cancel.

**The three real paths on a phone:**

- Query decomposed cleanly (`"пион розовый 60"`) → opens emerald, 4-tuple hidden, type price, Добавить. **Same two taps as today**, and now the card is `Пион / Розовый / 60`, not `Type = "пион розовый 60"`.
- Query is a bare Type (`"пион"`) → opens with Type filled, amber, chips visible. One chip tap → emerald. **Three taps**, and she got to see what she has.
- Query is genuinely new (`"ранункулюс персиковый"`, no such Type) → opens gray with the refine block expanded and submit disabled until she gives a Type. She types Type (datalist suggests as she goes), presses Добавить, gets the amber confirm. **This is deliberately the slowest path** — it is the one that mints a Variety.

**Two host-side fixes these rows need anyway (small, in the same commit):**

- **`OrderCard` cannot merge the created card.** `stockItems` is a prop (`:93`), owned by `OrderListPage` (`:218/:384`), so today it discards `stockItem` and fires `onStockRefresh?.()` unawaited into a silent catch (`OrderListPage.jsx:387-390`). Until that lands, the line's live-price lookup at `OrderCard.jsx:584` misses and the row shows `—`. Fix: a local `const [extraStock, setExtraStock] = useState([])` in OrderCard; `onCreated` pushes `stockItem` into it; every editor-scope read uses `stockItems.concat(extraStock)`. Six-line change, no lifting required.
- **Gate trim.** `flowerSearch.length >= 2` (`OrderCard.jsx:703`, `OrderDetailPage.jsx:490`, and the same line in the other three) measures the untrimmed string while the handler trims — two spaces opens a form with an empty name. Change all five to `flowerSearch.trim().length >= 2`. (The component is safe regardless: submit is disabled with no Type, so the `createBouquetDemand: displayName is required` throw becomes unreachable.)
- **`OrderDetailPage` must close its picker** on the affordance click (`setAddingFlower(false)` is missing at `:493-502`, so today the form renders under a still-open picker) and must reset the form state on cancel/save (`:616`, `:594-597`, `:388-404` all omit it).

---

## 6. Build order

Each task is independently committable and has a test that fails before it and passes after. **Pitfall flags:** `[VID]` = pitfall `variety-identity-door`, `[BVA]` = pitfall `batch-variety-attrs`.

---

**T1 — `packages/shared/utils/varietyIdentity.js` + test.** `[VID]`
Pure functions only: `isDatedBatchName`, `normaliseIdentityValue`, `normaliseSize`, `identityKey`, `stockItemIdentity`, `sameVariety`, `pickCanonical`, `resolveVariety`.
**Test** `packages/shared/test/varietyIdentity.test.js`, exporting a `PARITY_CASES` array. Must cover: `peony` ≡ `Peony` ≡ ` Peony `; blank Colour matches blank Colour only, never `Green`; `size: 0` ≠ `size: null`; `'60'` ≡ `60`; a dated Batch is never returned as `match`; two undated rows → oldest `Created At` wins; no Type → display-name fallback; `datedBatches` present + `match: null` → `reason: 'dated-only'`.
*Green when:* `cd packages/shared && ../../backend/node_modules/.bin/vitest run varietyIdentity`.

**T2 — backend↔client parity lock.** `[VID]`
`backend/src/__tests__/varietyIdentity.parity.test.js` imports `PARITY_CASES` from `../../../packages/shared/test/varietyIdentity.test.js` (plain relative path; vitest resolves it fine in the workspace) and asserts `backend/src/utils/varietyIdentity.js`'s `sameVariety`/`normaliseIdentityValue`/`normaliseSize` give the identical answer for every case.
*This is the anti-drift device.* Without it the mirror rots in a month.
*Green when:* `cd backend && npx vitest run varietyIdentity`.

**T3 — `seedVarietyFromQuery`.** `[VID]`
Added to the same file, tested in the same test file.
**Test — this is the client-side #562 regression lock.** `seedVarietyFromQuery('Pink Peonies', stockWithPeonyPink)` MUST return `typeName: ''` (it must not invent `Type = "Pink Peonies"`). `seedVarietyFromQuery('пион розовый 60', stock)` returns the full tuple. An exact display-name hit seeds tuple + prices + supplier from that card. A dated-batch query (`'Пион Розовый (24.Jul.)'`) seeds the name but no tuple.

**T4 — `createBouquetDemand` gains `resolvedStockItem` + `newVariety`.** `[VID]`
**Test**, appended to `packages/shared/test/createBouquetDemand.test.js`: (a) `resolvedStockItem` short-circuits — `apiClient.patch` called with that id, `findAllMatchingVariety` result irrelevant; (b) `newVariety: true` appears in the POST body; (c) **back-compat**: a call with neither param produces the byte-identical POST body it produces today (assert the whole object, not `toMatchObject`) and **never** contains a `newVariety` key.
*Green when:* `cd packages/shared && ../../backend/node_modules/.bin/vitest run createBouquetDemand`.

**T5 — translations.** No code change beyond the two `translations.js` files.
**Test** `packages/shared/test/bouquetFlowerFormKeys.test.js`: `BouquetFlowerForm.jsx` exports `export const BOUQUET_FLOWER_FORM_KEYS = [...]`; the test `fs.readFileSync`s both apps' `translations.js` and asserts each key appears at least twice (once in the `en` block at `apps/florist/src/translations.js:6-963`, once in `ru` at `:965-1919`). Text-level, but it is the only thing that catches this class — `t.flowerName` and `newVarietyConfirm` are both shipping English into a Russian UI today precisely because nothing checks.

**T6 — `packages/shared/components/BouquetFlowerForm.jsx` + component test.** `[VID]`
**Test** `packages/shared/test/BouquetFlowerForm.test.jsx` (`@testing-library/react` + jsdom, mocked `apiClient`):
- no Type → `bff-submit` disabled, badge reads `varietyNone`;
- tuple matching a loaded card → badge `varietyLinked`, submit fires **without** any prompt, `createBouquetDemand` receives `resolvedStockItem` and **no** `newVariety`;
- `dated-only` → badge `varietyLinked`, **no prompt** (explicit `expect(queryByTestId('bff-new-variety-prompt')).toBeNull()`);
- new tuple → submit renders `bff-new-variety-prompt`, no network call yet;
- confirm → POST body carries `newVariety: true` **and** `displayName === varietyDisplayName(tuple)`, not `seedQuery`;
- cancel → no network call, typed values still in the inputs;
- API rejection → `showToast` called with `err.response.data.error`, `onCreated` NOT called, form still mounted;
- suggestion chip click → all four `nv-*` inputs populated.

**T7 — host swap #1: dashboard `OrderDetailPanel.jsx`.**
Replace `:847-924`. `dense={false}`, `fields={{supplier:true, lotSize:true}}`, `targetMarkup`, `idPrefix="bff-dash-odp"`. `onCreated` keeps the existing upsert (`:901-904`) — the server can 200 a card already in the list, so `findIndex`-then-map-or-append must survive. **Delete the silent catch at `:906-913`** (it appends an unlinked `stockItemId: null` line with no toast — pitfall #5, and the florist wizard's own comment at `steps/Step2Bouquet.jsx:831-832` says why that's wrong).
**Test** — new `tests/e2e/bouquet-flower-form.spec.js`, `test.use({ baseURL: 'http://localhost:5175' })`: seed a Peony Variety via `tests/e2e/helpers/seed.js`, log in `1111`, open an order, Изменить букет → + Добавить цветок → type an existing Type → assert emerald `bff-variety-badge` → submit → line carries the **existing card's** name. Then a new tuple → assert `bff-new-variety-prompt` → Отмена → assert via `harnessApi` that the stock row count is unchanged → Создать новый → assert exactly one new row, carrying all four attrs.
Model: `tests/e2e/stock-order-line-form.spec.js`. Constraints from CLAUDE.md apply: never `page.goto()` after login; navigate by clicking.

**T8 — host swap #2/#3: florist `OrderCard.jsx` + `OrderDetailPage.jsx`.**
`dense={true}`, no supplier/lot. Plus the three host fixes from §5 (extraStock merge, trim the gate, close the picker + reset state). Keep `onPointerDown` on the affordance rows (`OrderCard.jsx:705-707`) — it is required inside the tap-to-expand region; add a comment so it isn't "cleaned up".
**Test** — extend the same spec with `baseURL: 'http://localhost:5173'`: assert the 4-tuple block is **collapsed** when the seed resolves (`bff-refine-toggle` present, `nv-type` not visible), and **expanded** when it doesn't; assert the created card's `Type` is the decomposed value, never the raw query.

**T9 — host swap #4/#5: both `steps/Step2Bouquet.jsx`.**
Replace florist `:692-850` and dashboard `:482-606`. `nameEditable={true}`, supplier+lot on. Retire the florist `__other__` supplier `<select>` (`:709-725`) in favour of the component's datalist input — parity with the dashboard, which already uses a plain input — and move the settings write-back (`:796-798`) into `onCreated` keyed off `form.supplier`. Delete the dashboard's now-redundant `flowerAlreadyExists` banner (`:503-529`); the emerald badge says the same thing and the normal submit already does what its shortcut did. Both hosts keep `addOne` for the cart line (the wizard line shape carries `stockDeferred` and no `_originalQty`).
**Test** — extend the spec: on the wizard, type a brand-new name, assert submit is disabled until a Type is entered (today `if (!customFlower.name.trim()) return;` at florist `:769` is the *only* guard and Type is silently defaulted to the name).

**T10 — cleanup + docs.**
Re-point `packages/shared/index.js:95` off the hook; export `BouquetFlowerForm`, `resolveVariety`, `seedVarietyFromQuery`, `identityKey`, `sameVariety` (client) from the barrel — **note `findVarietyMatch` is already taken** by `poLineVariety`, hence `resolveVariety`. Update `packages/shared/CLAUDE.md`'s structure block (components + utils), root `CLAUDE.md` pitfall `variety-identity-door` with the client-side half and the new component's name, `CHANGELOG.md`, `BACKLOG.md`, and `docs/superpowers/reports/2026-07-30-variety-entry-surface-inventory.md` (rows 4-8 now resolved).
*Pre-PR matrix for this diff:* `cd packages/shared && ../../backend/node_modules/.bin/vitest run` · `cd backend && npx vitest run` · vite build **all three** apps · `npm run test:ui` · `npm run lab:test:unit` + `npm run lab:test:api`.

**T11 (optional, spin off) — florist picker double-add.** `apps/florist/src/components/steps/Step2Bouquet.jsx:1008` calls `addOne(...)` *and* `:1011` returns `newItem`, which `VarietyAllocationPicker.jsx:205-206` feeds back through `onSelectStock` → the line is added twice at qty 2. The dashboard twin avoids it only by returning `null` (`:823`). Not this component's path; separate one-line fix.

---

## 7. Risks

### Per host

**Row 4 — florist `OrderCard.jsx`**
- *Height on a phone.* The chip row + disclosure must not push the price inputs below the fold inside an already-nested expanded card. Mitigation: dense mode caps the chip row at two lines and the 4-tuple stays collapsed on the common path. Verify on a 375px viewport in the Playwright run (`resize_window`/`viewport`).
- *Stale `stockItems`.* Without the `extraStock` merge (T8), the new line renders `—` at `OrderCard.jsx:603` until an unawaited, silently-caught refetch lands.
- *Pointer semantics.* `element.click()` does nothing on the affordance (`onPointerDown`). Playwright is fine; ad-hoc DOM scripting is not.

**Row 5 — florist `OrderDetailPage.jsx`**
- *Local `parseBatchName` shadow* at `:16-19` handles only the short-tag `(14.Mar.)` form; the shared util also normalises Y-model ISO `(2026-05-13)`. The component uses the shared one, so an ISO-named batch is now correctly excluded from identity matching while the page's own picker still shows it as part of the name. Not introduced here, but it will look inconsistent. Optional cleanup: delete the local copy, import the shared one — a visible change (date chips start appearing on ISO names), so it needs its own commit.
- *`pendingPO` fetched once per mount* (`:399-403`), so on a second Edit-bouquet session the affordance gate can offer "Add new" for a flower already on an inbound PO. Pre-existing.

**Row 6 — dashboard `OrderDetailPanel.jsx`**
- **Behaviour change, owner-visible:** a failed create no longer silently adds an unlinked line. Today the bouquet still totals correctly and she is told nothing; after this she gets a Russian error toast and the form stays open. This is the correct behaviour (every flower must have a stock record) but it must be in the PR body and the `owner-summary`.
- *Upsert must survive.* Replacing `:901-904` with a blind append would duplicate rows in the picker every time the server resolves onto a loaded card.

**Rows 7/8 — both `steps/Step2Bouquet.jsx`**
- *Supplier UX change* (florist loses `__other__`). If the write-back is not moved into `onCreated`, new suppliers silently stop being remembered — and the current write is a fire-and-forget `.catch(() => {})`, so nobody would notice.
- *`addOne` price source.* Both hosts today build a 4-key synthetic object and re-derive price through `resolveStockLinePrice` on an object with no `Current Quantity` (`physQty = 0`). Keep that; changing it would move prices on the pending-PO path (#377).
- *Premade composer.* Dashboard `PremadeBouquetCreateModal.jsx:118` and florist `PremadeBouquetCreatePage.jsx:164` mount the same component with `onlyPhysicallyAvailable`. That flag never gated the create affordance and still won't — a brand-new qty-0 flower can be put in a physically-assembled bouquet. Pre-existing; flag it to the owner as a separate decision.
- *The picker's owner-only `+ Создать сорт`* (`VarietyAllocationPicker.jsx:293`) remains a **second** create door on the same screen with a different permission model (owner-only) and a different field set (4-tuple, no prices). This design does not unify it. State that explicitly so the next session doesn't assume it did.

### Cross-cutting

- **Role.** `POST /stock` is `authorize('stock')` with no roles array (`backend/src/routes/stock.js:15`) and `florist: ['orders','customers','stock',...]` (`backend/src/middleware/auth.js:13`) — **a florist can mint a Variety** from rows 4/5/7. Unchanged by this design (the component is not owner-gated), but the confirm now makes it a deliberate act rather than a side effect of typing. If the owner wants creation owner-only, that is a backend change (`authorize('stock', ['owner'])` on the create branch) and a separate decision.
- **`newVariety: true` is a guard bypass.** Once confirmed, the server does not resolve (`stock.js:426`). If `seedVarietyFromQuery`/`resolveVariety` under-match relative to the server, the confirm fires wrongly and the owner clicks through — minting the duplicate the whole feature exists to prevent. **T2 (the parity test) is what keeps that from happening**; treat it as load-bearing, not optional.
- **Pitfall `batch-variety-attrs` `[BVA]`:** nothing in this design writes a Batch — every path posts `quantity: 0` to the undated Demand Entry, and `createBouquetDemand.js:91-119` explicitly never patches a Batch's price. Receive-side attr propagation (`backend/src/services/stockOrderService.js` `receiveIntoStock`, `backend/src/routes/stockPurchases.js`) is untouched. But **the component makes it far more likely that new cards carry a real Type**, which is upstream of that pitfall — a good thing, and a reason to run `stockOrders.receiveIntoStock.integration.test.js` as part of the matrix even though no backend file changes.
- **Bundle.** Re-pointing the `findAllMatchingVariety` export (T10) removes `useOrderEditing` from the dependency graph of every app. Behaviour-identical, but it is exactly the kind of change that broke Vercel in May 2026 — **build all three apps locally**, per the pre-PR matrix.

### Existing tests already covering these paths

| file | what it pins |
|---|---|
| `packages/shared/test/createBouquetDemand.test.js` | the reuse/create/inherit branches — T4 must not break them |
| `packages/shared/test/varietyLookup.test.js` | `findAllMatchingVariety` base-name semantics |
| `packages/shared/test/poLineVariety.test.js` | PO 4-tuple match, `New Variety` diff flag (`:303`) |
| `packages/shared/test/PoLineForm.test.jsx` (`:84-167`, `:228-246`) | the confirm/cancel/re-link idiom being mirrored |
| `packages/shared/test/NewVarietyFields.test.jsx` | the 4-tuple block, unchanged |
| `packages/shared/test/useOrderEditing.test.js` | the dead hook — will still pass; do not delete in this PR |
| `backend/src/__tests__/varietyIdentity.test.js` | the server semantics T2 mirrors |
| `backend/src/__tests__/stock.createMatchesExisting.integration.test.js` | the 200-vs-201 door; T4's `newVariety` flag flows through it |
| `backend/src/__tests__/stock.postVarietyAttrs.test.js` | `POST /stock` attr handling |
| `backend/src/__tests__/stockOrders.receiveIntoStock.integration.test.js` | `[BVA]` — run it, don't change it |
| `backend/src/__tests__/stockOrders.lineIdentityLock.integration.test.js` | `[po-line-identity]` — unaffected, run it |
| `tests/e2e/stock-order-line-form.spec.js` | the browser model for T7's new spec |
| `tests/e2e/florist-order-creation.spec.js` | drives the wizard but **not** the custom-flower form (grep confirms) — T9 needs its own coverage |

**Nothing today covers rows 4-8's create path in a browser.** That gap is why five forms diverged this far; `tests/e2e/bouquet-flower-form.spec.js` (T7-T9) is the layer that closes it.