# Ask Blossom — Insight Tools + Correctness System

**Date:** 2026-06-29
**Branch:** `feat/assistant-insight-tools`
**Author:** autonomous overnight build (ultracode)
**Status:** in build

## Goal

Make Ask Blossom (the owner-only NL analytics assistant, live since PR #441) materially
smarter and provably correct. The owner should be able to ask almost any question about her
business and get an on-point, data-grounded answer — and we should have automated systems
that guarantee those numbers are right.

## Problem (what the research found)

The assistant has 11 tools but surfaces only a sliver of what the backend already computes.
`analyticsService.computeAnalytics()` builds a rich report (top products + trend, day-of-week
rhythm, supplier scorecard, completion funnel, monthly seasonality, payment/debt analysis)
yet `financial_summary` exposes ~10% of it. Whole domains have **no** tool: marketing spend,
stock velocity, customer re-activation (lapsed customers, upcoming birthdays).

There is also no **correctness system** beyond a "never invent numbers" prompt line: no
period-resolution guard (the LLM resolves "May" → dates itself, a wrong year is invisible),
no end-to-end eval, and parity tests cover only the original packs.

## Design principles (unchanged from PR #441)

- **LLM picks tools; tools never write SQL.** Every tool is a read-only thin adapter over a
  canonical service/repo. Numbers can't drift because the tool calls the SAME function the
  dashboard route calls.
- **Parity by construction.** New tools that report money/counts pin to `computeAnalytics`
  or a repo; a parity test asserts tool output == canonical output.
- **Owner-only.** No new auth surface — all tools ride the existing owner-gated route.
- **Shared frontend.** One `AskBlossomPanel` change hits dashboard + florist (parity free).

## Highest-impact changes (the build)

### A. Unlock the iceberg (parity-pinned to `computeAnalytics`, ~zero risk)

| Tool | Surfaces | Owner question it answers |
|------|----------|---------------------------|
| `top_products` | `orders.topProducts` (name, qty, revenue, cost, trend vs prev period) | "What are my best sellers? What's declining?" |
| `sales_trends` | `monthly` (seasonality) + `weeklyRhythm` (busiest days) + `funnel` (completion/cancel rate) + `paymentAnalysis` (outstanding debt) | "Which day is busiest? How's the month trending? How many orders cancel? Who owes me money?" |
| `channel_efficiency` | `orders.sourceEfficiency` (per-source orderCount, AOV, margin%) | "Is Instagram actually more profitable than walk-ins after cost?" |
| `supplier_scorecard` | `supplierScorecard` (spend + waste% per supplier) | "Which supplier's stems rot the most? Where do I spend most?" |
| `compare_periods` | calls `computeAnalytics` twice, diffs revenue/orders/AOV/margin | "Is May better than April? vs last year?" |

`monthly` per-month `flowerRevenue` is gross catalog (known net/gross split, see
`project_revenue_net_flower_definition`); `sales_trends` drops that field and surfaces only
`revenue` (net total), `orderCount`, `flowerMarginPercent` to avoid confusion.

### B. New domains

| Tool | Source | Notes |
|------|--------|-------|
| `marketing_spend` | `marketingSpendRepo.list({from,to})` (`YYYY-MM`) | Spend by channel + total. Does **not** auto-compute ROAS — `channel` is free text, `Source` is an enum; only the model combines it with `financial_summary`/`channel_efficiency` and states the caveat. Marketing data is thin ("still in development") → degrade gracefully (empty → "no spend logged"). |
| `stock_velocity` | `orderRepo.getLinesForVelocity` + `stockRepo.list` join | Fastest/slowest movers, `avgDailyUsage`, `daysOfSupply`. Pitfall #8: `currentQty` as-is, `qty<0` = shortfall (no daysOfSupply). Y-model: when `STOCK_Y_MODEL` on, group by Variety not Batch. |

### C. Customer re-activation (top owner gaps #2/#3)

| Tool | Source | Notes |
|------|--------|-------|
| `lapsed_customers` | `customerRepo.list({withAggregates})` → filter `_agg.lastOrderDate` older than N days | "Who hasn't ordered in 60 days? I want to send a discount." |
| `upcoming_occasions` | NEW `customerRepo.listKeyPeopleWithDates()` + JS date math | "Whose birthday/anniversary is this week?" Next-occurrence of MM-DD within N days, year-boundary safe. |

Deferred (fast-follow, lower impact — owner manages in UI): `product_catalog`,
profit-after-labor P&L, demand forecasting.

### D. Correctness system (the explicit ask)

1. **Period-echo grounding (M1).** Every date tool returns `period:{from,to}`. (financePack,
   stockPack already do; add to orders, deliveries, purchasing, hours, all new tools.)
2. **System-prompt hardening (M2).** Add: state the resolved period back before narrating
   numbers ("For May 2026 (2026-05-01–2026-05-31): …"); disclose cancelled orders are
   excluded unless asked; `flowers` revenue is NET (`total = flowers + delivery`).
3. **Parity test battery.** One parity/contract test per new tool pinned to its canonical
   source; strengthen existing ones with explicit invariant assertions.
4. **Golden-questions eval** (`assistantTools.goldenQuestions.test.js`). Mock the LLM
   (established `vi.hoisted` pattern), force each tool call, assert: right tool dispatched +
   handler got sane params + output satisfies self-consistency invariants (breakdown sums ==
   total, byReason sums == totalQuantity, revenue.total == flowers+delivery, shortfall items
   all qty<0). Runs in CI, deterministic, exercises the full `ask()` loop.
5. **Live-smoke script** (`backend/scripts/assistant-live-smoke.js`, SAFE). Owner/dev runs it
   with a real key to verify tool *selection* quality on NL questions (mock can't test that).

### E. Frontend — starter-question chips

Replace the single empty-state line in `AskBlossomPanel.jsx` with a grid of tappable chips
from a new `t.assistantStarters` array (added to both dashboard + florist `translations.js`,
EN+RU). Showcases the new surface: orders today, revenue this month, top products, what's
low, busiest day, most valuable customers, marketing spend, who worked today. One shared
component → both apps.

## Build orchestration

Worktree: `.claude/worktrees/feat+assistant-insight-tools` (node_modules symlinked from root).

- **Phase 1 (parallel, Sonnet executors):** 6 pack agents, each writes ONLY its own pack +
  test file(s) (no shared-file edits → no collision). Each given exact field shapes + the
  existing pack/parity-test pattern to copy. Each runs its own test file to green.
- **Phase 2 (sequential, one agent):** wire all packs into `index.js` (descriptions for tool
  selection), add period-echo to existing date tools, harden `systemPrompt`, create golden
  eval + live-smoke. Single coherent touch of shared files.
- **Phase 3 (parallel):** frontend chips.
- **Phase 4 (self):** full pre-PR matrix — `cd backend && npx vitest run`; harness + e2e;
  shared vitest; build all 3 apps. Fix until green.
- **Phase 5 (self):** Opus whole-branch review → fix → docs (backend CLAUDE.md tool table,
  root CLAUDE.md if needed, CHANGELOG) + dev-summary + owner-summary → draft PR.

## Verification gate

Per CLAUDE.md pre-PR matrix (backend + shared touched): backend vitest, E2E suite (no new
API routes — assistant route unchanged, so E2E count should hold), shared vitest, three app
builds. New-tool correctness proven by parity + golden-question tests named in the PR body.

## Out of scope

Rich in-chat tables/charts from `toolResults`, token streaming, `product_catalog`, P&L /
profit-after-labor, demand forecasting — all noted as fast-follows.
