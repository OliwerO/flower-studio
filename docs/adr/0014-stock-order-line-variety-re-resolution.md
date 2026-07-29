# Editing a Variety attribute on a Stock Order line re-resolves the Stock Item link

A Stock Order line shows the full Variety four-tuple (Type, Colour, Size, Cultivar) at all times, pre-filled from the picked Stock Item rather than hidden behind a "new Variety" gate. Whenever the Owner edits one of those four attributes, the line re-matches the whole tuple against existing stock: a match silently re-links the line to that Stock Item, and no match detaches the line (clears `stockItemId`) and marks it as a new Variety. A line therefore never carries a Stock Item link whose Variety differs from the attributes displayed on it.

## Why

`stockOrderService.js`'s evaluation path reads `if (!stockItemId && ...)` before resolving Variety attrs. A line that keeps its Stock Item link has its attrs **ignored** at evaluation and receives stems into the linked card. So an editable-but-still-linked Variety block would let the Owner change Colour from Pink to White and have the White stems land in the Pink card — the exact failure of #558, which required a manual prod data repair.

Re-resolution also matches how the Owner actually works. Changing 60cm to 70cm on a Peony she stocks in both sizes is not a new Variety; it is picking a different existing one. Treating every attribute edit as a Variety creation would fragment stock the way #319 did, and ADR-0006 explicitly relies on autocomplete prefill to make "the dataset converge to consistent attributes per cultivar even without DB enforcement" — which only works if picking an existing flower shows and reuses its attributes.

## Considered alternatives

- **Keep the Variety block gated on `!stockItemId`** (the behaviour before this decision). Safe against mis-receipt, but the Owner cannot see or correct the identity of a flower she picked, which is the complaint that prompted the work. It also contradicts ADR-0006's prefill intent.
- **Auto-detach on any attribute edit.** Simple and safe against mis-receipt, but a typo in Cultivar silently creates a second Variety. Stock fragmentation is harder to notice and harder to repair than a wrong link, and the Owner has already been bitten by it (#319, pitfall `batch-variety-attrs`).
- **Attributes read-only until an explicit "change Variety" unlock.** Safest, and makes intent unambiguous. Rejected because it puts a tap in front of changing Size, which the Owner named as a routine action when picking a flower.

## Consequences

- The invariant "`stockItemId` is set ⟹ the four attrs equal the linked card's" must hold in the form at all times. It is the guard against #558 and is asserted directly in `PoLineForm`'s tests.
- Matching uses ADR-0006 strict identity, including null-aware equality — an empty Colour and Colour="Green" are different Varieties and must not coalesce.
- Matching runs client-side against the stock list the Stock Order screens already load. No new endpoint, and no round-trip per keystroke.
- A new Variety is still only *created* at evaluation, by the existing four-tuple resolve-or-create in `stockOrderService.js`. Detaching a line records intent; it does not write a Stock Item.
- `buildPoSuggestions` must stop blanking the four attrs when an orig card exists, or pre-filled shortfall lines would show an empty Variety block and detach on first edit.
- A deliberate edge: typing an attribute combination the Owner believes is new, which happens to match a Variety she had forgotten, re-links her to it rather than warning. This is intended — it prevents duplicates — and is surfaced by the badge staying green and the line's name changing.
