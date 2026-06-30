# Plan — Y-model test-session feature CRs (CR-30 / CR-32 / CR-33)

> ✅ **COMPLETE (2026-06-30).** All three features shipped: Feature A CR-33 delivery margin → #469; Feature B CR-32 courier time slots → #470 (migration 0017); Feature C CR-30 recipient address book → #471 (migration 0018, slices C1–C4). Plus the small fixes CR-29 #467 / CR-31 #466 / CR-34 #465. Nothing open. Kept for history.

**Date:** 2026-06-30
**Origin:** Y-model test session 2 CR cluster (`docs/superpowers/plans/2026-06-21-ymodel-test-session-2-crs.md`).
**Status:** design locked (owner grill 2026-06-30); ready to slice + build.

Small standalone fixes from the same cluster already shipped:
- **CR-29** — fixed-price field pre-fills the live sell total → **PR #467**.
- **CR-31** — terminal status button matches fulfillment type → **PR #466**.

This doc covers the three **features**. The `#291` Y-model cutover stays a separate track
(prod 23-row `type_name` backfill + lab PG18 PR #449 — unrelated to these CRs).

---

## Locked decisions (owner, 2026-06-30)

| CR | Decision |
|----|----------|
| CR-30 | Recipient phone + address become **first-class `key_people` columns** — a reusable address book, visible in CRM, pre-filling every future order to that person. Schema migration. |
| CR-32 | **Separate `deliveries.courier_time`** field. Client picks a **2h window** (8:00–20:00); courier is assigned a **1h slot constrained to within the client window**; the driver app shows **only** the courier slot. |
| CR-33 | Courier payout default comes from a **configurable Settings → Drivers** field (no hardcoded 35). Margin (fee − payout) shown **per-order AND in Financial analytics**. `deliveries.driver_payout` column already exists. |

---

## Build order (independent → coupled)

1. **Feature A — CR-33 delivery margin** (smallest; mostly wiring; `driver_payout` already exists).
2. **Feature B — CR-32 courier time slots** (shares the assign-courier surface with A — build right after so that surface is touched once more, not twice).
3. **Feature C — CR-30 recipient / key-person** (largest; independent of A/B; new-order wizard + CRM + schema).

Each feature = its own branch + PR. A/B may share a branch if built back-to-back (they edit the
same assign-courier components); C is fully separate.

---

## Parity surfaces (every feature touches all of these where relevant)

- New-order wizard: florist `NewOrderPage.jsx` + `steps/` ↔ dashboard `NewOrderTab.jsx` + `steps/`.
- Order detail / delivery section: florist `OrderCard.jsx` + `OrderDetailPage.jsx` ↔ dashboard `OrderDetailPanel.jsx` (+ `DeliverySection.jsx`).
- Driver view: `apps/delivery/` delivery card.
- Settings: dashboard `settings/DriverSettingsSection.jsx`.
- Shared: `packages/shared/utils/timeSlots.js`, API client.
- Backend: `deliveries.js`, `orders.js`, `orderService.js`, repos, `db/schema.js`, migration, lab factories.

---

## Feature A — CR-33: delivery margin (fee charged vs courier payout)

**Goal:** capture what we pay the courier per delivery, default-filled + editable, and surface
margin = `delivery_fee − driver_payout` per order and in aggregate.

### Slices
- **A1 — Default-payout setting (backend + Settings UI).**
  - `app_config` / settings: add `defaultCourierPayout` (number). Backend `GET/POST /settings` read/write.
  - Dashboard `settings/DriverSettingsSection.jsx`: numeric field "Default courier payout (zł)".
  - Test: settings round-trip (backend).
- **A2 — Payout on the delivery record + assign-courier UI.**
  - `driver_payout` already a column; ensure create/patch delivery accepts it (`deliveries.js`, `orderRepo`/delivery repo).
  - Assign-courier surface (florist OrderCard/OrderDetailPage delivery block + dashboard OrderDetailPanel/DeliverySection): payout input pre-filled from `defaultCourierPayout`; if untouched, persists the default. Mirror CR-29's pre-fill pattern (real default value, editable).
  - Driver app: payout is internal — do **not** show to driver.
  - Parity: florist + dashboard both.
- **A3 — Per-order margin display.**
  - Order detail (both apps): show `Delivery fee / Courier payout / Margin` line. Margin = fee − payout; colour by sign.
- **A4 — Financial analytics delivery profit.**
  - Backend `computeAnalytics` (the canonical analytics service): add `deliveryProfit` = Σ(fee − payout) over delivered orders in range. Echo period.
  - Dashboard `FinancialTab.jsx`: a "Delivery profit" figure/card.
  - Parity-pin: assistant tools read the same `computeAnalytics` → no drift (per CLAUDE.md assistant note).
  - Test: analytics service unit test for `deliveryProfit`.

### Pitfalls
- Pitfall #2/#3: payout/fee live on the **delivery sub-record**, not the order. Default from `getConfig()`, never hardcode 35.
- Numeric: store as numbers, display "zł".

---

## Feature B — CR-32: client 2h windows vs courier 1h slots

**Goal:** clients choose a 2h delivery window; couriers get a 1h slot within it; driver sees only the courier slot.

### Slices
- **B1 — Shared slot generators (`timeSlots.js`) + tests.**
  - `getClientWindows({ leadTime })` → 2h buckets 08:00–20:00 (08–10, 10–12, … 18–20), lead-time filtered (reuse existing logic).
  - `getCourierSlots(clientWindow)` → 1h slots inside the chosen 2h window (e.g. window 10–12 → [10–11, 11–12]).
  - **Mandatory tests** (new shared util behaviour): bucket boundaries, lead-time filter, courier-within-window containment, empty/invalid window.
- **B2 — Schema: `deliveries.courier_time` (text), migration + lab factory.**
  - Additive nullable column. Migration script. `lab/factories/delivery.js` updated (CLAUDE.md lab rule).
- **B3 — Client window picker in new-order (both apps).**
  - Replace the single delivery-time picker with the 2h-window picker (florist + dashboard `steps/Step3Details` / delivery time field). Stores into `delivery_time` (client window).
- **B4 — Courier-slot assignment (both apps).**
  - In the assign-courier surface: a courier 1h-slot picker, options constrained to the client's chosen window. Stores `courier_time`.
- **B5 — Driver app shows only the courier slot.**
  - `apps/delivery/` delivery card displays `courier_time` (fallback to client window if unset). Hide the client 2h window from the driver.

### Pitfalls
- Cascade rule: order date/time ↔ delivery date/time already cascades — verify the new window field cascades too.
- Don't hardcode locale/time strings; keep slot labels generated.

### Build status (2026-06-30) — SHIPPED in branch `feat/courier-time-slots` (PR #470)
- **B1 ✅** shared `getCourierSlots` + 17 tests.
- **B2 ✅** migration `0017_deliveries_courier_time.sql` + `courierTime` schema + `Courier Time` repo/route mapping + lab factory + integration test.
- **B3 ✅ (no code)** — client 2h windows already come from owner config (`deliveryTimeSlots` = `08:00–20:00` 2h buckets); the existing time pickers already store the window into `Delivery Time`. The plan's literal `getClientWindows` generator was **dropped** to keep owner config authoritative (no hardcoded 08–20).
- **B4 ✅** Courier-slot picker in the Driver block of dashboard `OrderDetailPanel` + florist `OrderCard` + `OrderDetailPage`; saves `Courier Time`; auto-clears when the client window changes.
- **B5 ✅** driver app (`DeliveryCard`/`DeliverySheet`/`MapView`/`DeliveryListPage`) shows + sorts by `Courier Time` (fallback to client window); the 2h window is hidden from the driver.

---

## Feature C — CR-30: recipient / key-person step + delivery pre-fill

**Goal:** after choosing the customer, pick an existing connected key person OR add a new one with
phone + address; the delivery step then pre-fills (recipient name, phone, address) from that person,
all editable.

### Slices
- **C1 — Schema: `key_people.phone` + `key_people.address` (text), migration + lab factory.**
  - Additive nullable columns. Backend key-people repo/routes read/write them.
  - Test: key-people create/patch round-trip with phone+address.
- **C2 — Recipient step in the new-order wizard (both apps).**
  - After Step1 Customer: a recipient selector — list the customer's `key_people` (chips), "+ Add new recipient" (name + phone + address). Selecting sets `keyPersonId` (+ recipient fields on the form). Adding new persists a key person (so it's reusable) and selects it.
  - Reuse florist `KeyPersonChips` / dashboard equivalent where possible.
