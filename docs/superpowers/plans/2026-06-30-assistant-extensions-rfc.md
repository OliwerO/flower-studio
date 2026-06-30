# Ask Blossom — Extensions RFC (connect-the-dots, open-ended, reporting)

**Date:** 2026-06-30 · **Branch:** `feat/assistant-extensions` · **Status:** RFC + skeleton (not wired live)

Goal: evolve Ask Blossom from "answers the questions a tool exists for" into **a flexible,
smart interface to the database the owner builds with every order** — able to connect the
dots across entities, search free text, and let her report problems without leaving the chat.

## What's shipped in this branch (real, tested)

1. **Iteration cap 6 → 12** (`ASSISTANT_MAX_ITERATIONS` env-overridable). Multi-tool
   "connect the dots" answers need several round-trips; 6 was too low and produced the
   Russian fallback on complex questions.
2. **Graceful no-coverage prompt.** When no tool fits, the assistant now (a) says plainly
   it has no dedicated tool, then (b) gives a best-effort interpretation built only on
   real tool figures, clearly labelled as inference — and is told to combine multiple
   tools to connect the dots. (The never-invent-numbers rule is preserved.)

## Skeletons in this branch (inert — not in the tool registry)

- `assistantTools/dataQueryPack.js` — flexible structured-query tool (`query_records`) + a
  `orders_needing_short_stock` composite quick-win.
- `assistantTools/freeTextPack.js` — open-ended free-text search (`search_text`).
- `assistantTools/reportPack.js` — `report_issue` handoff to feedbackService.

Each `throw`s "not implemented (skeleton)" so it can't be used until built. None are
imported into `index.js`, so runtime is unaffected.

---

## Thread 1 — Connect the dots (the big one)

**Problem:** the dashboard filters one entity at a time. The owner wants questions like
"orders due this week, still unpaid, for VIP customers, that need a flower I'm short on."
No fixed tool expresses that.

**Three options:**

| Option | Flexibility | Safety | Effort |
|---|---|---|---|
| A. Composite tools (one per question) | Low — only what we anticipate | High | Low each, unbounded total |
| **B. Structured-query tool (`query_records`)** | **High — any allow-listed filter/join/aggregate** | **High — model emits a validated spec, never SQL** | **Medium (build the validator + executor once)** |
| C. Read-only SQL tool | Highest | **Low — a bad query returns wrong-but-plausible numbers** | Low |

**Recommendation: B**, with one or two **A** composites as quick wins while B is built.
B keeps the assistant's core guarantee (numbers can't be silently wrong) because the model
picks from a fixed vocabulary of entities/fields/ops/joins; the backend validates against
an allow-list and runs a parameterized, read-only, row-capped, timed query. Unknown field →
rejected, not guessed. **C is explicitly rejected** — it throws away the trustworthiness
that makes this assistant better than RAG.

