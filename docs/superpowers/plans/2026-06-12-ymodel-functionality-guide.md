# Y-Model — Functionality Guide (by example)

**Purpose:** instead of discovering by chance how stock, demand, orders and purchases
behave, this walks through **every concept with one clean example each**. Every number
below is real — it comes from a teaching dataset you can open live.

**How to open the examples**
- Lab data = scenario **`y-model-guide`** (reseed any time with `npm run lab:reset`).
- Apps: Florist http://localhost:5176 · Dashboard http://localhost:5177 · Delivery http://localhost:5178
- PINs: owner **1111** · florist **2222** · Timur **3333** · Nikita **4444**
- Each concept = its **own Variety**, so one row shows one idea with no cross-talk.

---

## Part 1 — The four words everything is built from

Every flower Variety (e.g. *Tulip Yellow 40cm*) has its stems sorted into **four buckets**.
Read them left to right and the whole system makes sense:

| Bucket | Plain meaning | Where the number comes from | Dated by |
|---|---|---|---|
| **On hand** | Stems physically in the studio right now | Batches you received | **arrival** date |
| **Committed (demand)** | Stems already promised to customer orders | One "demand" line per needed-by date | **needed-by** date |
| **Reserved** | On-hand stems tied up inside a premade bouquet | Premade recipes | — |
| **Incoming** | Stems on a purchase order, not here yet | Open PO lines | **planned arrival** date |

Two derived numbers:

- **Net = On hand − Committed − Reserved.** This is what the Stock panel shows as the big number.
  *Net does **not** include Incoming* — incoming is shown separately, because it isn't here yet.
