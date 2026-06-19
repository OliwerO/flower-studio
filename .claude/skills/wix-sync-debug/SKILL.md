---
name: wix-sync-debug
description: Diagnose Wix product sync and webhook intake issues — the bidirectional bridge between flower-studio Postgres and the Wix storefront. Maps the moving parts (webhook → orderService, wixProductSync, wixPushJob, wixMediaClient), enumerates the failure modes that produced the April 2026 fix cluster, and prescribes the verification gate from CLAUDE.md before claiming a fix. Use when the owner says "products aren't syncing to Wix", "the webhook didn't fire", "Wix order didn't import", "available today isn't showing", "image upload broke", or any Wix-touching bug.
---

# Wix Sync Debug

Wix is the bidirectional integration that has shipped >5 fixes in 2 weeks (April 2026). Two directions, two failure surfaces:

- **Inbound** — Wix posts a webhook on a new order. `backend/src/routes/webhook.js` validates the signature, calls `orderService.createWixOrder()`, which fans out to stock decrement, audit log, SSE event, Telegram alert.
- **Outbound** — `wixPushJob.js` reads the product queue and calls `wixProductSync.js` to push catalog updates; `wixMediaClient.js` handles image uploads.

Most bugs sit at the seams. This skill walks the seams in order.

## Quick start

1. Reproduce or capture the failing event (real webhook payload, real product ID).
2. Run [owner-bug-intake] first to get Railway logs + PG state for the affected record.
3. Locate the failure on the inbound or outbound side using the map below.
4. Replay against the lab harness (`lab/WORKFLOW.md`) — never hot-fix prod first.
5. Fix at the lowest-level seam (route → service → client), not in the controller.
6. **Verification gate is mandatory** — the PR must name the automated path that proved it (E2E section, integration test, signed replay, harness run). Otherwise prefix the PR title `[unverified]`.

## Component map

### Inbound — Wix → flower-studio
| Seam | File | What can go wrong |
|---|---|---|
| HTTP route | `backend/src/routes/webhook.js` | Signature mismatch, payload schema drift, content-type. |
| Order creation | `backend/src/services/orderService.js` (`createWixOrder` / similar) | Customer match logic, currency, stem-item linking. |
| Stock decrement | `orderService.js` → `atomicStockAdjust` | Negative stock is intentional (a signal), not a bug. |
| Audit log | `orderRepo` transaction | Audit row must be inside the same tx. |
| SSE broadcast | `backend/src/events.js` | Listeners are the dashboard/florist apps. |
| Telegram alert | `backend/src/services/telegram.js` | Silent fails — check logs for `[TELEGRAM]`. |

### Outbound — flower-studio → Wix
| Seam | File | What can go wrong |
|---|---|---|
| Push queue | `wix_push_queue` table (or equivalent) | Job rows stuck in `pending`, retry count exhausted. |
| Worker | `backend/src/services/wixPushJob.js` | Loop crashes, OAuth token expiry, rate limit. |
| Product mapping | `backend/src/services/wixProductSync.js` | Tag → `leadTime`, "Available Today" gate, variant mismatch. |
| Media upload | `backend/src/services/wixMediaClient.js` | Image MIME, size cap, expired token. |
| Catalog write | Wix API | 4xx response → retry policy; 5xx → backoff. |

## Workflow

### Step 1 — Pin the symptom and the direction
- Inbound: webhook received but order missing / wrong customer / wrong fields.
- Outbound: change made in dashboard but Wix storefront stale; "Available Today" carousel empty; image not uploaded.

If unclear, ask one focused question. Inbound and outbound share nothing structurally — wrong direction = wrong file.

### Step 2 — Run [owner-bug-intake] Phase 0
- Railway logs grepped for `[WIX]`, `[FEEDBACK]`, the order/product ID, the Wix `productId`.
- PG read of the affected row(s) via `claude_ro`.
- `shadow-health.js` for platform-wide sanity.

Do not move to Step 3 without log + PG evidence in hand.

