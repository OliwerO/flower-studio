# PRD #324 T5 — Per-Variety Trace Read-Surface

**Status:** Planning. Scope locked 2026-05-29 (user picked the MVP read-surface, not the full Consumption-ledger epic).
**Parent:** PRD #324 (Consumption ledger umbrella). This is slice T5 only.
**Precondition landed:** #327 (receiveIntoStock Variety-attr propagation) — the trace surface only works when Variety attrs are present.

## Scope boundary (what makes this one /feature window)

T5 is a **read-only** surface. It does NOT introduce the `order_line_consumptions` table (that is T1). Consumption events come from the **legacy** `order_line.stockItemId` link until T1 lands; everything else (writeoff, purchase, premade, absorption) comes from existing tables. No schema migration. No cart/picker changes.

Out of scope (other slices / follow-ups):
- `order_line_consumptions` table + multi-Batch order lines → T1–T4.
- Cart sub-rows, split dialler, dissolve-in-picker, +/- LIFO, merge-on-readd → T2–T4.
- Per-Consumption cancellation credit + Required-By cascade collision-merge → T6.
- Retroactive backfill of historical absorption events → explicit PRD out-of-scope.

## Domain vocabulary (CONTEXT.md / ADRs)
- **Variety** = 4-tuple (Type, Colour, Size, Cultivar), NULL-aware (ADR-0006, `varietyKey` util `|`-separated).
- **Batch** = dated Stock Item with qty > 0 (ADR-0007 addressable identity).
- **Demand Entry (DE)** = dated Stock Item with qty ≤ 0 (ADR-0005).
- **Absorption** = PO receipt folding stems into a pre-existing negative DE in one tx (ADR-0002 historical design; ADR-0007 live model).
- **Unaccounted stems** = `Σ purchase − Σ consumption − Σ writeoff − Σ absorption ≠ 0` → drift signal.

## Absorption events — DEFERRED (decision 2026-05-29)

PRD #324 specifies absorption detection via an audit-log self-join on `transaction_id`. **`audit_log` has no `transaction_id` column** (only `id`, `entity_type/id`, `diff` jsonb, `created_at`). T5's no-migration boundary forbids adding one. Per the user decision, absorption events are **deferred**: un-paired absorptions surface as **"Unaccounted stems"** drift in the footer (the PRD's own stated fallback). This **drops the original T5.1 extractor** from the MVP. Real paired absorption events become a follow-up once `transaction_id` exists (its own slice). `unaccountedStems` math therefore omits the absorption term: `Σ purchase − Σ consumption − Σ writeoff`.

## Vertical slices (tracer bullets, each thin path through its layers + tests)

### T5.2 — `/stock/varieties/:key/usage` endpoint + repo union — TDD RED mandatory (new repo path)
- `stockRepo.getUsageByVarietyKey(key)`: resolve all non-deleted rows in the Variety (incl. qty=0 DEs) via the same `_varietyKey` serialization `listGroupedByVariety` uses, call the existing `getUsageByExactId(rowId)` per row, concat the trails, then compute `unaccountedStems = Σ purchase.quantity + Σ (order|writeoff|premade).quantity` (orders/writeoffs/premades are already negative, purchases positive — so this is a signed sum; non-zero = drift). Return `{ variety:{...}, events, unaccountedStems }`. Sort events by date asc, undated last.
- `stock.js` route `GET /varieties/:key/usage` — parse URL-encoded `Type|Colour|Size|Cultivar` (matching `varietyKey`). Auth same as `/stock/:id/usage`. Mount the literal `/varieties/:key/usage` route BEFORE `/:id/usage` so `varieties` isn't captured as an `:id`.
- Reuse `getUsageByExactId` per row — do NOT duplicate the order/loss/purchase/premade mappers.
- Test: `backend/src/__tests__/varietyUsageTrace.integration.test.js` (pglite) — Variety with 2 Batches + 1 qty=0 DE, order consumptions across both Batches, 2 writeoffs, 1 premade; assert events unioned across all rows, chronological order, `unaccountedStems` math.

