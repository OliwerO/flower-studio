# Airtable → Postgres Migration — Session Consolidation (2026-04-17)

Durable record of a strategic planning session. This is the source of truth for the migration plan until the next consolidation session supersedes it.

---

## The core decision

Migrate off Airtable entirely. Replace it with a **Postgres** database and an app that fully absorbs Airtable's role (operational + CRM). **No ongoing sync, no dual-write, no permanent parallelism.** Airtable gets retired, not partnered.

---

## Why we're doing this

- Airtable's 5 req/sec rate limit is throttling peak-day operations.
- No transactions → half-written orders, manual rollback code in `orderService.js` (~538 lines of compensating logic).
- No real joins → N+1 query patterns on every screen.
- No real constraints → field-name drift, orphaned linked records, silent bad writes.
- No dev/staging environment → all work happens against production Airtable.
- Airtable and the app have **diverged data models**: Universe A (historical CRM in Clients B2C) is hand-maintained; Universe B (app-era data) is written by the app. They only notionally overlap.

---

## The critical reframe from this session

The migration is **not** just "move schema A to store B." It's a **data consolidation project**: merge Universe A (manual historical CRM) and Universe B (app-written operational data) into one unified Postgres customer model, then retire Airtable.

This means:

- **No dual-link / sync worker.** The earlier proposal assumed Airtable was a read-only mirror of app data. It isn't — it holds data the app has never seen.
- **App must reach Airtable parity before retirement.** The Dashboard CRM becomes blocking work, not nice-to-have.
- **Dedup is a one-time cost.** Cheaper than an ongoing sync forever.

---

## Locked-in decisions

| Decision | What | Why |
|---|---|---|
| **Database engine** | Postgres | Best Claude integration (SQL fluency, introspection, MCP ecosystem); most mature; portable. |
| **ORM** | Drizzle | Lightweight, SQL-first, TypeScript-friendly, matches existing plain-JS style. |
| **Migration style** | Strangler Fig — one entity at a time, shadow-writes verifying equivalence for ~1 week per entity before cutover. | De-risks each phase; each step independently revertible. |
| **Final state** | Airtable fully retired. One source of truth. One database. No sync. | Simpler to operate long-term; eliminates "which side is right" debates. |
| **Universe A handling** | **Import** early as read-only reference data, don't **migrate** first. Dedup deferred until Phase 5 when both universes are in Postgres. | Migration and import are different things. Import is low-risk, low-commitment, answers "does Postgres work for CRM reads?" cheaply. |
| **"All data editable from the app"** | Formal requirement. Every field on every record reachable through a clear UI path — standard list/detail for routine cases, Admin-mode raw-edit panel (owner-only, gated) for rare cases. Backed by audit log + soft delete. | Replaces Airtable's genuine escape-hatch advantage. Prevents "developer-ticket for every rare fix" pattern. |
| **Scope guardrail** | Don't build Airtable's grid editor inside the app. List + detail + Admin mode is sufficient. | Prevents a classic 6-month rabbit hole. |
| **Infrastructure-first phase (2.5)** | Build audit log + soft delete + Admin-mode scaffolding **before** migrating any entity. | Every entity then inherits them automatically; adding later per-entity is 3–5× more work. |
| **Critical-path order** | CRM UI work runs *before* data migration. Dashboard CRM MVP (reading from Airtable) gets built first, then data moves underneath it. | Proves the app can replace Airtable before burning the bridge. |
| **Parallelism** | Bug fixes (Phase 0) and CRM MVP (Phase 2) work in parallel — they don't touch the same code paths. | Buys weeks of calendar time without adding risk. |
| **Backup discipline** | Secondary nightly `pg_dump` to an independent location (Dropbox or S3), regardless of provider. | Disaster recovery; vendor-independent. Never trust a single vendor with the only copy. |
| **Claude integration** | Read-only DB role for AI sessions. Writes always go through the app. Never direct DB writes from an AI session. | Non-negotiable guardrail; keeps the app as the single write authority. |

---

## Open / still-to-decide

- **DB provider** — Railway Postgres vs. Supabase vs. alternatives. Deferred pending further investigation. Claude-introspection / log-access capability is a major consideration; so is keeping the vendor count low. **Not locked in.**

---

## Revised phase sequence

