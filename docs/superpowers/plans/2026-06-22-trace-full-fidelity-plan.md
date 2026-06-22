# Y-model Trace Full-Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking. Each slice = its own branch+PR off master.

**Goal:** Make the Y-model stock trace full-fidelity and discoverable: a one-tap history button on every Variety row, first-PO/first-demand markers, and absorption events surfaced as real paired rows (not drift) via an `audit_log.transaction_id` migration. Seed rich lab data so it's all testable.

**Architecture:** The graphical trace (BalanceSparkline + chronological event list in `VarietyTracePanel`/`BatchTracePanel`) already exists (shipped #411). This feature (a) seeds data, (b) adds reach, (c) adds first-PO/demand markers (pure derivation), (d) adds an absorption event class backed by a new nullable `audit_log.transaction_id` column threaded through the two absorption sites, (e) renders the new kind.

**Tech Stack:** Express + Drizzle + Postgres (pglite in lab/tests); React + Tailwind shared components; Vitest; lab harness (factories + scenarios + Playwright).

## Global Constraints
- `STOCK_Y_MODEL` flag-off (current prod) MUST stay inert for every slice. The new column is nullable/no-default; legacy NULL rows emit no absorption events; existing bare-`select()` readers (`admin.js`, `test.js`) unaffected (pure superset).
- **Pitfall #9** (LOAD-BEARING): the new dated Batch from `receiveIntoStock` MUST keep `Type/Colour/Size/Cultivar` and back-fill orig DE attrs in the same tx; do NOT touch the ADR-0002 absorption math (`batchQty = qty + existingQty`; clamp 0). Regression-locked by `stockOrders.receiveIntoStock.integration.test.js`.
- Audit writes happen INSIDE repo transactions via the `recordAudit`/`tryAudit` seam — never from a route after the fact. Thread `transactionId` through repo opts.
- New shared utils/hooks/components and new lab factories REQUIRE test files (CI 80% coverage on shared utils/hooks; lab-api gate).
- UI strings Russian via `t.xxx` in BOTH `apps/florist` and `apps/dashboard` translations.js (EN + RU).
- Cross-app parity: `VarietyTracePanel` and `BatchTracePanel` each hold private copies of `typeLabel`/`typeBadgeClass`/`trailDetail` — event-kind edits go in BOTH.
- Update `CHANGELOG.md` + relevant `CLAUDE.md` in the same PR that changes structure.
- Never `git add -A` — stage explicit paths.

## Open-question resolutions (decided, do not re-ask)
- Keep the existing in-body `variety-trace-btn` alongside the new header history button.
- First-PO/first-demand markers render in `VarietyTracePanel` only (Variety-level), not `BatchTracePanel`.
- Absorption event `quantity` = `received − batchQty` (the +N credited to pre-sold demand), signed positive; detail names the source PO + orig→batch context; balance-line contributing.
- No backfill for pre-migration absorptions (legacy NULL transaction_id → stays drift). Lab seed gets paired audit rows so a real absorption event is visible.

---

## Absorption event mechanism (S4 core)
- **Migration** `backend/src/db/migrations/0016_audit_log_transaction_id.sql`: `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS transaction_id UUID;` + partial index `WHERE transaction_id IS NOT NULL`. Add `transactionId: uuid('transaction_id')` to `auditLog` pgTable in `schema.js`. No `_journal.json` edit (migrate.js journal-free; pglite boot reads dir lexicographically). Single statement → no breakpoint marker.
- **Threading**: extend `recordAudit(tx, {...})` in `backend/src/db/audit.js` to accept optional `transactionId`; forward through each repo's `tryAudit`/`opts` (`adjustQuantity`/`create`/`update`). Generate ONE `crypto.randomUUID()` at the absorption entry point, wrap the whole absorption in a single `db.transaction`, pass `{ tx, transactionId }` to every repo call inside. Two sites: PO-evaluate `receiveIntoStock` (`stockOrders.js:653-730`, called :895/:953) and manual `stockPurchases.js` POST (:13-82).
- **Pairing + emit**: in `getUsageByVarietyKey`, after gathering events, query `audit_log WHERE transaction_id IS NOT NULL` for the Variety's stock entity_ids, group by `transaction_id`; a group with a DE-zeroing `update` (qty negative→0) paired with a Batch `create` → emit one `{type:'absorption', quantity:+N, date, ...}` where N = `received − batchQty` (derive from the DE delta, NOT the stock_purchases row which holds the full received qty → would double-count). This offsets the live `-N` order events → `unaccountedStems` shrinks toward 0.
- **Both zeroing shapes**: `stockOrders.js` uses `adjustQuantity(-existingQty)` (delta); `stockPurchases.js` uses `update({Current Quantity:0})` (hard set). Pairing must recognise either `update` that drives qty negative→0.

---

## Slices

### Slice S1 — Rich lab data (PO→orders→write-off→low arcs + absorption state) — `data`, dep: none
**Files:** create `lab/factories/stockLoss.js`, `lab/factories/stockPurchase.js`, their `.test.js`; modify `lab/factories/index.js`, `lab/helpers/seed.js` (insert AFTER `stock` — FK), `lab/scenarios/yModelGuide.js`.
**Deliverable:** relaunch lab → populated Waste Log (3 losses, date-DESC) + several Varieties showing received→wilted→low + one Anemone absorption-state case (orig DE 0, dated batch, a stock_purchases receive). Testable alone.
**Tests:** factory `.test.js` assert NOT-NULL columns (`date`/`purchase_date`, `quantity`/`quantity_purchased`, `reason ∈ LOSS_REASON`, `notes` default `''`) + `stockId→stock_id` shorthand. `lab:test:unit` + `lab:test:api`.
**Verify→lab:** `lab:migrate` (no-op), `lab:template:rebuild --scenario=y-model-guide`, `lab:reset`, restart lab dev.

### Slice S2 — One-tap history button on every collapsed Variety row — `frontend`, dep: S1
**Files:** `packages/shared/components/VarietyListItem.jsx`, `packages/shared/test/VarietyListItem.test.jsx`.
**Deliverable:** each collapsed Variety row gets a history/clock icon button (`data-testid=variety-history-btn`) opening the existing graphical trace (modal florist / inline dashboard); row body still expands to batches. One shared edit → both apps.
**Tests:** button renders only when `onVarietyTrace` wired; click calls trace handler AND `stopPropagation` (does NOT toggle header expand). Build all 3 apps.

### Slice S3 — First-PO / first-demand markers (backend-derived, no migration) — `backend+frontend`, dep: S2
**Files:** `backend/src/repos/stockRepo.js`, `backend/src/__tests__/stockRepo.varietyTrace.test.js`, `packages/shared/components/VarietyTracePanel.jsx`, `packages/shared/test/VarietyTracePanel.test.jsx`.
**Deliverable:** trace shows a 'First PO' pill on earliest purchase event + 'First demand' pill on earliest order event. Pure derivation in `getUsageByVarietyKey` after ascending sort (set `firstPo`/`firstDemand` flags). Balance unaffected.
**Tests:** backend asserts exactly one `firstPo` (earliest purchase) + one `firstDemand` (earliest order); empty/single safe. Frontend asserts pills render on flagged rows with `t.traceFirstPo`/`t.traceFirstDemand`, balance unchanged. Add keys to BOTH apps' translations (EN+RU). Build all 3 apps.

### Slice S4 — audit_log transaction_id migration + thread UUID through absorption — `backend+schema`, dep: none
**Files:** `backend/src/db/migrations/0016_audit_log_transaction_id.sql`, `backend/src/db/schema.js`, `backend/src/db/audit.js`, `backend/src/repos/stockRepo.js`, `backend/src/routes/stockOrders.js`, `backend/src/routes/stockPurchases.js`, `backend/src/__tests__/stockOrders.absorptionTrace.integration.test.js`. PLUS lab-seed paired audit rows for the absorption case (so a real absorption event is visible on lab).
**Deliverable:** an absorption writes DE-zeroing + Batch-create audit rows under one shared transaction_id; `getUsageByVarietyKey` pairs them → one `{type:'absorption'}` event; `unaccountedStems`→0. Flag-off + legacy NULL inert.
**Tests:** `stockOrders.absorptionTrace.integration.test.js` (paired rows share one transaction_id; one absorption event; drift==0; legacy NULL → none). Pitfall #9: existing `receiveIntoStock.integration.test.js` still green. `recordAudit` unit for optional transactionId (existing callers unaffected). `cd backend && npx vitest run` + `npm run harness && npm run test:e2e` + `lab:test:unit` + `lab:test:api`.

### Slice S5 — Render absorption event kind in both trace panels — `frontend`, dep: S4
**Files:** `packages/shared/components/VarietyTracePanel.jsx`, `packages/shared/components/BatchTracePanel.jsx`, `packages/shared/test/VarietyTracePanel.test.jsx`, `packages/shared/CLAUDE.md` (event-kind set changed).
**Deliverable:** absorption renders as a first-class trace row (cyan badge, signed qty, date, sparkline point); amber drift footer now only genuinely-unexplained stems.
**Tests:** absorption event renders with `t.traceTypeAbsorption` + cyan badge, contributes signed qty to balance, NOT special-cased like dissolve. Mirror `typeLabel`/`typeBadgeClass`/`trailDetail` in BOTH panels. Add `traceTypeAbsorption` to BOTH apps' translations (EN 'Absorbed' / RU 'Поглощение'). Build all 3 apps.

---

## ⚠️ S4/S5 RE-SCOPE FINDING (2026-06-22, after reading the real code)
The absorption-causes-drift premise behind S4/S5 is FALSE under the actual model:
- `unaccountedStems = Σ(all event quantities)` (`stockRepo.js:1410`); footer (`VarietyTracePanel.jsx:47`) shows it raw when ≠ 0.
- Absorbed Variety (DE −5, receive 25 → DE=0, batch=20): events order −5 + purchase +25 = **+20 = on-hand**. No distinct drift. Balance sparkline already shows the dip-to-negative-then-recover absorption story.
- Generally `Σ events ≈ currentQty − premadeReservations`, so the amber "Unaccounted" footer fires on ANY healthy stocked Variety — a clarity bug the rich S1 data will EXPOSE.
- An absorption event sized to "drift→0" would CREATE false drift. A prod `transaction_id` migration buys only a balance-neutral "Absorbed" label — low value vs cost/risk.
**OWNER DECIDED 2026-06-22:** (1) **SKIP the absorption migration** — S4 + S5 CANCELLED (balance line already shows the absorption story; no real drift; migration was cosmetic). (2) **FIX the footer to true drift** — new slice S6. True drift = `unaccountedStems + reservedStems − onHand`; footer fires ONLY when `drift > 0` (genuine vanished-without-event stems) — auto-hides healthy stock AND untraced legacy/opening stock (negative drift). One seed reconcile: Hydrangea batch 12→18.

## Ledger
- [x] S1 — rich lab data (PR #420, squash 42f2e4d, review clean, CI green, deployed to lab)
- [x] S2 — history button (PR #421, squash 0675369, review clean, CI green, on lab)
- [x] S3 — first-PO/first-demand markers (PR #422, squash 4ec1d2f, review clean, CI green, on lab — verified via trace API: Rose Red purchase[firstPo]/order[firstDemand])
- [x] ~~S4 — absorption migration~~ — **CANCELLED (owner: skip migration, 2026-06-22)**
- [x] ~~S5 — absorption render~~ — **CANCELLED**
- [x] S6 — true-drift footer (PR #423, squash b3d5c6a, review clean, CI green) + Hydrangea seed reconcile — DEPLOYED to lab; verified Rose/Hydrangea/Anemone all drift=0 (footer hidden) via trace API.

- [x] S7 — step-chart balance redesign (PR #424, squash 6c03721, CI green incl. NEW shared job) + shared JSX test-infra fix. DEPLOYED + Playwright-verified on lab (Rose Red staircase, +40/0 axes, 4 dates, tooltips). Surfaced that shared *.test.jsx NEVER ran (no react plugin + no CI job); now 45 files/509 tests genuinely green + gated.

**FEATURE COMPLETE 2026-06-22:** S1+S2+S3+S6+S7 all merged + live on lab. S4/S5 cancelled. Trace = rich data + history button + first-PO/demand markers + true-drift footer + staircase chart (axes/0-line/markers/tooltips).

(Update on each clean review: `Sx: complete (commits <base7>..<head7>, PR #NNN, review clean)`.)
