# Stock Order — form unification, termination model, and notes

**Date:** 2026-07-29
**Status:** design locked (grill complete), ready for `/feature` slicing
**Origin:** owner testing session after PR #568; four divergent line-entry forms, no way to cancel a sent Stock Order, notes lost between Owner and Driver

Terminology follows `CONTEXT.md` (updated in this session: **Lot**, **Packages**, **Stock Order Termination**, **Driver Note**, **Market Note**). Code identifiers keep the legacy `PO_*` / `PurchaseOrderPage` naming — renaming them is out of scope.

---

## Problem

Four line-entry forms exist, each built at a different time, each with a different field set:

| Surface | Component | Picker | Variety attrs | Packages | Sell | Farmer/Notes |
|---|---|---|---|---|---|---|
| New Stock Order, pre-save | inline in `PurchaseOrderPage` / `StockOrderPanel` | yes | hidden once linked | yes | yes | yes |
| Saved Draft, per line | `DraftLineEditor` | yes | hidden once linked | no | yes | yes |
| Sent/Shopping, add line | `AddLineInlineForm` | yes | hidden once linked | no | yes | no |
| Shopping supervision | `AddExtraLineForm` | **no** | **no** | no | no | no |

Two root causes:

1. **The Variety block is gated on `!stockItemId`.** `apps/florist/src/pages/PurchaseOrderPage.jsx:524` and siblings. It is labelled "Новый сорт" and renders only for a brand-new Variety. Picking an existing flower sets `stockItemId` and the block disappears — so a Stock Order line never shows the four-tuple identity that ADR-0006 made canonical. `packages/shared/utils/buildPoSuggestions.js` compounds this by deliberately blanking the attrs whenever an orig card exists.
2. **Packages is UI-only.** No column on `stock_order_lines`; it collapses to `quantity_needed = packages × lot_size` at POST. Once a line is persisted there is nothing to render it back from, so it vanishes from every editor.

Separately: a Stock Order cannot be cancelled once sent (`DELETE /:id` is Draft-only, `backend/src/routes/stockOrders.js:404`), and there is no `Cancelled` status.

---

## Decisions (grill, 2026-07-29)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Packages is derived, never stored.** `packages = stems / lotSize`; editing packages sets `stems = packages × lotSize`. | `DraftLineEditor:918` already reconstructs lots this way — the information was never lost, only undisplayed. Storing it creates a second number that can disagree with `quantity_needed`, which every downstream reader (evaluation, FEFO, settlement) trusts. |
| D2 | **Before Shopping → Deletion. From Shopping → Cancellation.** Applies identically to a line and to a whole Stock Order. | `stockOrders.js:322` auto-flips Sent → Shopping on the Driver's first line PATCH, so the boundary lands exactly on the Driver's first keystroke rather than on a guess. |
| D3 | **Editing a Variety attribute re-resolves against existing stock.** Match → silently re-link to that card. No match → detach (clear `stockItemId`), keep attrs, badge flips to "новый сорт". | `stockOrderService.js:349` reads `if (!stockItemId && ...)` — a linked line's attrs are *ignored* at evaluation. Leaving the link attached while attrs change receives White stems into the Pink card (#558). Re-resolution also makes "same flower, different size" a re-link rather than a Variety creation, which is the common case. |
| D4 | **Cancelling mid-shopping means "stop shopping, come back with what you have."** Still-Pending lines are cancelled; if any line has `Quantity Found > 0` the order routes to **Reviewing**, not Cancelled. | Those stems are physically in the van and paid for. Cancelling them would erase the record, not the purchase. |
| D5 | **A line with stems already found cannot be cancelled.** | Same reason. Receive it, then write off what is unwanted. |
| D6 | **One Driver Note on the Stock Order,** editable at any status, prominent in the Driver app. No Owner-private note. | The field already exists (`stock_orders.notes`) and already renders to Drivers, truncated, at `StockPickupPage.jsx:182`. Nothing becomes newly visible. |
| D7 | **Owner's line note and Driver's Market Note are separate columns.** | They share `notes` today: `PurchaseOrderPage.jsx:1068` (Owner) and `StockPickupPage.jsx:331` (Driver) write the same field, so the Driver silently destroys the Owner's purchasing instruction. |
| D8 | **Form-then-save everywhere.** The blank-line shortcut on saved Drafts is retired. | Removes the blank-row state, the amber "заполните название" warning, and the Draft/Sent behavioural split that started this. Bulk entry is unaffected — the new-order screen arrives pre-filled from shortfalls. |
| D9 | **Cancelled is reversible to Draft;** hidden from the Owner's default list, absent from the Driver's app entirely. | A cancelled Stock Order never touched stock, so reopening needs no unwinding. Covers "driver sick Thursday, same eight lines Friday". |

