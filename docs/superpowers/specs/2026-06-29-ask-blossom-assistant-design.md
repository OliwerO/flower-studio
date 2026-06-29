# Ask Blossom — Natural-Language Analytics Assistant (Design)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation plan
**Author:** Oliwer + Claude (brainstorming session)

## Summary

An interactive, conversational interface that lets the **Owner** ask
natural-language questions about the business ("orders placed in May",
"how does that break down by delivery vs pickup", "how much revenue did
I do") and get correct answers — with optional follow-up questions in the
same conversation.

**Core constraint (non-negotiable):** the interface is LLM-driven, but
**data retrieval is programmatic**. The model never writes SQL and never
touches the database. It chooses from a fixed menu of typed, tested query
functions ("tools"); those functions are the only thing that reads data,
and they delegate to the canonical service/repo layer the dashboards
already use. Programmatic dashboards (FinancialTab etc.) remain the
**primary** data surface; this assistant supplements them.

## Decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | v1 data scope | **C — whole business**: orders, finance, deliveries, stock, purchasing, customers, hours. Built as independently-testable packs, tracer-bullet order. |
| 2 | Role access | **B — Owner-only**. Whole assistant gated to the Owner PIN; florists don't get it. No per-tool role gating needed. |
| 3 | Placement | **B — Dashboard + Florist app**, via a single shared component in `packages/shared`, Owner-PIN-gated in each. (Owner uses dashboard on desktop, florist app on phone.) |
| 4 | Model | **C — configurable env var, default Sonnet 4.6**. Stronger tool selection + multi-step reasoning; owner-only = negligible volume so cost is a non-issue. |
| 5 | Answer format | **A now, B-ready later**. v1 renders the model's **markdown** (it formats its own tables). API also returns the **raw structured tool results** so rich UI tables/charts (B) become a frontend-only addition with zero backend rework. |

### Folded-in defaults (low-stakes)
- **Read-only**: assistant gets only read tools; it can never mutate data. Hard boundary.
- **Date grounding**: today's date (Europe/Warsaw) injected into the system prompt so "May" / "last month" resolve correctly.
- **No fabrication**: system prompt forbids inventing numbers — every figure must come from a tool result, else the assistant says it can't answer.
- **Session memory**: in-memory multi-turn (mirrors `feedbackService`), ephemeral, TTL eviction. No saved cross-session history in v1.
- **Wait-then-show** (no token streaming in v1).
- **Answer language mirrors the question** (Russian default).

## Existing infrastructure this builds on

The canonical query + aggregation logic **already lives in the service/repo
layer**; routes only compose it. A single source of truth largely already
exists, which is what makes this feature safe:

- **AI infra** — `@anthropic-ai/sdk ^0.78.0`, `new Anthropic()` reads
  `ANTHROPIC_API_KEY` (`backend/src/services/intake-parser.js`).
  Multi-turn + in-memory session precedent in
  `backend/src/services/feedbackService.js`. (Existing calls use
  `claude-haiku-4-5-20251001`; this feature defaults to Sonnet, configurable.)
- **Orders** — `orderRepo.list()` (`backend/src/repos/orderRepo.js`):
  filters by order-date range, delivery-date range, status, deliveryType,
  source, paymentStatus, paymentMethod, customer. The one filtered-query surface.
- **Finance** — `backend/src/routes/analytics.js` (`GET /api/analytics?from&to`)
  composing pure functions in `backend/src/services/analyticsService.js`
  (revenue, costs, margins, AOV, delivery vs pickup, source/payment breakdowns,
  top products, monthly trend, customers).
- **Stock** — `stockRepo.listGroupedByVariety` +
  `packages/shared/utils/stockMath.getEffectiveStock`. **Y-model-aware**:
  `STOCK_Y_MODEL` is read *inside* the repo; callers just call it and get
  model-correct data.
- **SSE** — `backend/src/routes/events.js` exists for operational push (not
  used for AI streaming in v1).
- **No chat UI exists** in any of the three apps — clean slate.

## Architecture & data flow

```
Owner types question (shared AskBlossomPanel — dashboard + florist app, Owner-PIN-gated)
  → POST /api/assistant/message  { sessionId?, message }   [requireOwner]
  → assistantService: tool-use loop with Sonnet (configurable), iteration cap ~6
       model picks tool + args
         → handler runs REAL query via canonical repos/analyticsService
         → structured JSON back to model
         → (model may chain more tools)
         → final markdown answer
  → response { sessionId, answer (markdown), toolResults (structured — for future B) }
  → AskBlossomPanel renders markdown
```

The model **never writes SQL** and **never sees the DB**. It only picks from
a fixed menu of typed query functions. Those functions are plain, tested code.

## Components

### 1. Tool library — registry-based thin adapters (the bulk of the work)

Each domain is a **self-contained pack module** exporting
`{ name, description, inputSchema, handler }`. A central **registry** array
aggregates them. The agent loop builds *both* its tool list *and* the
system-prompt tool catalog **from the registry**.

> **Extensibility seam:** adding a domain (e.g. future "tech stock", a new
> finance insight) = **add one pack file + register it**. Nothing in the core
> loop or prompt changes.

> **Thin-adapter rule (load-bearing):** a handler may *only* call canonical
> services/repos and shape their output for the model. It **must not** contain
> business logic, its own SQL, or its own aggregation. Consequence: when the
> domain changes underneath (Y-model on, new column, new metric), the tool
> inherits it automatically — it's the same code path as the dashboards. The
> assistant never reads `STOCK_Y_MODEL` itself.

**Packs (each independently testable):**
- **orders** — `queryOrders({ dateField, from, to, status?, deliveryType?, source?, paymentStatus?, paymentMethod?, customerId? })` → count + capped list + totals (wraps `orderRepo.list()`); `breakdownOrders({ dimension, from, to })` → grouped counts/sums (answers "break down by delivery/pickup/source/payment/status/month").
- **finance** — `financialSummary({ from, to })` → wraps the existing `/api/analytics` computation (revenue, margins, AOV, costs, waste).
- **deliveries** — outcomes, failed-attempt counts, by driver.
- **stock** — current levels by Variety, low/negative stock, write-offs in range. Uses `stockRepo.listGroupedByVariety` + `getEffectiveStock` (Y-model-correct by delegation).
- **purchasing** — Stock Orders by status / range.
- **customers** — new vs returning, top spenders, lookup by name, key dates.
- **hours** — Florist Hours / payroll in range.

**Build order (tracer-bullet vertical slices):** **orders + finance first**
(proves the whole loop end-to-end with the owner's exact examples), then
deliveries → stock → purchasing → customers → hours. Each slice = its tools +
tests, shippable alone.

### 2. Backend
- `backend/src/services/assistantService.js` — the tool-use loop (iteration cap ~6 to bound cost; max_tokens cap).
- `backend/src/services/assistantTools/` — one file per pack + an `index.js` registry.
- `backend/src/routes/assistant.js` — `POST /api/assistant/message`, behind `requireOwner` middleware.
- Sessions in-memory (`sessionId → message history`), TTL eviction (mirrors `feedbackService`).

### 3. Frontend
- `packages/shared/components/AskBlossomPanel.jsx` — message list + input + markdown render.
- Mounted in **dashboard** (near FinancialTab) and **florist app**, both Owner-PIN-gated.
- Russian UI via `t.xxx`; per-app `translations.js` define the new keys.

## Accuracy & security guardrails
- **Owner-PIN gate** (route middleware) — structural, not prompt-based.
- **Read-only tools only** — no mutation handler exists.
- **Date-grounded** system prompt (Europe/Warsaw "today").
- **No-fabrication** rule — every number traceable to a tool result.
- **Iteration + token caps** — bound cost and runaway loops.
- Model **never** receives raw DB access or SQL capability.

## Correctness & maintainability under change

- **Single source of truth = correct by construction.** Because tools delegate
  to canonical services, the assistant's numbers *are* the dashboard's numbers
  — no second implementation to drift. (CLAUDE.md pitfall #8 — stock math
  drifting across two files — is the "two implementations disagree" bug; the
  thin-adapter rule prevents the assistant becoming a *third* drift site.)
- **Contract tests per tool** against pglite / lab-factory fixtures: known input
  → known output, in CI. A schema/flag/metric change that breaks a tool's shape
  fails loudly. Plugs into the existing lab harness.
- **Parity tests** for any metric that *also* appears on a dashboard: assert
  `tool(input) === existing-endpoint(input)` for the same inputs. Pins the
  assistant to the surface already trusted; edit one side only and CI fails.
  **This is the guarantee that insights are correct — pinned, not recomputed.**
- **Golden eval set** (~15–20 NL questions → expected tool + answer shape): run
  on demand with a mocked/recorded model to catch the agent silently picking the
  *wrong* tool after a prompt/description edit. The "did extending break tool
  selection?" guard.

### Broader architecture note
The assistant is a **forcing function** for good architecture: it can only
reuse logic that already lives in a callable service. Where logic is still
stuck in a route or component, the assistant can't wrap it — so **v1 only
exposes capabilities that already have a canonical function, and logs the
gaps.** A domain whose logic is scattered is an `/audit <domain>` job
(consolidate into a deep service) *before* wrapping it as a tool — out of
assistant scope, but the assistant reveals where it's needed.

## Testing

- **Tool handlers** — unit-tested against pglite/lab fixtures. The data-accuracy gate.
- **Parity tests** — tool vs existing endpoint for shared metrics (see above).
- **Agent loop** — tested with a **mocked** Anthropic client (no real network, per CLAUDE.md): right tool dispatched for canned questions, multi-turn continuation, iteration cap honored.
- **Shared component** — jsdom test (render, send, render answer).
- **Golden eval set** — manual/on-demand confidence run.

## Out of scope for v1 (extensible later)
- Charts-in-chat (the "B" answer format) — backend already returns structured results, so this is frontend-only later.
- Saved cross-session conversation history.
- Token streaming (SSE).
- Any write/action ("create an order", "mark paid").
- Non-owner roles (florist/driver access).

## Open questions / to confirm at plan time
- Exact env var name + default model id string (e.g. `ASSISTANT_MODEL`, default `claude-sonnet-4-6`).
- List-result cap size for `queryOrders` (avoid dumping hundreds of rows into the model context).
- Whether the florist-app mount is in the same slice as dashboard or a fast-follow.