**Build order for B:** allow-list SCHEMA (entities the owner should query) → `validateSpec`
→ Drizzle query builder (filters → ops, predefined joins, group/aggregate) → row cap +
statement timeout → parity test (a `query_records` spec must equal the equivalent existing
tool's numbers) + a golden question. Then register in `index.js` with a description that
tells the model to prefer the dedicated tools and reach for `query_records` only when none fit.

**Open decision:** confirm Option B (vs. just shipping a handful of A composites). I lean B.

---

## Thread 2 — Open-ended / free-text (the RAG-shaped part)

**Problem:** questions over prose the owner typed — card messages, customer requests,
florist/driver notes. Structured tools can't model text.

**Plan:** `freeTextPack.search_text`. **Phase 1** = Postgres ILIKE / full-text over an
allow-listed set of text columns; returns snippet + link (no new infra). **Phase 2
(optional)** = pgvector embeddings for semantic search — true RAG — only if keyword search
proves too literal. This is exactly the "hybrid: agent for numbers + RAG for free text"
idea from the earlier discussion.

**Open decision:** Phase 1 keyword first (recommended), or go straight to embeddings?

---

## Thread 3 — Reporting inside the assistant (Haiku + screenshot + codebase)

**Good news:** `feedbackService` **already runs on Claude Haiku** (`claude-haiku-4-5`) and
already asks one question at a time, stopping once it has enough — so "use Haiku" and "only
ask if it can't infer" are largely already true. Gaps vs. the request:

1. **Screenshot is attached to the issue but the model never SEES it** (no vision). Fix:
   pass the screenshot as an image content block to `callAI` so Haiku reads the UI and
   infers the screen/state instead of asking. Low effort, high value.
2. **No codebase context.** "Pass the codebase" to Haiku is **not feasible** (context size +
   cost). Options:
   - (a) **Per-area context pack** — a static map `appArea → key files/summary`, passed in.
     Cheap, deterministic, recommended first.
   - (b) **Repo-map** — file tree + symbol signatures (one generated artifact). Medium.
   - (c) **Code-RAG** — embed the repo, retrieve files relevant to the report. Most flexible,
     most infra. (Note: this is RAG again — for code this time.)
3. **One entry point.** The owner prefers reporting "in one" place. Two ways:
   - (A) in-chat `report_issue` tool — but the chat can't capture a screenshot easily.
   - (B) **a "Report a problem" button inside `AskBlossomPanel`** that opens the existing
     `FeedbackModal` (which already screenshots). Simplest, keeps the proven capture flow,
     still one place. **Recommended first step**; the in-chat tool can follow.

**Open decisions:** (1) add vision to feedbackService — yes? (2) codebase context = (a)/(b)/(c)?
(3) reporting entry = button-in-panel (B) or in-chat tool (A)?

---

## Thread 4 — Cap + graceful coverage

Done in this branch (see top). No further decision.

---

## Sequencing proposal

1. **Ship now** (this branch): cap bump + graceful-coverage prompt. Pure win, low risk.
2. **Next PR:** `search_text` Phase 1 (open-ended) — small, high owner delight.
3. **Next PR:** reporting button-in-panel (B) + vision in feedbackService — bundles reporting
   into the assistant, makes reports self-describing from the screenshot.
4. **Bigger PR:** `query_records` (Option B) — the strategic connect-the-dots layer, with the
   `orders_needing_short_stock` composite shipped first as an appetizer.

## Decisions (locked 2026-06-30, owner)
- **Connect-the-dots:** structured-query tool (Option B). ✅
- **Free-text:** keyword (Phase 1) now; semantic/embeddings as a fast-follow quality upgrade
  (cheap — small corpus, embeddings are a separate non-LLM endpoint, add ~0 assistant tokens).
- **Reporting entry:** button in the assistant panel that opens the existing screenshot flow. ✅
- **Report codebase context:** per-area context pack **and** code-RAG. Per-area pack + screenshot
  vision ship with the reporting task; **code-RAG + auto-refresh-on-code-change is split into its
  own issue** (#457) but the context-provider seam is designed so RAG plugs in without rework.

## Cost & model (owner raised token cost)
- **Do NOT power the assistant via `claude -p` (subscription).** Per-query CLI spawn + harness boot
  is too slow for a simple question, isn't built for server concurrency, and subscription auth isn't
  the supported path for serving app users. Keep the Anthropic API.
- **Prompt caching (high ROI, easy):** the system prompt + 20 tool defs are large + identical every
  turn → mark cacheable (`cache_control`) to cut repeat input cost ~90%. Do this on the live assistant.
- **Model routing:** Haiku for simple/single-tool questions, Sonnet for hard multi-tool reasoning
  (`ASSISTANT_MODEL` already exists). With caching + Haiku-default, monthly cost for one owner is a few $.
- **Embeddings cost (if/when semantic free-text):** separate cheap endpoint, not Sonnet/Haiku tokens;
  small corpus → negligible.

## Sequencing (updated)
1. **Shipped (this branch):** cap bump + graceful coverage.
2. **Cost PR (do next, applies to live assistant):** prompt caching + optional Haiku-for-simple routing.
3. **Reporting PR:** button-in-panel + screenshot vision + per-area context pack (seam for code-RAG).
4. **Free-text PR:** `search_text` keyword Phase 1.
5. **Connect-the-dots PR:** `query_records` (Option B), `orders_needing_short_stock` composite first.
6. **Separate issue:** code-RAG index + scheduled auto-refresh on code change (feeds the report assistant; could later also power a code-aware dev assistant).
