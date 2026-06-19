---
name: owner-summary
description: Write a plain-language summary of a change for Blossom's business owner (the florist-studio operator). Zero jargon, no file paths, no code — just what changes for her on her phone/desktop, why it helps, how to use it, and what to watch out for. Use whenever a change has any owner-visible effect (new button, changed behavior, new feature in florist/dashboard/delivery apps), alongside [dev-summary] for the technical version. Trigger phrases: "owner-friendly summary", "explain this to the owner", "what changes for her", "what does she need to know".
---

# Owner Summary (for the business owner)

The owner runs the flower studio. She is not a developer. She uses the dashboard on her desktop and the florist app on her phone for the same daily tasks — managing orders, stock, bouquets, customers. A change to the code only matters to her when it changes what *she sees and does* on those screens.

This skill writes the **business-owner version** of a change. It is the thing she actually reads. It must be short, friendly, plain Russian or plain English (default: the language Oliwer is currently using to brief her), and it must answer four simple questions about her daily work.

Use it whenever a change has any owner-visible effect. Pair it with [dev-summary] — Oliwer reads the dev one; she reads this one.

## Quick start

Write one short block in this exact shape:

```md
### <plain-language title — what changed, in 6–10 words>

**What's new for you**
<2–3 sentences. Describe the change as if telling a friend, no jargon. Say what she will *see* or what will *happen* differently. Mention which app (florist on phone / dashboard / delivery).>

**Why this helps**
<2–3 bullets. Each one names a real daily task that becomes easier, faster, less risky, or less manual. Tie it to something she does every day.>

**How to use it**
<Step-by-step in plain language, 2–5 short steps. Use tap/click, not technical names. Reference visible labels on the screen, not internal field names.>

**Watch out for**
<1–3 short notes. Mention edge cases she might hit, what to do if something looks off, who to ask. If genuinely nothing, write "Nothing tricky — just use it as described.">
```

## Example (real example, "Available Today" auto-zero)

```md
### "Available Today" tag now zeroes the lead time for you

**What's new for you**
When you tag a bouquet "Available Today" in the dashboard or florist app, the system now sets its lead time to 0 days automatically. You don't have to remember to set it by hand anymore. Tagged bouquets will appear in the "Available Today" carousel on the Wix storefront without any extra step.

**Why this helps**
- One less click each time you add a same-day bouquet.
- No more "I tagged it but it isn't showing on the website" — the tag and the website now always agree.
- Less chance of mistakes when you are in a hurry on a busy day.

**How to use it**
1. Open the bouquet in the dashboard or florist app.
2. Add the "Available Today" tag like before.
3. Save. That's it — the lead time is now 0 automatically.

**Watch out for**
- If you want a bouquet that has the "Available Today" tag but a longer lead time (rare case — maybe a pre-order tagged early), the lead time field will be greyed out. Remove the tag first, then set the lead time you want.
- Existing bouquets you have already saved keep their current lead time. Only changes you save from now on get the automatic zero.
```

## The four sections — non-negotiable

### 1. What's new for you
- Open with the change, told as a small story she can picture.
- Name the app: "in the florist app on your phone", "in the dashboard", "in the delivery app".
- If it shows up in the Russian UI, mention the actual Russian label she will see — not the English code name.
- 2–3 sentences. No technical words.

### 2. Why this helps
- Bullets, each grounded in her actual day: "less typing", "no more X", "faster", "safer", "you can see Y at a glance".
- Avoid vague benefits like "more robust" or "better UX". Always: *what daily task becomes easier?*
- 2–3 bullets, not more.

### 3. How to use it
- Step-by-step, tap/click level.
- Reference visible labels and visible places in the app — not field names, not URLs.
- If the change is invisible (an automatic behavior), say so explicitly: "You don't have to do anything different — it just works when you save."
- If the change is something *not* to do anymore (an old workaround removed), say so: "You can stop manually zeroing the lead time — it happens for you now."

### 4. Watch out for
- Edge cases she may encounter, in her own words.
- What to do if it looks wrong: "If a tagged bouquet still does not appear on Wix after a few minutes, tell Oliwer."
- "Nothing tricky — just use it as described." is a valid answer when true. Do not pad.

## Hard rules

- **No file paths, no code, no commit hashes.** If a word would not appear on her screen, it does not belong in this summary.
- **No internal field names.** "Lead Time Days" is fine because the dashboard shows it; `leadTimeDays` is not.
- **No process language.** No "PR", "merged", "deployed", "branch", "rollback". Just: "from today" or "in the next version of the app you open".
- **Name the visible surface.** Always tell her *which app and which screen* the change lives on.
- **Friendly, not corporate.** Write like Oliwer telling her over coffee, not like a release notes page.
- **Short.** The whole block should fit in one phone screenshot. If it sprawls, the change is too big to summarise — split it.
- **Default to the language Oliwer is briefing in.** UI is Russian; if the owner reads briefings in Russian, write in Russian. Otherwise English. Match the tone of recent direct messages.

## Workflow

1. Read [dev-summary] for the same change (if written) — it has the facts. Translate, do not copy.
2. Identify the **single visible surface** the change touches (a button, a tag, an automatic behavior, a new section in the app).
3. If you cannot find a visible surface, the change has no owner-summary — it is internal-only. Write a one-line note for Oliwer instead.
4. Walk through the four sections in order. Use the example above as a template.
5. Read it back as if you were her: would she understand it on her phone over coffee? If not, simplify again.
6. Keep it under 20 lines total.

## When NOT to write an owner-summary

- Internal refactors with zero UI effect.
- Test additions, CI changes, dependency bumps.
- Schema migrations that change nothing she sees.
- Performance fixes she would not notice.
- Dev tooling, scripts, lab harness.

For these, [dev-summary] alone is the right artifact. Do not pad the owner with churn she cannot act on.

## Red flags

| Thought | Reality |
|---|---|
| "She'll figure it out from the diff" | She will not see the diff. Write the summary. |
| "It's the same as the dev summary, just shorter" | No — different sections, different audience. Rewrite, do not trim. |
| "She doesn't need the 'watch out for' section" | She does. Surprises produce panicked messages later. Two minutes now saves a half-hour then. |
| "Russian or English?" | Match the language Oliwer is currently briefing her in. Default English; UI labels can be quoted in Russian when she'd see them on screen. |
| "It's a small change, skip the summary" | Then the change probably has no owner-visible effect. Confirm — and if true, skip cleanly. Don't half-write it. |
| "Tell her what's technically going on" | She does not need the why-it-works. She needs the what-changes-for-me. |

## Related

- [dev-summary] — technical companion for Oliwer; written first, this one second.
- [parity-sync] — if the change touches both apps, the owner-summary names both ("on your phone and on the dashboard").
- [pre-pr-matrix] — must be green before this summary ships; never describe behavior that has not been verified.
