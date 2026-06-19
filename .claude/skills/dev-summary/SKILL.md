---
name: dev-summary
description: Write a technical change summary for Oliwer (the dev/admin who maintains flower-studio) — concrete file paths, line refs, architectural neighbors, and what to watch for. Four sections (What changed / Why / How it connects / What to watch for). Use after completing a logical unit of work, before opening a PR, when Oliwer asks for "a dev summary", "explain what you did", or at any natural pause point. For the non-technical owner-facing version, use [owner-summary] instead.
---

# Dev Summary (for Oliwer)

Oliwer (the dev) approves and ships Claude's work and needs to keep a current mental model of the codebase. He reads diffs but at scale: a structured summary is the fast path to "got it, ship" vs. having to reverse-engineer the change from the diff later.

This skill writes the *technical* change summary. It is the artifact Oliwer pastes into PR descriptions, refers back to during code review, and uses to brief future sessions. For the non-technical, owner-facing version (what the *business owner* sees in her day), use [owner-summary].

## Quick start

Write one short markdown block in this exact shape:

```md
### <one-line title — e.g. "Lead Time Days auto-zeros when 'Available Today' tag added">

**What changed**
- `backend/src/services/productService.js:148` — set `leadTimeDays = 0` whenever `tags` includes `"available-today"`.
- `apps/dashboard/src/components/ProductDetailPanel.jsx:212` — UI now disables the lead-time input when the tag is present.
- Tests: `backend/src/__tests__/productService.test.js:402` covers the new branch.

**Why**
Hand-zeroing the field was a recurring foot-gun: the tag and the field could disagree, which kept tagged bouquets out of the Wix "Available Today" carousel. The field is fully derivable from the tag — there is no scenario where they should disagree.

**How it connects**
The "Available Today" carousel on `wix.com/blossom` is gated by Wix's `leadTime <= 0` filter (configured in `backend/src/services/wix.js:product mapping`). The tag is the human signal; the field is the machine signal — this PR closes the gap. No schema change, no migration; existing products are not retroactively zeroed.

**What to watch for**
- A tagged product with a deliberate non-zero lead time (edge case: pre-order tagged early) is now forbidden in the UI — intentional but worth knowing.
- The Wix push job still respects whatever value is on the row at push time; existing rows keep their current lead time until next save.
```

## The four sections — non-negotiable

### 1. What changed
- Bullets, one per modified file or logical area.
- Every bullet includes a `path:line` reference. No "we updated some files" prose.
- Group tests on their own line if they grew.

### 2. Why
- The problem this solves, in one tight paragraph.
- Tie back to a concrete failure mode (past incident, Known Pitfall, observed drift).
- No "implemented X" — say *why* X is correct.

### 3. How it connects
- Map the change into the architecture Oliwer already knows.
- Name the upstream/downstream surfaces (Wix push, SSE event, status cascade, parity-paired sites, repo seams).
- Call out schema changes, migrations, env vars. If none, say "no schema change, no migration."

### 4. What to watch for
- Trade-offs you made, even small ones.
- Edge cases that are *intentionally* not handled.
- What would surprise a future session if it were not stated.
- If there's nothing real here, write "None — boring change." Do not pad.

## Workflow

1. **After each logical step** — not just end of session, not just at PR. CLAUDE.md is explicit: after each step.
2. Collect the diff: `git diff --stat` and `git diff` for the lines you'll cite.
3. Walk through the four sections in order; do not skip and come back.
4. Cite paths and lines from the current state, not from memory.
5. If the change touches a parity-paired surface, mention both sides in "What changed."
6. If the change touches a Known Pitfall from CLAUDE.md, name the pitfall number — proof you considered it.
7. Keep the whole block under ~30 lines. If it sprawls, the change was too big — split the PR.
8. If the change has any **owner-visible effect** (UI behavior, daily-workflow impact, new option, removed option, anything she'd notice on her phone), follow up with [owner-summary] for her version.

## Hard rules

- **Concrete over abstract.** "Refactored stock math" is forbidden. "Replaced `qty - committed` with `getEffectiveStock(qty)` in `StockItem.jsx:71`" is required.
- **No marketing.** No "robust", "comprehensive", "seamless", "production-ready". Just facts.
- **No future tense.** Describe what *is* now, not what *will be*. "Tomorrow we will" goes in the PR description, not the summary.
- **No comparison to past Claude work.** Owner doesn't care which session produced the prior version.
- **Build the mental model.** Each summary should leave Oliwer slightly more capable of judging the next change without re-reading the diff.

## Red flags

| Thought | Reality |
|---|---|
| "I'll write the summary at PR time" | CLAUDE.md says after each step. Write it now. |
| "Oliwer just needs the headline" | The headline goes in the title — the four sections still owe their content. |
| "Tests pass — that's the summary" | Tests are evidence, not narrative. Write the narrative. |
| "It's a small change, skip the connect section" | Even small changes have an architectural neighbor. Name it. |
| "Watch-for is empty" | Then write "None — boring change." Do not omit the section. |
| "This is for the owner" | No — `dev-summary` is for Oliwer. The owner-facing version is `owner-summary` and has different sections. |

## Related

- [owner-summary] — non-technical companion for the business owner; written alongside this one whenever the change is owner-visible.
- [pre-pr-matrix] — the verification this summary's "What changed" should rest on.
- [resume-plan] — when summarising at pause, also update the in-progress memory.
- [parity-sync] — when the change crosses apps, mention both sides in section 1.