| # | Block | What |
|---|---|---|
| 0 | **Stabilize** | Fix Tier 1+2 owner-feedback bugs on Airtable. Finish Wix webhook cutover. |
| 1 | **Schema & DB infra** | Choose provider, provision Postgres in EU, write Drizzle schema, migrations in git. |
| 2 | **Dashboard CRM MVP** (reads from Airtable) | Customer list, search, detail, order history, notes, export, editable fields. Behind a `customerRepo` interface so backing store can swap. |
| 2.5 | **Cross-cutting infra** | Admin-mode raw-edit panel + audit log + soft delete, as reusable primitives. |
| 3 | **Stock → Postgres** | First real migration. Lowest-risk entity. Proves pipeline. |
| 4 | **Orders + Deliveries → Postgres** | Biggest rate-limit pressure retired. |
| 5 | **Customer consolidation + dedup** | Universe A + B merged in Postgres. Assisted dedup tool. Dashboard CRM switches backing store. |
| 6 | **Config + misc tables → Postgres** | Florist hours, marketing spend, logs, etc. Each gets a full edit UI. |
| 7 | **Retire Airtable** | Final snapshot, cancel subscription, delete `airtable.js` + `airtableSchema.js` + `config/airtable.js`. |

---

## Known risks under watch

- **Dedup complexity** — same person, different records. Mitigation: assisted dedup tool in Phase 5 (high-confidence auto-merge + owner review for ambiguous pairs + merge audit log).
- **Universe A data quality** — unknown until profiled. Phase-5 precursor: one-off data profiling script.
- **Owner-habit transfer** — if Dashboard CRM misses workflows she relies on, retirement is blocked. Mitigated by **Move 1** (below).
- **Repository discipline** — CRM UI built against Airtable then rewired to Postgres must not leak storage details into UI. Enforce the repository pattern from day one.
- **Export fidelity** — accountant-facing exports must match today's Airtable output format.
- **Historical order attribution** — orders from Universe A must attach to the right (merged) customer in Postgres. Customers imported first, then orders link to them.
- **Large customer lists** — if Universe A is 3,000+ rows, virtualize the list (`react-window`) from the start.

---

# Move 1 — Owner Airtable Walkthrough Checklist

## Purpose

Before committing to build the Dashboard CRM replacement, observe what the owner *actually* does in Airtable today, so the parity bar for retirement is based on real behavior, not assumptions.

## Format

Screen-share session with the owner, 45–60 minutes. She drives; you observe and ask. **Record the screen** if possible — real-time observation misses ~30% of detail.

## Framing to share at the start

> *"I'm not asking you to design the new system. I want to watch you do what you normally do in Airtable — click by click — and I'll take notes on what we need to keep. If something annoys you today, also tell me. We want to rebuild what works and skip what doesn't."*

This is a **time-study observation**, not a requirements interview. Observation reveals workflows interviews miss — especially habitual moves like "always sort by date descending before I scroll."

## How to use the checklist

- Don't read it to her like a script. Keep it as a prompt list.
- Let her open Airtable and do "whatever you'd normally do first thing in the morning." Watch silently for 5–10 minutes, then start asking.
- For each action, note: **what table, what action, what fields she looks at, what she does next, how often, does she save the result anywhere.**
- When she does something habitual ("I always click here first"), ask why. The reason matters more than the click.

---

### Section 1 — First-thing-in-the-morning ritual

*Goal: capture her habitual entry point.*

