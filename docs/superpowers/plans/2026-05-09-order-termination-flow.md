# Order termination flow — shared seam

**Status:** in flight (feat/order-termination-flow)
**Started:** 2026-05-09
**Owner:** OliwerO
**Origin:** /improve-codebase-architecture grilling session, candidate #2 (cancel-with-return convention → interface)

## Outcome

Move Order **Cancellation** and **Deletion** flows behind a shared seam:

- `packages/shared/hooks/useOrderTerminationFlow.js` — owns confirm-state, both endpoints, toast composition.
- `packages/shared/components/OrderTerminationConfirm.jsx` — default inline-card confirm UI.

Three current sites — `apps/florist/src/components/OrderCard.jsx`, `apps/florist/src/pages/OrderDetailPage.jsx`, `apps/dashboard/src/components/OrderDetailPanel.jsx` — drop their duplicated `handleCancel` / `handleDelete` / `confirmCancel` state and consume the hook + component.

CLAUDE.md Pitfall #7 ("three sites must stay in lockstep") is rewritten to point at the seam: drift becomes structurally impossible.

## Why

Pitfall #7's discipline lives in a comment, not an interface. Toast composition already drifts across the three sites (ternary vs if/else, English fallbacks present in dashboard / absent in florist). A future fourth site would silently regress to pre-2026-05-02 behaviour (Status flipped, Stems never returned). Domain vocabulary (Termination / Cancellation / Deletion) was not in CONTEXT.md and is added in the same PR.

## Domain vocabulary (added in this PR — see CONTEXT.md)

- **Termination** — terminal action ending an Order's lifecycle. Two kinds.
- **Cancellation** — Status flips to Cancelled; Order remains; reopenable.
- **Deletion** — Owner-only; record removed; irreversible.

Both kinds offer the *return Stems / leave deducted* choice.

## Module shape (deletion test)

**`useOrderTerminationFlow`** — deep. Delete it → `handleCancel`, `handleDelete`, `confirmCancel`, toast composition reappear in 3 sites with drift. Concentration win is real.

**`OrderTerminationConfirm`** — deep. Delete it → inline-card markup (`ios-card`, two/three-button row, red labels) reappears in 3 sites. Concentration win is real.

Hook signature follows the existing `useOrderPatching` DI convention — translations live per-app (`apps/florist/src/translations.js`, `apps/dashboard/src/translations.js`), so `t`, `apiClient`, and `showToast` are injected by the host:

```js
useOrderTerminationFlow({
  orderId,
  apiClient,           // axios-like; .post / .patch / .delete
  showToast,           // (msg, kind) => void
  t,                   // host's translations object
  onSuccess,           // ({ kind: 'cancel' | 'delete', returnedItems }) => void
  onError,             // optional (err) => void; default: showToast(err.response?.data?.error || t.updateError, 'error')
}) → {
  confirmOpen,         // boolean
  pendingKind,         // 'cancel' | 'delete' | null  drives confirm copy
  saving,              // boolean
  requestCancel,       // () => void   open confirm in cancel mode
  requestDelete,       // () => void   open confirm in delete mode (Owner-only sites)
  cancelWithReturn,    // () => Promise<void>   POST /orders/:id/cancel-with-return
  cancelOnly,          // () => Promise<void>   PATCH /orders/:id { Status: 'Cancelled' }
  deleteWithReturn,    // () => Promise<void>   DELETE /orders/:id
  dismiss,             // () => void
}
```

