# Move 1 — Owner Airtable Walkthrough

**Session type:** Time-study observation (not a requirements interview).
**Duration:** 45–60 min screen share.
**Who drives:** Owner. Facilitator observes and asks.
**Record the screen** if possible — real-time observation misses ~30% of detail.

> This file is the working document for the session. Fill the note blocks inline as she works. Synthesize within 24 hours using the template at the bottom.

---

## Session metadata

- **Date:**
- **Time:**
- **Participants:**
- **Recording link (if any):**

---

## Framing to share at the start (read to her)

> *"I'm not asking you to design the new system. I want to watch you do what you normally do in Airtable — click by click — and I'll take notes on what we need to keep. If something annoys you today, also tell me. We want to rebuild what works and skip what doesn't."*

This is a **time-study observation**, not a requirements interview. Observation reveals workflows interviews miss — especially habitual moves like "always sort by date descending before I scroll."

---

## How to use this checklist

- Don't read it as a script. Keep it as a prompt list.
- Let her open Airtable and do "whatever you'd normally do first thing in the morning." Watch silently for 5–10 minutes, then start asking.
- For each action, note: **what table, what action, what fields she looks at, what she does next, how often, does she save the result anywhere.**
- When she does something habitual ("I always click here first"), ask why. The reason matters more than the click.

---

## Section 1 — First-thing-in-the-morning ritual

*Goal: capture her habitual entry point.*

