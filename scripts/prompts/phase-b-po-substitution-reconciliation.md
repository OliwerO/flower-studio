# Phase B — PO Substitution Reconciliation (kickoff prompt)

**Invoke this prompt in plan mode (`ultraplan`) when ready to build Phase B.**

---

## Context

Phase A of the PO substitution feature is live. When a driver brings a substitute instead of the originally-ordered flower, the substitute is now received as its **own stock card** (find-by-exact-name or create-new), with the **real per-stem cost** paid (not the original planned cost) and sell price computed from `settings.targetMarkup`.

Relevant code landmarks:
- `backend/src/routes/stockOrders.js` — `findOrCreateSubstituteStock()` helper and the alt branch of the `POST /:id/evaluate` handler
- `apps/florist/src/pages/StockEvaluationPage.jsx` — preview banner for new substitute cards + confirm-on-submit dialog
- `BACKLOG.md` — section "PO Substitution — Phase B" has a short summary

## The problem Phase B solves

Most Flower Studio POs are **negative-stock-driven** — a customer order consumes stock, stock goes negative, a PO is generated to cover the deficit. When the driver substitutes:

1. Substitute lands in its own stock card (Phase A ✓)
2. Original stock card stays negative (because nothing replenished it)
3. The existing customer order is still linked in its bouquet to the **original** flower, not the substitute
4. Two lies remain: order paperwork still says the wrong flower, and the negative stock keeps generating phantom PO demand signals

Today the florist has to manually swap each affected order's bouquet line from original → substitute in the bouquet builder. This works at low volumes but becomes error-prone fast.

## What Phase B should build

A **reconciliation screen** that surfaces the mismatch proactively and lets the owner/florist swap orders to the substitute with minimal friction.

### Proposed flow

1. **Trigger**: When `findOrCreateSubstituteStock` is called (or right after receive completes) in the evaluate handler, the backend checks whether any open orders currently have bouquet lines referencing the *original* stock item with a negative `Current Quantity`. If yes, broadcast a new SSE event (e.g. `substitute_reconciliation_needed`) with the original stock ID, substitute stock ID, and received qty.

2. **Notification**: Both florist app and dashboard show a banner/card: *"⚠️ 3 orders waiting for Rose Silva Pink. We just received Rose Misty bubbles (10 stems) as a substitute. Tap to reassign."*

3. **Reconciliation screen**: Lists affected orders (FIFO by creation date by default, user can reorder or pick explicitly). For each: shows customer name, delivery date, needed qty of original. Below each: a proposed substitute qty input pre-filled with `min(needed, remaining substitute stock)`. One-tap "Swap" per order.

4. **Swap endpoint**: `POST /api/orders/:id/swap-bouquet-line` with `{ fromStockItem, toStockItem, qty }`. Backend:
   - Reduces the original stock item consumption on that bouquet line (stock goes from e.g. -12 toward 0)
   - Adds consumption to the substitute (goes from 10 toward 0)
   - Updates the bouquet line's stock-item link and display name
   - Broadcasts an order-updated SSE event

5. **Demand suppression**: While a pending substitute is "unresolved" (i.e. substitute stock still has qty left and original is still negative), the PO demand calculation should **skip the original** to avoid suggesting a duplicate re-order. Simplest version: the demand calc checks for any active substitute cards recently created for this original (via STOCK_PURCHASES notes or a new `Substitute For` link field if we decide to add one).

### Open design decisions for Phase B plan mode

1. **Data model:** do we add a `Substitute For` link field on Stock (pointing back to the original) to make the reconciliation query O(1), or do we stick with name-based lookups / STOCK_PURCHASES scanning?
2. **Partial coverage:** substitute covers some but not all waiting orders (10 substitute stems, 17 needed across orders). Default to FIFO allocation? Let owner override?
3. **Multiple substitutes over time:** if two different substitutes for the same original get received in sequence (Rose Misty bubbles on Monday, Rose Riverside on Wednesday), does the reconciliation screen stack them or handle one at a time?
4. **Pickup vs delivery orders:** both affected the same way, or does delivery date urgency matter for FIFO?
5. **Cancellation/re-evaluation:** what if the florist swaps, then the original flower arrives later on a new PO? Do we keep the swap, or offer to revert? (My instinct: keep the swap, it's a completed transaction.)
6. **Wix storefront:** does a pending-reconciliation substitute make the Wix product appear "available with alternative" somehow, or do we leave Wix sync as a separate session (see `WIX-STOCK-PROJECTION` tag in BACKLOG.md)?

### What NOT to build in Phase B

- Don't design the Wix side-effect here — that's its own session (`WIX-STOCK-PROJECTION`)
- Don't split planned vs actual cost — was disrecommended earlier
- Don't add an `Alt Resolution` mode picker — Dasha chose the single simplified policy (always keep separate)
- Don't try to automate swaps without confirmation (Path C). She specifically wants visibility over every reassignment.

## Context to preserve from prior conversation

- Owner (Dasha) is non-technical — explanations must be plain-language, not jargon
- She prefers direct, IE-style framing (value streams, standard vs actual cost, routing sheets) when concepts come up
- She tests in PROD not dev; changes are not "done" until `git push` has deployed them
- She communicates in English/Polish/Russian; any user-facing copy must be translated to EN + RU at minimum
- Project CLAUDE.md rule: write a short "what/why/how-it-connects/watch-for" summary after each logical chunk of work

## How to start

Open this with ultrathink + plan mode:

```
ultrathink and plan: implement Phase B of the PO substitution feature — the reconciliation screen that handles negative-stock-driven PO workflows. Start by reading scripts/prompts/phase-b-po-substitution-reconciliation.md for full context, then grep for findOrCreateSubstituteStock and the POST /:id/evaluate handler in backend/src/routes/stockOrders.js to remind yourself of what Phase A looks like. Produce a step-by-step plan with concrete file paths and line numbers. Do not write code until I approve the plan.
```