### Explicitly rejected

- **Storing `packages`** (D1) — redundant with `quantity_needed`, no reader can say which is true when they disagree.
- **Auto-detach on any keystroke** (D3) — a typo in Cultivar silently creates a second Variety; this is the #319 / pitfall-9 fragmentation family.
- **Attrs read-only behind an "unlock" button** (D3) — adds a tap to changing Size, which the Owner named as a routine action.
- **Blocking mid-shopping cancellation when stems are found** (D4) — rigid; the Owner's real move is to phone the Driver and stop the run.
- **A second Owner-private note on the Stock Order** (D6) — not asked for; creates a "which box?" decision on every note.

---

## Slices

S1/S2 and S3/S4 are independent and can run in parallel. S2 depends on S1. Only S4 carries a migration.

### S1 — shared `PoLineForm`

New: `packages/shared/components/PoLineForm.jsx` + `packages/shared/test/PoLineForm.test.jsx`.

Field order, single column, matching the approved prototype:

1. Flower search (`StockSearchInput`, lifted to shared)
2. **Variety block — always visible.** Type / Colour / Size / Cultivar, with datalists sourced from loaded stock. Badge: green "из карточки склада" when linked, amber "новый сорт" when detached, neutral when empty.
3. Quantity row: `Нужно` (stems) / `В пачке` (lot size) / `Пачки` (derived) + live `= N шт`
4. Prices: cost/stem, sell/stem, ×markup badge
5. Supplier / Farmer
6. Owner line note
7. Line total

Behaviour:

- **Packages derivation (D1).** `packages = lotSize > 1 ? stems / lotSize : null`, displayed to one decimal. Editing `Пачки` sets `stems = packages × lotSize`. Editing `Нужно` leaves stems exactly as typed and lets `Пачки` show a fraction — never silently round the Owner's stem count.
- **Re-resolution (D3).** On change to any of the four attrs, match the full four-tuple against the already-loaded stock list using ADR-0006 strict identity (null-aware; empty Colour ≠ "Green"). On match: set `stockItemId`, adopt that card's Display Name, cost, sell, lot size, supplier. On no match: clear `stockItemId`, keep the attrs.
- **Invariant (must be asserted in tests):** `stockItemId` is never set while any of the four attrs differs from the linked card's. This is the #558 guard — evaluation ignores attrs on a linked line.
- **Host modes.** A `mode` prop toggles only optional field *visibility* (`shopping` hides Farmer + Owner note), never layout, never field semantics, never the quantity math.

### S2 — swap the call sites

Replace all seven surfaces with `PoLineForm`:

- florist: new-order form rows, `DraftLineEditor`, `AddLineInlineForm`, `AddExtraLineForm` (`ShoppingSupportPage` — gains a picker and the Variety block for the first time)
- dashboard: new-order form rows, `DraftLineEditor`, `AddLineInlineForm`

Also: `buildPoSuggestions` stops blanking the four attrs when an orig card exists — carry them through so pre-filled shortfall lines show their Variety. Update `packages/shared/test/buildPoSuggestions.test.js`.

Retire the blank-line path (D8): drop `addBlankDraftLine`, its call site, and the amber blank-line state in `DraftLineEditor`. Leave the `/send` blank-line guard in place as a backstop.

### S3 — Stock Order Termination