- **Effective = Net + Incoming.** "After the truck arrives, where do I stand?" This is what
  matters when you take a *new* order. (The picker should show this — today it doesn't fully; see Part 4.)

> ⚠️ The single biggest source of confusion today is that these buckets are **not labelled**
> consistently across screens. The word "planned" is used for *committed demand* in one place
> and could be read as *planned arrival* — they are opposite things. This guide uses
> **committed / incoming** and never "planned." (Tracked as CR-31.)

**Negative stock is normal and intentional.** If 5 stems are promised and 0 are on hand,
On hand = 0, Committed = 5, **Net = −5**. The minus sign is the *buy signal*: "owe 5, order them."

---

## Part 2 — Healthy stock (the simple cases)

### Example 1 · Healthy stock, nothing promised
**Variety: Rose Red 50cm Naomi**
- Rows behind it: one batch of **40**, arrived 10 Jun.

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 40 | 0 | 0 | **40** | 0 |

- **Stock panel:** "40 on hand · 40 free", green.
- **Order picker:** "Rose Red 50cm Naomi · 40 pcs" → pick → "Use stock 40 / 40".
- **Meaning:** 40 sellable, nobody waiting on them. The clean baseline.

### Example 2 · One Variety, several batches (FEFO)
**Variety: Rose White 60cm Avalanche**
- Two batches: **30** (arrived 10 Jun) + **12** (arrived 5 Jun).

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 42 | 0 | 0 | **42** | 0 |

- **Stock panel:** one Variety row "42 on hand". Expand → the two dated batches.
- **Order picker:** "Use stock 42 / 42" (the two batches are merged into one line because they
  share a sell price).
- **Meaning:** same flower, bought on two days. When you sell, the system drains the **oldest
  batch first** (5 Jun before 10 Jun) — FEFO, "first expire, first out" — so nothing rots.
- **"Flat table" tab** on the Stock panel is where you see the individual batches side by side.

---

## Part 3 — Demand: stems promised to orders

A **demand** is created automatically when a customer order needs a flower. It is a line with a
**negative** quantity, dated by the order's **needed-by** date. One line per date.

### Example 3 · Stock with a customer order against it
**Variety: Tulip Yellow 40cm**
- Batch **+50** (arrived 10 Jun) and a **demand −8** (needed 15 Jun) — the −8 is a real order
  (*Tulip Yellow ×8, status Ready*).

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 50 | 8 | 0 | **42** | 0 |

- **Stock panel:** "50 on hand · 8 orders · 42 free".
- **Meaning:** 50 in the bucket, 8 spoken for, **42 genuinely free** for new work.
- **Watch out:** in the order picker this same Variety shows **three numbers** — 42 (net), 50
  ("Use stock 50/50" = raw batch), and 8 ("8 needed"). All three are true but unlabelled, which
  reads as "doesn't add up." This is the picker rework (CR-23).

### Example 4 · Pure shortfall — owe stems, none on hand, none ordered
**Variety: Ranunculus Orange 40cm**
- One **demand −5** (needed 20 Jun). No batch, no PO.

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 0 | 5 | 0 | **−5** | 0 |

- **Stock panel:** "−5" in red, tagged **"next PO"** (orange) — nothing incoming yet.
- **Meaning:** the buy signal. 5 stems owed, none here, nothing on the way → **put them on a PO.**
  When you create a new PO, this is the kind of row that pre-fills it.

### Example 5 · Same Variety, two different needed-by dates
**Variety: Peony Pink 60cm Sarah Bernhardt**
- Batch **+25** (arrived 10 Jun), **demand −10** (needed 13 Jun), **demand −6** (needed 17 Jun).
- The −6 is **two orders summed** (×4 + ×2, both needed 17 Jun → one −6 line).

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 25 | 16 | 0 | **9** | 0 |

- **Meaning:** demand for the **same flower on different days stays on separate dated lines**
  (13 Jun vs 17 Jun) but **two orders on the same day merge** into one line. That's why you
  sometimes see one demand line and sometimes several for one flower — it's per needed-by date,
  not per order. (Relevant to how the driver should see merged lines — CR-12.)

---

## Part 4 — Incoming: purchase orders not here yet

**Incoming** stems live on a PO line and are shown **separately** from Net (they aren't in the
studio). In this dataset there is one **Sent PO (PO-GUIDE-1)** arriving **16 Jun**, assigned to
Nikita — you can see it on the **Delivery app** (PIN 4444) as a shopping run.

### Example 6 · Shortfall covered by an incoming PO
**Variety: Peony Pink 50cm**
- **Demand −7** (needed 15 Jun) + **PO line +7** (arriving 16 Jun).

| On hand | Committed | Reserved | Net | Incoming | Effective |
|--:|--:|--:|--:|--:|--:|
| 0 | 7 | 0 | **−7** | **+7 → 16 Jun** | **0** |

- **Stock panel / picker:** "−7 pcs · +7 → 16.Jun".
- **Meaning:** you owe 7, and **exactly 7 are coming** → after 16 Jun you're square (Effective 0).
  Nothing free for a *new* order — those 7 are already claimed.
- **Watch out:** Net still reads **−7** even though it's covered. The "covered" part only shows if
  you also read the incoming number. Making the picker hide/flag Effective-0 rows is CR-20.

### Example 7 · Surplus incoming (more arrives than needed)
**Variety: Lisianthus White 50cm**
- **Demand −12** (needed 18 Jun) + **PO line +20** (arriving 16 Jun).

| On hand | Committed | Reserved | Net | Incoming | Effective |
|--:|--:|--:|--:|--:|--:|
| 0 | 12 | 0 | **−12** | **+20 → 16 Jun** | **+8** |

- **Meaning:** 12 owed, **20 coming** → 8 spare after the orders are filled. Those **8 become
  available for new orders once the PO lands** on 16 Jun. (Showing this "+8 effective, arrives
  16 Jun" cleanly is CR-22.)

---

## Part 5 — Reserved: stems locked inside premade bouquets

A **premade bouquet** recipe reserves on-hand stems without removing them from stock — they're
spoken-for, not gone.

### Example 8 · Premade reservation
**Variety: Hydrangea Blue 30cm**
- Batch **+28** (arrived 10 Jun). Premade **"Spring Set"** reserves **6**.

| On hand | Committed | Reserved | Net | Incoming |
|--:|--:|--:|--:|--:|
| 28 | 0 | 6 | **22** | 0 |

- **Stock panel:** "28 on hand · 6 reserved · 22 free". Tap the **reserved** chip → see which
  premade ("Spring Set ×6") holds them.
- **Meaning:** 28 physically present, but 6 are committed to building Spring Set, so **22 are free**.
- If you need those 6 for a customer order, you **dissolve the premade** and the stems return to
  the free pool. (Surfacing this in the order picker + an "untie" prompt is CR-21.)

---

## Part 6 — Where the data goes fuzzy (defects to know about)

### Example 9 · The nameless row (half-entered PO line)
**Variety: (none) — a row literally named "peony"**
- Created by typing a free-text "peony" on a PO instead of choosing Type/Colour/Size. It has a
  quantity (0 on hand, **+50 incoming**) but **no Type/Colour/Size/Cultivar**.
- **What you see:** in the order picker it appears as a **blank-named row** "20 zł · 0 pcs · +50 → 16.Jun".
  In the grouped Stock panel it **doesn't appear at all** (the grouping needs those four fields).
- **Meaning:** this is a **broken state**, not a feature. A flower with no identity can't be grouped,
  can't be found by FEFO, and shows up nameless. The fix is to force Type/Colour/Size when a PO line
  is created, and to back-fill identity when the PO is received (CR-29 / pitfall #9).

### Example 10 · The undated row (legacy aggregate)
**Variety: Gypsophila White**
- One batch of **15** with **no arrival date**.
- **What you see:** "15 pcs" but **no date chip** — while every other flower shows a date.
- **Meaning:** this is an old-style "lump" record from before dated batches. Under the full model
  every row should be dated; undated rows are why the data sometimes looks "fuzzy" (some rows have
  a date, some don't). Flagged for cleanup.

---

## Part 7 — Cheat-sheet: reading any stock row

When you look at a flower anywhere, ask in order:

1. **On hand** — how many are physically here? (sum of batches)
2. **Committed** — how many are promised to orders? (the negative/demand lines)
3. **Reserved** — how many are inside premades?
4. **Net** = on hand − committed − reserved → the big number. **Negative = buy more.**
5. **Incoming** — anything on a PO? When does it land? → **Effective = Net + Incoming.**

**Dates never mean the same thing twice — always check which kind:**

| You see a date on… | It means |
|---|---|
| a **batch** (e.g. "10 Jun") | when it **arrived** |
| a **demand** line (e.g. "needed 15 Jun") | when a **customer order** wants it |
| an **incoming PO** ("→ 16 Jun") | when the driver **buys / it arrives** |

---

## For the developer (not owner-facing)

- Scenario: `lab/scenarios/yModelGuide.js` (`y-model-guide`); seeder extended for
  `stockOrders` / `stockOrderLines` in `lab/helpers/seed.js`.
- Bucket math is authoritative in `packages/shared/utils/stockMath.js` → `getVarietyTotals`
  (`onHand` = Σ +qty, `planned` = Σ |−qty|, `net = onHand − planned − reserved`; incoming is
  **not** in net). Demand date = `computeDemandDate(order)` → `requiredBy` (`stockRepo.js:37`).
- Stock panel data: `GET /stock?grouped=true` + `/stock/premade-committed` + `/stock/pending-po`.
  Picker data: `GET /stock?includeEmpty=true&includeInactive=true` (flat, includes demand + empty).
- This guide is the worked-example companion to the change-request log
  `docs/superpowers/plans/2026-06-11-ymodel-test-session-notes.md`. Concept→CR map: Ex3→CR-23/27/28,
  Ex4→buy-signal, Ex6→CR-20, Ex7→CR-22, Ex8→CR-21, Ex9→CR-29, dates→CR-30/31, picker UX→CR-24/25/26.