- **C3 — Delivery pre-fill from the chosen recipient (both apps).**
  - Step3 Details / delivery info: when a recipient is chosen and type=Delivery, pre-fill recipientName / recipientPhone / deliveryAddress from the key person (editable; pitfall #1 — derive from local state).
- **C4 — CRM surfacing (both apps).**
  - `key_people` phone + address shown/editable in customer detail (florist `CustomerDetailView`/`KeyPersonChips` ↔ dashboard `CustomerDetailView`). Parity.

### Pitfalls
- Pitfall #1: after selecting/changing recipient, derive pre-filled delivery values from local form state, not a stale prop.
- `orders.keyPersonId` already exists (#216) — wire selection to it.
- Parity across florist + dashboard CRM + wizard.

---

## Cross-cutting verification (per `docs/agents/workflow-config.md` matrix)

- **backend/** → `cd backend && npx vitest run`; `npm run harness &` + `npm run test:e2e`.
- **packages/shared/** → shared vitest; build **all three** apps.
- **schema / lab/** → `npm run lab:test:unit` + `npm run lab:test:api` (factories updated in the same PR).
- Migrations: additive nullable columns only → safe on prod (production-only env). Each migration script categorised (SAFE/GUARDED/DESTRUCTIVE header).
- PR body names the proof path (E2E section / integration test / build).

## TDD policy (workflow-config)
- **Red phase mandatory:** new shared slot generators (B1), backend analytics `deliveryProfit` (A4), key-people repo phone/address (C1), any new backend service.
- **Skip red:** pure UI wiring (pickers, pre-fill display, Settings field), Tailwind, copy.

## Translations
Every new UI string in ru + en (+ pl where the app carries it) across both apps.