- `PO_STATUS.CANCELLED` in `backend/src/constants/statuses.js` (keep the file dependency-free — it is bundled into frontend builds).
- Transitions: `SHOPPING → CANCELLED`; `CANCELLED → DRAFT` (reopen). Draft and Sent are *not* cancellable — they delete.
- `DELETE /:id` widens from `[DRAFT]` to `[DRAFT, SENT]`. Deleting a Sent order fires a Telegram cancellation notice through `driverNotifyService` — capture the order data *before* deletion.
- `DELETE /:id/lines/:lineId` narrows from `EDITABLE_PO_STATUSES` to `[DRAFT, SENT]`.
- `POST /:id/cancel` (owner-only, Shopping only). Cancels every `Pending` line. If any line has `Quantity Found > 0`, transition to `REVIEWING` and return which lines were cancelled; else `CANCELLED`. Refuse to cancel an individual found line (D5) with a message naming the write-off path.
- Line cancellation state: `cancelled_at timestamptz` on `stock_order_lines` (shares S4's migration). Cancelled lines are excluded from totals and from `pending-po`.
- **Pending arrivals:** leave `pendingStatuses` at `backend/src/routes/stock.js:195` untouched — `CANCELLED` is absent by construction, which is exactly the desired behaviour. Add a test pinning it, because the comment above it already claims "non-Cancelled" and nothing enforced that.
- **Stale pending arrivals (live bug):** `apps/florist/src/components/PendingArrivalsSection.jsx:14` fetches once on mount with an empty dep array and ignores the `stock_order_line_updated` / `stock_order_deleted` SSE events the backend already broadcasts. Subscribe and refetch. This is why deleted lines kept showing as incoming until the screen remounted — the backend was always correct.
- Owner list: cancelled orders hidden by default, behind a filter. Driver app: excluded entirely.

### S4 — notes

Migration (the only one in this feature), on `stock_order_lines`:

- `driver_notes text` — the Driver's Market Note (D7)
- `cancelled_at timestamptz` — used by S3

Update `lab/factories/` in the same PR or CI `lab-api` fails on the unknown column.

- Wire `Driver Notes` through `stockOrderRepo` (`lineToWire` + the field mapper) and add it to the `PATCH /:id/lines/:lineId` allow-list at `stockOrders.js:277`.
- `StockPickupPage` expander writes `Driver Notes`; the Owner's note stays on `Notes` and becomes read-only to the Driver.
- Reviewing surfaces both, labelled.
- **Driver Note (order-level, D6):** editable textarea in both owner apps at any status — `PATCH /:id` already accepts `Notes` for owner, so no API change. In the Driver app, promote from the truncated inline span at `StockPickupPage.jsx:182` to a full-width card at the top of the run.

---

## Verification

Per the CLAUDE.md pre-PR matrix — every slice touches at least one of backend / shared / apps.

- `cd backend && npx vitest run --no-file-parallelism`
- `cd packages/shared && ../../backend/node_modules/.bin/vitest run`
- `npm run harness` + `npm run test:e2e`
- `npm run lab:test:unit` + `npm run lab:test:api` (mandatory on S4 — schema change)
- `vite build` for **all three** apps — shared's `index.js` re-exports reach every app, and Vercel builds each in isolation

Regression tests to add:

| Test | Pins |
|---|---|
| `PoLineForm` — editing an attr away from the linked card clears `stockItemId` | D3 / #558 |
| `PoLineForm` — editing an attr onto an existing Variety re-links to that card | D3 |
| `PoLineForm` — packages ⇄ stems round-trip, including a non-integer package count | D1 |
| `pending-po` excludes a Cancelled Stock Order | D2 |
| `pending-po` excludes cancelled lines of a live Stock Order | D2 |
| Cancelling a Shopping order with stems found → `REVIEWING`, Pending lines cancelled | D4 |
| Cancelling a Shopping order with nothing found → `CANCELLED` | D4 |
| Cancelling a found line is refused | D5 |
| `DELETE /:id` on a Sent order succeeds and notifies the Driver | D2 |
| `DELETE /:id` on a Shopping order is refused | D2 |
| Driver writing a Market Note leaves the Owner's line note intact | D7 |

## Open follow-ups (not in scope)

- `CONTEXT.md` says **Stock Order**, code says `PurchaseOrderPage` / `PO_STATUS` / `t.po.*`. Pre-existing drift; a rename is its own chore PR.
- `nextPoSequence` (`stockOrderRepo.js:127`) is `MAX(N)+1` over surviving rows, so deleting frees a number for reuse. Safe today because ADR-0003 markers carry the line UUID as well as the PO number, and only evaluated orders write markers — which are never deletable. Worth a comment at the call site so it is not re-raised.