### T5.3 — qty=0 DE visibility relax in `listGroupedByVariety` — TDD RED mandatory (Known Pitfall: stockRepo grouped view, #323)
- Post-#327 the absorbing orig DE has `type_name` set, so it already passes the `type_name IS NOT NULL` filter. Remaining gap: when `includeEmpty=false`, a group whose on-hand `totalQty===0` and `reservedForPremades===0` is hidden even if it still has order-line consumers (the audit-marker case). Relax: keep such a group when ≥1 of its rows is referenced by a non-deleted `order_line.stock_item_id` (has a consumer).
- Test: extend the grouped-shape integration test — a qty=0 Variety with an active order consumer stays visible under `includeEmpty=false`.

### T5.4 — `VarietyTracePanel` shared component (pure presenter) — TDD allowed to skip red (presentational)
- `packages/shared/components/VarietyTracePanel.jsx`: `(events, unaccountedStems, t)`. Renders the 4 event kinds (order / writeoff / purchase / premade) — same badge/detail patterns + `formatDateDMY` as `BatchTracePanel`; chronological. Unaccounted footer renders only when `unaccountedStems !== 0` (drift signal; no "Open audit log" CTA in MVP — plain count). No absorption kind (deferred).
- Export in `packages/shared/index.js` + update shared CLAUDE.md structure block.
- Test: `packages/shared/test/VarietyTracePanel.test.jsx` (RTL) — 4 kinds, footer gating (hidden at 0, shown non-zero), chronological order.

### T5.5 — Wire into both apps (UI wiring, parity) — skip red
- Dashboard `StockTab.jsx`: on Variety header tap fetch `/stock/varieties/:key/usage`, mount `VarietyTracePanel` inline under the row (sibling to existing BatchTracePanel inline). 
- Florist `StockPanelPage.jsx`: mount as a sheet from `VarietyListItem` (per PRD).
- Cross-app parity rule (root CLAUDE.md): both apps, lock-step.

### T5.6 — ADR-0008 stub + lab regression + CHANGELOG — docs/tests
- `docs/adr/0008-order-line-consumption-ledger.md`: document the per-Variety trace surface + absorption event kind + audit-marker visibility rule (full ledger deferred to T1). Note ADR-0007's "order_line.stockItemId is authoritative trace link" is superseded *in plan* by #324 but still live for T5.
- Lab: extend `lab/tests/api/` with "PO receipt absorbs into orig DE → grouped includes Variety, new Batch carries attrs, orig DE visible as anchor."
- CHANGELOG.md entry (new endpoint, no schema change).

## Right-size check
6 slices, all read/UI/docs, no schema migration. Heaviest is T5.2 (repo union + integration test). Within one window if T5.2 reuses existing per-id mappers rather than re-deriving them.

## Branch + PR
- Branch `feat/variety-trace-surface` off **fresh master** (after #327 + stock-y-ui-polish land — T5.4 needs `formatDateDMY` which lands with the UI-polish PR).
- Worktree `.worktrees/variety-trace/`.
- PR body names verification: `varietyUsageTrace.integration.test.js` + lab api scenario + shared vitest + 3 app builds. `Closes` the T5 tracer issue (one per line).

## Subagent plan (cost discipline — 1 Opus window target)
- Implementer + spec-review: sonnet. Code-quality review at phase boundary (after T5.1–T5.3 backend, then T5.4–T5.5 UI): opus.
- TDD red mandatory: T5.1, T5.2, T5.3 (new util / new repo path / Known-Pitfall grouped view). Skip red: T5.4, T5.5 (presentational + wiring).
- Tight prompts: each implementer gets its slice section verbatim + this plan path + ≤5 file paths + the PRD excerpt for that behavior. No other slices.