- [ ] Which table or view does she open first?
- [ ] What does she look for on that first screen? (Counts? Fresh entries? Today's deliveries?)
- [ ] Does she have filters pre-applied or does she apply them manually?
- [ ] How does she decide "everything's fine, move on" vs. "something needs attention"?
- [ ] Are there tabs she keeps permanently open?

**Notes:**

```
(free-text notes go here — what she actually clicked, in what order, what she said)
```

---

## Section 2 — Customer browsing (the CRM heart)

*Goal: understand how she explores customer data.*

- [ ] How does she find a specific customer? (Search? Scroll? Filter by city?)
- [ ] When looking at one customer, what fields does she care about most?
- [ ] What tells her "this is a VIP" or "this is a problem customer"?
- [ ] Which order fields does she look at — frequency, last-order-date, total spent, items, notes?
- [ ] Does she group or sort customers? By what? How often?
- [ ] Does she ever tag, flag, or categorize customers? With what values?
- [ ] Does she make notes on customers? Where, and are those notes structured or free text?
- [ ] How does she handle the same customer appearing twice? (Dedup question — observe, don't explain.)

**Notes:**

```

```

---

## Section 3 — Saved views and filters

*Goal: capture views as first-class requirements.*

- [ ] List every saved view she actually uses (ignore ones she created once and forgot).
- [ ] For each view: filter, sort, grouping, visible columns?
- [ ] Which view is she in most of the time?
- [ ] Are any views shared with other people (accountant, florist, driver)?
- [ ] Does she ever build a temporary filter on the fly? For what kind of question?

**Notes:**

```

```

---

## Section 4 — Exports and external use

*Goal: identify who consumes Airtable data and how.*

- [ ] Does she export to Excel/CSV? Which view, how often, for whom?
- [ ] Does the accountant get a file? What's in it, what format, what cadence?
- [ ] Does anyone else (bank, supplier, tax authority) receive Airtable-derived data?
- [ ] Are there printouts or PDFs she generates from Airtable?
- [ ] Does she share Airtable links with people outside the business? Who, and what do they see?

**Notes:**

```

```

---

## Section 5 — Editing habits

*Goal: catalog every kind of edit, especially the rare ones.*

- [ ] What does she edit daily? (Probably: orders, stock.)
- [ ] What does she edit weekly? (Probably: customer notes, configuration.)
- [ ] What does she edit *rarely but critically*? (Fixing typos, correcting historical data, merging duplicates, changing a customer's name after a marriage — these are the Admin-mode cases.)
- [ ] Has she ever bulk-edited? What, and why?
- [ ] Has she ever wished she could edit something but couldn't? (The answer "no" almost certainly means she worked around it — probe.)
- [ ] When a record is wrong, how does she figure out what it should be? (Other records? Memory? Calling the customer?)

**Notes:**

```

```

---

## Section 6 — Linked records and relationships

*Goal: understand how she navigates between entities.*

- [ ] When looking at a customer, how does she jump to their orders?
- [ ] When looking at an order, does she jump to the customer, delivery, stock items?
- [ ] Does she ever follow a chain three deep — customer → order → stock items used?
- [ ] Are there entity relationships she *wishes* were easier to follow?

**Notes:**

```

```

---

## Section 7 — Automations and formulas she relies on

*Goal: inventory Airtable features the app must replicate in the backend.*

- [ ] Are there formula fields she reads routinely? (Calculated totals, status summaries, date differences.) Write down each formula.
- [ ] Are there Airtable automations running? (Emails, Slack messages, status changes.) What triggers them, what do they do?
- [ ] Are there rollup or count fields she uses? (Customer's lifetime order count, total spent.)
- [ ] Does she rely on any integration (Zapier, webhook, Airtable's own tools)?

**Notes:**

```

```

---

## Section 8 — Pain points and workarounds

*Goal: things to **not** replicate, and things to fix while we're at it.*

- [ ] What in Airtable annoys her daily?
- [ ] What does she wish it did?
- [ ] What does she currently do in Excel or on paper that she wishes was in the app?
- [ ] Which Airtable fields are stale, unused, or confusing?
- [ ] Are there tables she's afraid to touch because she doesn't know what they do?

**Notes:**

```

```

---

## Section 9 — The "one weird thing" question

*Goal: catch the non-obvious.*

- [ ] Is there anything she does in Airtable that no one else would think to ask about?
- [ ] Is there a "trick" she's found that makes her day easier?
- [ ] Is there data in Airtable that exists only in her head otherwise?

**Notes:**

```

```

---

## Section 10 — External-facing workflows

*Goal: make sure we don't break non-owner consumers.*

- [ ] Do florists or drivers ever look at Airtable directly? What for?
- [ ] Does anyone else have edit access? What do they edit?
- [ ] Is Airtable data ever referenced in communications with customers?

**Notes:**

```

```

---

# After the walkthrough — synthesis (within 24h, before memory fades)

Do this yourself. Don't send raw notes to the owner.

### 1. Classify each observed behavior

| Behavior | Bucket |
|---|---|
| _(example: "sorts customer list by Last Order descending every morning")_ | Must-have for CRM MVP |
| | |
| | |

**Buckets:**
- **Must-have for CRM MVP** (Phase 2) — blocks retirement if missing.
- **Must-have eventually** (Phases 3–6) — but not in the MVP.
- **Admin-mode territory** — rare edits, maintenance, corrections.
- **Drop** — she does it out of habit but doesn't need to.

### 2. Dashboard CRM MVP feature list (from must-haves)

```

```

### 3. Admin-mode requirements list (rare-edit cases)

```

```

### 4. Export spec (from Section 4)

| Recipient | Columns | Format | Cadence |
|---|---|---|---|
| Accountant | | | |
| | | | |

### 5. Open questions (keep under 10 — batch-ask her once)

1.
2.
3.

### 6. Short summary to send back to her

> *"Here's what I saw you do, here's what we'll rebuild, here's what we'll skip. Let me know if I missed anything."*

```
(draft here)
```

---

## What "done" looks like for Move 1

- **Parity checklist** — capabilities the Dashboard CRM MVP must have before retirement.
- **View spec** — all saved views translated into filter+sort+column specs.
- **Export spec** — exact format of every external-facing file.
- **Admin-mode scope** — list of rare-edit cases the raw-edit panel must cover.
- **Formula/automation inventory** — what the backend has to replicate.
- **"Drop list"** — things we deliberately will not rebuild.

With these in hand, Phase 1 (Schema) and Phase 2 (Dashboard CRM MVP) can both be scoped and committed to with realistic time estimates.