- [ ] Which table or view does she open first?
- [ ] What does she look for on that first screen? (Counts? Fresh entries? Today's deliveries?)
- [ ] Does she have filters pre-applied or does she apply them manually?
- [ ] How does she decide "everything's fine, move on" vs. "something needs attention"?
- [ ] Are there tabs she keeps permanently open?

### Section 2 — Customer browsing (the CRM heart)

*Goal: understand how she explores customer data.*

- [ ] How does she find a specific customer? (Search? Scroll? Filter by city?)
- [ ] When looking at one customer, what fields does she care about most?
- [ ] What tells her "this is a VIP" or "this is a problem customer"?
- [ ] Which order fields does she look at — frequency, last-order-date, total spent, items, notes?
- [ ] Does she group or sort customers? By what? How often?
- [ ] Does she ever tag, flag, or categorize customers? With what values?
- [ ] Does she make notes on customers? Where, and are those notes structured or free text?
- [ ] How does she handle the same customer appearing twice? (Dedup question — observe, don't explain.)

### Section 3 — Saved views and filters

*Goal: capture views as first-class requirements.*

- [ ] List every saved view she actually uses (ignore ones she created once and forgot).
- [ ] For each view: filter, sort, grouping, visible columns?
- [ ] Which view is she in most of the time?
- [ ] Are any views shared with other people (accountant, florist, driver)?
- [ ] Does she ever build a temporary filter on the fly? For what kind of question?

### Section 4 — Exports and external use

*Goal: identify who consumes Airtable data and how.*

- [ ] Does she export to Excel/CSV? Which view, how often, for whom?
- [ ] Does the accountant get a file? What's in it, what format, what cadence?
- [ ] Does anyone else (bank, supplier, tax authority) receive Airtable-derived data?
- [ ] Are there printouts or PDFs she generates from Airtable?
- [ ] Does she share Airtable links with people outside the business? Who, and what do they see?

### Section 5 — Editing habits

*Goal: catalog every kind of edit, especially the rare ones.*

- [ ] What does she edit daily? (Probably: orders, stock.)
- [ ] What does she edit weekly? (Probably: customer notes, configuration.)
- [ ] What does she edit *rarely but critically*? (Fixing typos, correcting historical data, merging duplicates, changing a customer's name after a marriage — these are the Admin-mode cases.)
- [ ] Has she ever bulk-edited? What, and why?
- [ ] Has she ever wished she could edit something but couldn't? (The answer "no" almost certainly means she worked around it — probe.)
- [ ] When a record is wrong, how does she figure out what it should be? (Other records? Memory? Calling the customer?)

### Section 6 — Linked records and relationships

*Goal: understand how she navigates between entities.*

- [ ] When looking at a customer, how does she jump to their orders?
- [ ] When looking at an order, does she jump to the customer, delivery, stock items?
- [ ] Does she ever follow a chain three deep — customer → order → stock items used?
- [ ] Are there entity relationships she *wishes* were easier to follow?

### Section 7 — Automations and formulas she relies on

*Goal: inventory Airtable features the app must replicate in the backend.*

- [ ] Are there formula fields she reads routinely? (Calculated totals, status summaries, date differences.) Write down each formula.
- [ ] Are there Airtable automations running? (Emails, Slack messages, status changes.) What triggers them, what do they do?
- [ ] Are there rollup or count fields she uses? (Customer's lifetime order count, total spent.)
- [ ] Does she rely on any integration (Zapier, webhook, Airtable's own tools)?

### Section 8 — Pain points and workarounds

*Goal: things to **not** replicate, and things to fix while we're at it.*

- [ ] What in Airtable annoys her daily?
- [ ] What does she wish it did?
- [ ] What does she currently do in Excel or on paper that she wishes was in the app?
- [ ] Which Airtable fields are stale, unused, or confusing?
- [ ] Are there tables she's afraid to touch because she doesn't know what they do?

### Section 9 — The "one weird thing" question

*Goal: catch the non-obvious.*

- [ ] Is there anything she does in Airtable that no one else would think to ask about?
- [ ] Is there a "trick" she's found that makes her day easier?
- [ ] Is there data in Airtable that exists only in her head otherwise?

### Section 10 — External-facing workflows

*Goal: make sure we don't break non-owner consumers.*

- [ ] Do florists or drivers ever look at Airtable directly? What for?
- [ ] Does anyone else have edit access? What do they edit?
- [ ] Is Airtable data ever referenced in communications with customers?

---

## After the walkthrough — synthesis step

Within 24 hours while it's fresh, do this yourself (don't send raw notes to the owner):

1. **Classify each observed behavior** into one of four buckets:
   - **Must-have for CRM MVP** (Phase 2) — blocks retirement if missing.
   - **Must-have eventually** (Phases 3–6) — but not in the MVP.
   - **Admin-mode territory** — rare edits, maintenance, corrections.
   - **Drop** — she does it out of habit but doesn't need to.

2. **Draft the Dashboard CRM MVP feature list** from the must-haves. This becomes Phase 2's concrete scope.

3. **Draft the Admin-mode requirements list.** These become Phase 2.5's scope.

4. **Draft the export spec** — exact columns, format, cadence, recipient — from Section 4.

5. **List open questions** (keep under 10 — batch-ask her once).

6. **Send her back a short summary** (not the raw notes) — "Here's what I saw you do, here's what we'll rebuild, here's what we'll skip. Let me know if I missed anything." Gives her a chance to correct interpretation before building.

## What "done" looks like for Move 1

- **Parity checklist** — capabilities the Dashboard CRM MVP must have before retirement.
- **View spec** — all saved views translated into filter+sort+column specs.
- **Export spec** — exact format of every external-facing file.
- **Admin-mode scope** — list of rare-edit cases the raw-edit panel must cover.
- **Formula/automation inventory** — what the backend has to replicate.
- **"Drop list"** — things we deliberately will not rebuild.

With this in hand, Phase 1 (Schema) and Phase 2 (Dashboard CRM MVP) can both be scoped and committed to with realistic time estimates.

---

## Next session should

- Bring raw walkthrough notes back and do the synthesis together.
- Revisit the DB-provider decision with any new information (latency test results, Supabase MCP trial, etc.).
- Kick off the Phase 1 Drizzle schema draft based on parity-checklist findings.