### Step 3 — Locate the failure
Inbound failure modes (April 2026 cluster):
- Webhook signature check rejecting valid payloads after secret rotation.
- Customer dedupe matching the wrong email-cased duplicate.
- Stem mapping defaulting to a removed stock item.
- `orderService.createWixOrder` not wrapped in tx → audit gap on rollback.

Outbound failure modes:
- Push queue stuck in `pending` because the worker crashed silently.
- `leadTimeDays` not zeroed for tag-only "Available Today" products (fixed in commit `fe05b2a` 2026-05-16).
- Image upload retrying on a 4xx (Wix rejects); should give up faster.
- OAuth token expiry not refreshing.

For each candidate, check the matching seam in the map above.

### Step 4 — Reproduce in the lab harness
Use `lab/WORKFLOW.md` to replay the failure deterministically:
- Inbound: replay a captured signed webhook payload against the lab backend.
- Outbound: enqueue a synthetic push job in the lab DB, run the worker once, assert the Wix mock client recorded the expected call.

Never debug Wix sync against prod. The lab harness is the verification gate the April 2026 cluster prompted.

### Step 5 — Fix at the seam
- Inbound bug → the route or `orderService` method, not the dashboard UI.
- Outbound bug → the service or client, not the dashboard UI.
- Status / tag logic that crosses both sides → almost always a Wix product-mapping change in `wixProductSync.js`, with a mirror in the dashboard product-edit UI.
- If a tag changes meaning (e.g. "Available Today" → `leadTime = 0`), update both the writer (server-side derive) and the reader (UI gate) — and add a parity check via [parity-sync].

### Step 6 — Verification gate
**Mandatory** per CLAUDE.md. The PR body must name the automated proof:
- E2E section number from the 25-section suite.
- `backend/src/__tests__/wix*.test.js` test that covers the regression.
- Signed-replay artifact name and result.
- Or: lab harness run with captured output.

If none of those apply, prefix the PR title with `[unverified]` and require explicit owner sign-off.

### Step 7 — Summaries
Inbound or outbound, the change crosses architectural surfaces (orderService, product mapping, webhook signature, image upload). Write the technical [dev-summary] for Oliwer; if the fix changes anything she'd see on her phone or dashboard (e.g. "Available Today" now syncs correctly), also write the [owner-summary] in plain language.

## Known-pitfall match (from CLAUDE.md and recent history)

| Symptom | Likely seam | Lesson |
|---|---|---|
| "Order from Wix didn't appear" | webhook signature OR route 4xx | Check `[WIX]` logs first; signature secret may have rotated. |
| "Product changed in dashboard, Wix unchanged" | push queue stuck | `SELECT * FROM wix_push_queue WHERE status != 'done' ORDER BY created_at DESC LIMIT 20` |
| "Available Today empty on wix.com" | `leadTimeDays` not zeroed | Fix `productService.js` derive logic, not the carousel. |
| "Image upload broken" | `wixMediaClient.js` token or MIME | Check OAuth refresh and image MIME validation. |
| "Customer linked to wrong record" | `orderService.createWixOrder` dedupe | Case-insensitive email match; verify with `audit_log`. |

## Red flags

| Thought | Reality |
|---|---|
| "I'll just fix it on prod, it's a one-liner" | The April cluster was five "one-liners". Use the lab harness. |
| "Logs show no error" | Silent catches were Pitfall #5. Read the actual code path, not just the log. |
| "I'll skip the verification gate, it's small" | Then the PR title gets `[unverified]` and owner must sign off. No exceptions. |
| "Wix API changed, I'll match their docs" | Run via Context7 to fetch live Wix docs; training data lags. |
| "Tests pass" | Wix tests can mock past the failing seam. Replay the captured payload. |

## Related

- [owner-bug-intake] — Phase 0 sweep, run first.
- [diagnose] — disciplined diagnosis if the seam is non-obvious.
- [pre-pr-matrix] — verification-gate execution.
- [parity-sync] — when the fix changes a tag-derived field, both sides of the apps may need updates.
- `lab/WORKFLOW.md` — the signed-replay harness this skill leans on.
