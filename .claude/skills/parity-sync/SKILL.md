---
name: parity-sync
description: Mirror a feature across the florist, dashboard, and delivery apps so the Cross-App Feature Parity rule in CLAUDE.md is never violated. Use when the user asks to add, port, or backport behavior between apps, says "also enable in the florist app", "add to the dashboard too", or touches any file listed in the parity table.
---

# Parity Sync

The owner uses dashboard on desktop and the florist app on her phone for the same daily tasks. Drivers use the delivery app. Whenever a user-facing behavior is added to one app, the matching surface in the other apps must move in lockstep — otherwise the owner finds the dashboard does X and her phone doesn't, and a bug report follows.

This skill is the disciplined walk through every parity surface, every translation key, and every build that has to stay green.

## Quick start

1. Identify the changed surface in the parity table below.
2. Read the canonical site + every paired site before editing.
3. Make the change in lockstep across paired sites.
4. Mirror translation keys in every app's `translations.js` that surfaces the string.
5. Run the build matrix from [pre-pr-matrix] (especially the all-three-apps build when `packages/shared/` is touched).
6. Commit the paired changes together — never a parity diff over two commits.

## Parity table (single source of truth — also in CLAUDE.md)

| Domain | Florist | Dashboard | Delivery |
|---|---|---|---|
| Order editing | `apps/florist/src/components/OrderCard.jsx` + `apps/florist/src/pages/OrderDetailPage.jsx` | `apps/dashboard/src/components/OrderDetailPanel.jsx` | — |
| Stock management | `apps/florist/src/pages/StockPanelPage.jsx` + `apps/florist/src/components/StockItem.jsx` | `apps/dashboard/src/components/StockTab.jsx` | — |
| PO management | `apps/florist/src/pages/PurchaseOrderPage.jsx` | `apps/dashboard/src/components/StockOrderPanel.jsx` | — |
| Order creation | `apps/florist/src/pages/NewOrderPage.jsx` + `apps/florist/src/pages/steps/` | `apps/dashboard/src/components/NewOrderTab.jsx` + `apps/dashboard/src/components/newOrderSteps/` | — |
| Bouquet editing | `apps/florist/src/components/BouquetEditor.jsx` | `apps/dashboard/src/components/order/BouquetSection.jsx` | — |
| CRM | `apps/florist/src/pages/CustomerListPage.jsx` + `apps/florist/src/pages/CustomerDetailPage.jsx` | `apps/dashboard/src/components/CustomersTab.jsx` + `apps/dashboard/src/components/CustomerDetailView.jsx` | — |
| Premade bouquets | `apps/florist/src/pages/BouquetsPage.jsx` + `apps/florist/src/pages/PremadeBouquetCreatePage.jsx` | `apps/dashboard/src/components/PremadeBouquetList.jsx` + `apps/dashboard/src/components/PremadeBouquetCreateModal.jsx` | — |
| Waste log | `apps/florist/src/pages/WasteLogPage.jsx` | `StockLossSection` inside `apps/dashboard/src/components/SettingsTab.jsx` | — |
| Delivery view | — | (informational only) | `apps/delivery/src/...` |

Surface not in the table? Either you have a delivery-only or settings-only feature (fine — flag it), or the table is stale (update CLAUDE.md in the same PR).

## Workflow

### Step 1 — Inventory the touch
- [ ] Locate every file in the row for the domain you are changing.
- [ ] `git grep` for shared hooks/components the change depends on (`packages/shared/hooks/`, `packages/shared/components/`).
- [ ] If a parity site consumes shared code, prefer extending the shared seam over duplicating logic. See `useOrderTerminationFlow` for the canonical pattern.

### Step 2 — Translation keys
- [ ] Every new user-visible string needs a key in `apps/florist/src/translations.js` AND `apps/dashboard/src/translations.js` (and `apps/delivery/src/translations.js` if delivery is affected).
- [ ] Russian copy in all three files must match — the owner sees the same words on desktop and phone.
- [ ] Run `git grep "<your new key>" apps/` to confirm every app resolves it.

### Step 3 — Lockstep edit
- [ ] Implement in florist first if it is the owner's mobile path, otherwise start where the source of truth lives.
- [ ] Port to the dashboard site immediately. Do not split into two PRs.
- [ ] Re-read the diff side by side to confirm prop names, status constants, and toast keys match.

### Step 4 — Status / cascade audit
- [ ] If touching order or delivery code, confirm the status cascade rules in CLAUDE.md still hold (Order ↔ Delivery, Order date → Delivery date, cancel-with-return path through `useOrderTerminationFlow`).
- [ ] If touching stock code, never re-introduce `qty - committed`. Use `getEffectiveStock(qty)` from `packages/shared/utils/stockMath.js` in both apps.

### Step 5 — Build matrix (mandatory when `packages/shared/` touched)
- [ ] `cd apps/florist && ./node_modules/.bin/vite build`
- [ ] `cd apps/dashboard && ./node_modules/.bin/vite build`
- [ ] `cd apps/delivery && ./node_modules/.bin/vite build`
- [ ] `cd packages/shared && ../../backend/node_modules/.bin/vitest run`
- [ ] Building all three is the only way to catch a missing dep in `packages/shared/package.json`. Vercel builds each app in isolation; npm-workspace hoisting hides the bug locally if you only build one app.

### Step 6 — Commit + PR
- [ ] One PR, one commit when feasible. Title and body name both surfaces.
- [ ] If the parity table needed an update, the same PR updates `CLAUDE.md`.

## Red flags

| Thought | Reality |
|---|---|
| "Only owner asked for this in the florist app" | She uses both. Add to dashboard too. |
| "Dashboard already has it" | Confirm — and ensure the florist mirror was not skipped. |
| "Delivery doesn't care" | True for most domains, false for status cascades. Check the table. |
| "I'll port to the other app in a follow-up PR" | Drift starts here. Do it now or do not merge. |
| "Tests pass" | Tests do not enforce parity. Manual checklist is the gate. |

## When the table is wrong

If a domain has moved or a new surface was added, update the table in `CLAUDE.md` and the matching table in this skill in the same PR. Drift is what makes the rule fail.
