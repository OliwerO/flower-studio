# A Stock Order line's identity may move, but only onto a Variety that already exists

Editing a Stock Order line's flower re-resolves the line onto the **existing** Variety that matches the four attributes shown on it. A match re-links silently and adopts that card's name and prices. **No match is refused** — the edit is not applied until the Owner explicitly confirms "create this as a new variety", which is the only path that detaches the line and lets evaluation mint a Variety.

Supersedes ADR-0014 (which detached silently on no-match) and the hard identity lock shipped in #593 (which refused every change and required remove-and-re-add).

## Why

Three failure modes had to be closed at once, and each candidate design only closed two.

**#558 — stems land in the wrong card.** `stockOrderService.js` skips Variety resolution when a line is linked (`if (!stockItemId && …)`), so a linked line whose attrs were edited receives into the *old* card. A line named "Hydrangea White" bound to the Hydrangea Blue card put 10 White stems into Blue and needed a manual production repair.

**#562 — a typo mints a duplicate Variety.** Silent detach (ADR-0014) means mistyping a Cultivar creates a second Variety at evaluation. Stock fragmentation is harder to notice and harder to repair than a wrong link, and the Owner has already been bitten by it (`Pink Peonies/Pink` alongside `Peony/Pink`; #319, pitfall `batch-variety-attrs`).

**Friction.** The Owner stocks Peony in 60cm and 70cm. Swapping size is *picking a different existing flower*, not creating one. The hard lock (#593) forced a delete-and-retype for that, losing the line's quantity, cost and supplier — the Owner rejected that cost once she saw it.

The rule here is the Owner's own framing (2026-07-30): *"show what they have had previously, select from those; if there is legitimately nothing like the one they want, they really create a new variant."* Choosing is the default path; creating is a deliberate, confirmed act.

## Considered alternatives

- **Hard lock on any identity change** (#593, superseded). Absolutely safe against #558, but a routine size swap costs a delete-and-retype. Rejected on Owner feedback.
- **Silent detach on no-match** (ADR-0014, superseded). Good ergonomics, closes #558, but converts every typo into a new Variety — trading a visible bug for an invisible one.
- **Client-side guard only.** The form already re-resolves, so the server could stay permissive. Rejected: Ask Blossom, the delivery app and any future caller would bypass it, and #558 shipped precisely because a client-sent field was silently dropped server-side.

## Consequences

- `PATCH /stock-orders/:id/lines/:lineId` enforces the rule for a line that is **already linked**. An identity change resolves as follows:
  - an explicit `Stock Item` in the body → that card is authoritative and its four attrs are **adopted onto the line**, so a caller sending only a link is never silently reverted to the line's stale attrs;
  - otherwise the merged four-tuple is matched (ADR-0006 strict, null-aware, preferring the undated canonical card);
  - no match → **409 `VARIETY_NOT_FOUND`**.
- `New Variety: true` is the deliberate escape hatch. It is a **control flag, not a column** — accepted by the route, never persisted.
- An **unlinked** line is untouched by the rule: it is still being composed and its Variety is resolved (or created) at evaluation. The composing flow, and pitfall #6's "a line must have a Stock Item link or a Flower Name", are unchanged.
- Name, link and the four attrs are written together on every accepted change, so the #558 invariant (`stockItemId set ⟹ attrs equal the linked card's`) holds at the API boundary, not just in the form.
- `PoLineForm` renders an inline confirm ("No such flower yet. Create it as a new variety?") instead of applying a no-match edit; cancelling restores the previous flower. Only the confirmed path sets `isNewVariety`, which `canonicalDiffToApiFields` turns into `New Variety: true`.
- Regression-locked by `backend/src/__tests__/stockOrders.lineIdentityLock.integration.test.js`, `stockOrders.lineStockItemPatch.integration.test.js` and `packages/shared/test/PoLineForm.test.jsx`.
- **Open follow-up:** this rule is enforced on Stock Order lines only. The Owner has asked for the same pick-from-existing discipline everywhere a Variety can be typed (bouquet builders, receive forms, evaluation substitutes) — a separate pass, tracked in #562.