Toast composition (matches existing florist behaviour exactly — dashboard's English fallbacks are dropped because all translation keys are confirmed present):
- cancel + return + non-empty `returnedItems` → `${t.orderCancelled}. ${t.stockReturned}: ${name}: +${qty}, ...`
- cancel + return + empty `returnedItems` → `${t.orderCancelled}`
- cancel-only → no toast on success path; PATCH route emits its own (cf. existing `useOrderPatching`)
- delete + non-empty → `${t.orderDeleted}. ${t.stockReturned}: <summary>`
- delete + empty → `${t.orderDeleted}`

**Cancel-only quirk:** existing florist `OrderCard.handleCancel` calls `await patch({ 'Status': 'Cancelled' })` which routes through the host's own patch helper (which already toasts). Hook's `cancelOnly` calls `apiClient.patch` directly and does NOT toast — caller's `onSuccess` handles state update. This avoids double-toast. Test must lock this.

Component signature:
```jsx
<OrderTerminationConfirm
  flow={termFlow}              // hook return value
  t={t}                        // translations
  allowDelete={isOwner}        // default false
/>
```

Translation keys verified present in both apps (en + ru): `orderCancelled`, `orderDeleted`, `stockReturned`, `cancelConfirm`, `cancelAndReturn`, `cancelNoReturn`, `cancel`, `updateError`. No fallback strings needed.

## Vertical slices

Each slice is demoable end-to-end. Sequence respects deps: hook + component scaffolded with one consumer in slice 1; remaining consumers migrated; delete path added on top; docs last.

### Slice 1 — Scaffold hook + component, migrate florist OrderCard cancel paths

**Files (≤4):**
- `packages/shared/hooks/useOrderTerminationFlow.js` (new, ~120 LOC)
- `packages/shared/components/OrderTerminationConfirm.jsx` (new, ~60 LOC)
- `packages/shared/test/useOrderTerminationFlow.test.js` (new, ~150 LOC)
- `apps/florist/src/components/OrderCard.jsx` (drop `handleCancel` + `confirmCancel` state + inline confirm card markup)
- `packages/shared/index.js` (re-exports)

**Scope this slice:**
- Hook supports `cancelWithReturn`, `cancelOnly`, `requestCancel`, `dismiss`. **No delete yet.**
- Component renders cancel confirm only.
- Migrate `OrderCard.jsx` — drop local handlers + state; mount `<OrderTerminationConfirm flow={...} />`.

**TDD red phase: MANDATORY.** Hook is a new shared utility (CLAUDE.md Testing Rules + /feature §6).

**Tests gate:**
- `cancelWithReturn` — mocks `client.post`, asserts toast composition matches `${t.orderCancelled}. ${t.stockReturned}: <summary>`.
- `cancelWithReturn` empty `returnedItems` — toast omits `: ` summary suffix.
- `cancelOnly` — mocks `client.patch`, asserts payload `{ Status: 'Cancelled' }`.
- Error path — `client.post` rejects, asserts `showToast('error')` + `onError` called with `err.response?.data?.error || t.updateError`.
- `requestCancel` opens confirm; `dismiss` closes.

**Demoable:** Cancel pill on a florist OrderCard opens confirm; both buttons work; toast appears; pre-existing E2E `cancel-with-return` section still passes.

**Code review:** Per-task review (Pitfall #7 area).

### Slice 2 — Migrate florist OrderDetailPage cancel paths

**Files (≤2):**
- `apps/florist/src/pages/OrderDetailPage.jsx` (drop `handleCancel` + `confirmCancel` state + cancel button markup; keep `handleDelete` for now)

**Scope:**
- Replace cancel handler/state with hook+component.
- `handleDelete` stays inline until slice 4.

**TDD red phase: SKIP.** Pure UI wiring per /feature §6.

**Tests gate:** Existing E2E `cancel-with-return` section still passes; manual smoke (cancel a Pickup order, observe toast + status flip).

**Demoable:** Florist full-page detail view cancels via shared seam.

**Code review:** Phase-boundary review with slice 3.

### Slice 3 — Migrate dashboard OrderDetailPanel cancel paths

**Files (≤2):**
- `apps/dashboard/src/components/OrderDetailPanel.jsx` (drop `handleCancel` + `confirmCancel` state + cancel button markup; keep `handleDelete` for now)

**Scope:**
- Replace cancel handler/state with hook+component.
- `handleDelete` stays inline until slice 4.

**TDD red phase: SKIP.** Pure UI wiring.

**Tests gate:** Existing E2E section still passes; manual smoke (cancel an order from dashboard panel).

**Demoable:** All three sites cancel through one seam. Pitfall #7 cancel-side concentration achieved.

**Code review:** Phase-boundary review covering slices 2 + 3.

### Slice 4 — Extend hook with Deletion path; migrate two delete sites

**Files (≤4):**
- `packages/shared/hooks/useOrderTerminationFlow.js` (add `requestDelete`, `deleteWithReturn`, `pendingKind`)
- `packages/shared/components/OrderTerminationConfirm.jsx` (handle `pendingKind === 'delete'` copy + button)
- `packages/shared/test/useOrderTerminationFlow.test.js` (add delete-path tests)
- `apps/florist/src/pages/OrderDetailPage.jsx` (drop `handleDelete` + `confirmDelete` state)
- `apps/dashboard/src/components/OrderDetailPanel.jsx` (drop `handleDelete` + `confirmDelete` state)

(5 files but coherent single change. Splitting would force half-finished hook in repo.)

**Scope:**
- Hook gains `pendingKind` discriminator. `requestCancel` sets `'cancel'`, `requestDelete` sets `'delete'`. Confirm copy + endpoint differ by kind.
- Component conditionally renders the third button when `allowDelete && pendingKind === 'delete'`.
- Florist OrderCard does NOT gain delete (owner uses dashboard or detail page for that); `allowDelete=false` is the default.

**TDD red phase: MANDATORY.** Hook expansion = shared utility change.

**Tests gate:**
- `deleteWithReturn` — mocks `client.delete`, asserts toast composition with `t.orderDeleted` + summary.
- `deleteWithReturn` empty `returnedItems` — toast shows just `t.orderDeleted`.
- Switching `pendingKind` — `requestCancel` then `requestDelete` updates discriminator without bleed.
- Error path mirrors cancel.

**Demoable:** Owner deletes an erroneous Order from dashboard or detail page; toast names returned Stems; record gone.

**Code review:** Per-task review (Pitfall #7 area; Owner-only deletion is sensitive).

### Slice 5 — Docs + CHANGELOG

**Files (≤4):**
- `CLAUDE.md` (rewrite Pitfall #7 to point at the seam; remove "three sites must stay in lockstep")
- `apps/florist/CLAUDE.md` (OrderCard row + OrderDetailPage row note hook reference)
- `apps/dashboard/CLAUDE.md` (OrderDetailPanel row note hook reference)
- `CHANGELOG.md` (entry under today's date: shared `useOrderTerminationFlow` + `OrderTerminationConfirm`; CONTEXT.md vocabulary added)

**Scope:** Pure doc updates.

**TDD red phase: SKIP.** Doc edits.

**Tests gate:** None.

**Demoable:** N/A (doc).

**Code review:** Phase-boundary review.

## Pre-PR matrix (per CLAUDE.md § Pre-PR Verification)

Run all that apply — quote actual green output before claiming done:

1. `cd packages/shared && ../../backend/node_modules/.bin/vitest run` — must include the new hook tests.
2. `cd apps/florist && ./node_modules/.bin/vite build` — shared touches ripple.
3. `cd apps/dashboard && ./node_modules/.bin/vite build` — same.
4. `cd apps/delivery && ./node_modules/.bin/vite build` — re-export safety.
5. `npm run harness` (background) + `npm run test:e2e` — covers the cancel-with-return E2E section (the regression that originally surfaced Pitfall #7).
6. Lab matrix only if backend / lab touched (not in scope of this PR; skip).

## PR body verification line

> **Verification:** shared vitest (`useOrderTerminationFlow.test.js` — N tests green) + Vite build × 3 apps (florist, dashboard, delivery) + harness + `test:e2e` cancel-with-return section pass.

## Out of scope

- Florist `OrderCard.jsx` does **not** gain delete UI. Delete remains a detail-page / dashboard-panel action (current behaviour).
- Backend endpoints unchanged. POST `/orders/:id/cancel-with-return`, PATCH `/orders/:id`, DELETE `/orders/:id` — all pre-existing.
- No schema change.
- No migration of `cancelWithStockReturn` out of `orderService.js` (that is candidate #1 — Stock module extraction, deferred plan).

## Failure modes / what to watch for

- **Toast text drift.** If hook's toast composition diverges from the existing E2E assertions, the test will catch it. Match: `${t.orderCancelled}. ${t.stockReturned}: <name>: +<qty>, ...`.
- **`onSuccess` callback race.** Hosts may call `setOrder` / `setDetail` / `navigate` in `onSuccess`. Hook must not call `onSuccess` after unmount. Use ref flag.
- **Owner-only `allowDelete` gating.** Component must default `allowDelete=false`. Florist app passes nothing → no delete button.
- **Translation fallback.** Dashboard's existing handlers used `t.orderDeleted || 'Order deleted'`. Hook uses `t.orderDeleted` only — assumes translation key always present. If a key is missing, the toast string becomes literal `undefined`. Pre-PR: grep `translations.js` for the four keys (`orderCancelled`, `orderDeleted`, `stockReturned`, `cancelConfirm`, `cancelAndReturn`, `cancelNoReturn`).
