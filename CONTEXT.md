# Flower Studio

Operational platform for Blossom, a flower studio in Krakow. Manages the full lifecycle of customer orders, physical stock, procurement, and delivery across three user roles: Owner, Florist, and Driver.

## Language

### Roles

**Owner**:
The business owner — has full access to all apps and operations.
_Avoid_: Admin, manager

**Florist**:
A studio employee who builds orders, manages stock, evaluates received flowers, and logs hours.
_Avoid_: Staff, employee, worker

**Driver**:
A person who delivers orders to customers and does shopping runs for Stock Orders.
_Avoid_: Courier, delivery person

### Orders and fulfillment

**Payment Method**:
How an Order was or will be paid. Values: Cash, Card, Transfer. Separate from payment status (Unpaid/Paid/Partial).
_Avoid_: Payment type

**Order Source**:
The channel an Order came from. Tracked for analytics. Values: In-store, Instagram, WhatsApp, Telegram, Wix, Flowwow, Other.
_Avoid_: Channel, origin

**Order**:
A customer request for one or more bouquets. Has a delivery type (pickup or delivery) and a payment status. The central entity for Florists and the Owner.
_Avoid_: Purchase, transaction

**Delivery**:
The physical act of bringing an Order to a customer's address. Linked 1:1 to a delivery-type Order. The primary entity Drivers work with — Drivers see Deliveries, not Orders.
_Avoid_: Shipment, dispatch

**Distance Band**:
A range of driving distance from the studio with a price attached — up to 5 km, 5–7 km, 7–10 km, and so on. The bands and their prices are Owner-editable, because rates change. A Driver may carry their own band table when their terms differ from the standard; absent one, the standard bands apply. Bands are measured on **driving** distance, not straight-line, because that is what the Driver is actually paid for.
_Avoid_: Zone (a Delivery Zone was the postcode-based model this replaced; it survives only in the Wix storefront config), tier, bracket

**Delivery Cost**:
What the studio pays to have one Delivery made. Calculated automatically at order creation by measuring the driving distance from the studio to the delivery address and looking it up against the Distance Bands, then freely overridable by the Owner — exceptions like an out-of-hours run or an unusually long trip outside the city are priced by hand. Measured **studio → destination** per Delivery, and treated as the agreed price however the Driver sequences a multi-stop run.
_Avoid_: Driver payout (the stored column is named that for historical reasons; "Delivery Cost" is the domain term), courier cost

**Delivery Fee**:
What the Customer pays for a Delivery. The Owner sets it **on top of** the Delivery Cost — that is where the margin comes from. Lives on the Delivery record, not the Order; the Order-level column is redundant and may be stale. Adds to the Order's Final Price on top of the flowers.
_Avoid_: Shipping cost, delivery price, delivery charge

**Delivery Margin**:
`Delivery Fee − Delivery Cost`, the studio's earnings on delivering. It is a number the Owner sets deliberately at both ends, not one she discovers: computing the Cost from distance and letting her price the Fee above it is what makes a margin possible at all. Neither number may ever be derived from the other.
_Avoid_: Delivery profit (fine in prose; "Delivery Margin" is canonical), delivery income

**Customer**:
Any person with an order history. Created on first order; looked up by name or contact details on subsequent orders to avoid duplicates.
_Avoid_: Client, buyer, user

**Termination**:
A terminal action that ends an Order's lifecycle. Two kinds: **Cancellation** (Status flips to Cancelled, the Order remains in the system, can be reopened) and **Deletion** (record removed, irreversible, Owner-only). Both kinds offer an explicit choice: return Stems to inventory or leave them deducted (presumed used or lost).
_Avoid_: Closure, ending, cancel-or-delete

**Cancellation**:
Marking an Order as Cancelled. The Order remains visible in lists and can be reopened (Cancelled → New). Stems are not auto-returned — the Owner or Florist explicitly chooses *Cancel + return stock* or *Cancel only* at the moment of cancellation. Pickup, delivery, and any other Order kind cancel through the same flow.
_Avoid_: Cancel (verb form is fine; the noun is Cancellation)

**Deletion**:
Permanent removal of an Order record. Owner-only. Returned Stems (if any) are computed and surfaced in the success toast. Used when an Order was created in error, not when fulfilment is cancelled.
_Avoid_: Removal, purge

**Supplier**:
A flower wholesaler or market vendor Blossom buys stock from. A managed list shared across Stock Items and Stock Orders — new entries are added as needed but duplicates are avoided.
_Avoid_: Vendor, distributor

### Inventory and procurement

**Type**:
The species or kind of a flower. Required field on every Stock Item. Examples: "Peony", "Rose", "Tulip", "Eucalyptus". Free-text with autocomplete from existing values; new Types created as needed (Owner-only).
_Avoid_: Flower Type (was used informally in pre-Variety drafts; "Type" is the canonical short form), Species, Family

**Colour**:
The colour of a Stock Item, as the Florist would describe it. Optional — many flowers have an obvious default colour (Eucalyptus is green) and Owner can leave the field empty. Two Stock Items differ if one is empty and the other is "Green" (strict identity, no automatic coalescing).
_Avoid_: Color (UK spelling locked for consistency with existing Russian translations)

**Size**:
Stem length in centimetres. Optional — only meaningful for stem-based flowers where length matters (Roses, Peonies, Tulips); leave empty for non-stem items, fillers, or when the Owner doesn't track it. Distinct from `unit` (stems / bunches / kg) which is the existing column on Stock Item.
_Avoid_: Length, stem length

**Cultivar**:
The specific cultivated variety name (e.g. "Sarah Bernhardt", "White O'Hara", "Coral Charm"). Optional. Visibility rule: if filled, the Florist sees it; if empty, only Type/Colour/Size show. Owner fills it when the cultivar matters for fulfilment (specific Rose cultivars) or when autocomplete prefills from a previously-bought cultivar. Free-text with autocomplete; new cultivars created as needed (Owner-only).
_Avoid_: Variety (Variety is the four-tuple, not the cultivar), Sort

**Variety**:
The grouping unit for Stock Items — the four-tuple (Type, Colour?, Size?, Cultivar?). Two Stock Items belong to the same Variety when all four fields match exactly, including matching null values. The Stock list collapses by Variety; the order-line picker returns one row per Variety; aggregation buckets (onHand / planned / reservedForPremades / net) are per Variety.
_Avoid_: Flower Type (was used in PRD #283 drafts to mean Variety; replaced by Variety here), SKU, Flower Kind, Flower Spec

**Stock Item**:
A single inventory row for a Variety on a specific date. Exists in two forms: a **Demand Entry** (negative quantity, no physical stems yet, dated by when stems are needed) and a **Batch** (positive quantity, physically arrived, dated by arrival). Belongs to exactly one Variety; the Variety is the four-tuple (Type, Colour?, Size?, Cultivar?). Quantity unit is the **Stem** for flowers; non-flower categories use other units (bunches, kg).
_Avoid_: Product (Product is a Wix catalog entry), item

**Batch**:
A Stock Item that has physically arrived. Identified by the Variety + arrival date. A single Variety may have zero, one, or several Batches at any time (different arrival dates), plus zero or more Demand Entries.
_Avoid_: lot, shipment, delivery (Delivery is a different concept)

**Demand Entry**:
A Stock Item with negative quantity representing committed future demand. Identified by the Variety + needed-by date (defaults to the linked Order's Required By with fallback Order Date → today). Created when stems are added to an order but no Batch covers the demand. At most one Demand Entry per (Variety, date) — superseding ADR-0002's "at most one per variety" invariant.
_Avoid_: placeholder, open order, pre-order

**Settlement**:
What happens to an Order Line's Demand Entry when the Order reaches a terminal status (Delivered / Picked Up): the committed demand is fulfilled, so the line's contribution is released back toward zero and matching Batches are FEFO-consumed for the stems that physically shipped. A settled Demand Entry is **retained at quantity 0 as an audit marker** while an Order Line still references it (per ADR-0012's audit-marker-visibility rule) — it is never soft-deleted. A settled (zero-quantity) Demand Entry is inert: it is never FEFO-picked, reused by `getOrCreateDemandEntry`, or counted in the partial unique index (all gated on `quantity < 0`). Reversing a settled line's stock effect (edit / cancel / delete) is therefore a no-op.
_Avoid_: closing, clearing, finalising (those don't convey "release demand + keep the marker")

**Stem**:
The unit of quantity for a Stock Item. "We have 15 stems of pink peonies."
_Avoid_: Unit, piece, flower (too generic)

**Consumption**:
One row in the `order_line_consumptions` ledger representing N Stems drawn from one Stock Item (Batch or Demand Entry) against one Order Line. An Order Line has one or more Consumptions; a single-source line has exactly one (mirrors pre-2026-05 behaviour); a multi-Batch split has two or more. The sum of `Consumption.qty` across an Order Line equals `OrderLine.quantity`. The Stock Item FK on Consumption is the authoritative trace link — supersedes the prior `order_line.stockItemId` link from ADR-0007.
_Avoid_: Allocation (Allocation is the engine's *proposed* plan in the picker; Consumption is the *persisted* ledger row after the Florist confirms)

**Allocation**:
The engine's proposed plan in the order-line picker before the Florist confirms — a ranked option emitted by `stockAllocationEngine` of kind `batch`, `merge`, `fresh`, or `split`. A `split` Allocation carries two or more sub-allocations covering one Order Line from multiple Stock Items. Once the Florist confirms, the Allocation crystallises into one or more Consumptions in the ledger.
_Avoid_: Reservation (premade bouquets reserve; orders consume), Plan

**Lot**:
The wholesaler's bundle — the fixed number of Stems a Supplier sells together (a lot of 10 Peonies, a lot of 25 Roses). `Lot Size` is that stems-per-bundle count, stored per Stock Item and per Stock Order line. A Lot is a *purchasing unit*, not an inventory row — it has no date, no quantity of its own, and is not a Batch.
_Avoid_: Pack, bunch, batch (a Batch is a dated inventory row — see Batch)

**Packages**:
How many Lots the Owner is ordering of one Stock Order line. Purely a way of expressing quantity: `Stems = Packages × Lot Size`. Never stored — Stems is the stored quantity, and Packages is derived back from it for display wherever a Lot Size exists. The Owner thinks in Packages when placing an order and in Stems everywhere afterwards.
_Avoid_: Pkgs (fine as a UI abbreviation, not as prose), boxes, units

**Stock Order**:
A procurement order to replenish inventory. Lifecycle: Draft → Sent → Shopping → Reviewing → Evaluating → Complete, plus Cancelled (see Stock Order Termination). Owner creates and plans the order; Driver shops and collects flowers; Owner enters actual quantities and substitutes (Reviewing); Florist marks damaged stems to reconcile incoming stock (Evaluating).
_Avoid_: Purchase Order, PO, supply order

**Stock Order Termination**:
Ending a Stock Order, or one of its lines, before it completes. Which of the two kinds applies is decided by whether the Driver has started shopping, not by the Owner:

- **Before Shopping** (Draft or Sent) — **Deletion**. The order or line is removed outright, leaving no trace. Nothing physical has happened yet. Deleting a Sent order still notifies the assigned Driver, since they were already told about the run.
- **From Shopping onward** — **Cancellation**. The record is kept: a cancelled line stays visible struck-through, a cancelled order stays in the Owner's list behind a filter and disappears from the Driver's app. A cancelled Stock Order produces no pending arrivals.

Cancellation is only meaningful for stems that have not been bought. A line the Driver has already found cannot be cancelled — those Stems physically exist and are received, then written off if unwanted. Cancelling a whole order mid-shopping therefore means *stop shopping and come back with what you have*: still-Pending lines are cancelled, and if any line already has Stems found the order moves to **Reviewing** rather than Cancelled, so what was bought still gets received. A Cancelled Stock Order can be reopened to Draft — it never touched stock, so nothing needs unwinding.
_Avoid_: Killing, voiding, abandoning; do not use the Order-level terms Termination / Cancellation / Deletion without the "Stock Order" qualifier — those describe a customer Order and carry a stock-return choice this does not.

**Substitute**:
An alternative flower used in a Stock Order when the originally planned stem was unavailable at the market. Entered by the Owner during the Reviewing stage.
_Avoid_: Alternative, replacement

**Write-off**:
A recorded reduction of stock quantity due to waste or damage (wilted, damaged, arrived broken, overstock). Happens routinely during Stock Order evaluation and in daily operations.
_Avoid_: Stock loss, shrinkage, wastage

**Material**:
A non-flower Stock Item consumed into bouquets but never charged separately to the customer — foam, ribbon, wrapping paper, standard boxes. A Material is a Variety like any other and lives in the same `stock` table, but it is **never placed on an Order Line**: its quantity falls only at a Recount. Flower-adjacent — the Owner thinks of Materials alongside flowers, and they are bought the same way (Stock Order or manual entry). Because a Material has no per-Order attribution by design, its cost is a period cost, not per-Order COGS.
_Avoid_: Technical stock (the origin term for this idea; "Material" is canonical), consumable, non-floral component, supporting material

**Add-on**:
A non-flower Stock Item that is **sold** to the customer on top of the flowers — vases, decorations, premium boxes. Unlike a Material, an Add-on sits on an Order Line exactly as a flower does: exact per-Order decrement, its own cost and sell price, revenue flowing into the Order's Final Price. Appears in the order-creation picker; a Material never does.
_Avoid_: Extra, upsell, accessory, additional product

**Supply**:
A non-flower Stock Item consumed by running the studio rather than by building bouquets — trash bags, toilet paper, washing liquid. Counted and re-bought like a Material (Recount-only, reorder threshold), but **never attributable to an Order and never sold**, so it appears in no order-related surface at all and is kept visually separate from flowers in the Stock views. Its cost is a period cost.
_Avoid_: Consumable, household item, operating material

**Recount**:
A Florist-initiated correction that sets a Material's or Supply's counted quantity to physical reality — "I counted 40 ribbons." Run frequently (roughly weekly), it is the *only* way those quantities fall, and it is timestamped and attributed so the movement is traceable the way a flower's is. A shortfall drains the Variety's Batches FEFO, oldest first; a surplus (more found than expected) creates a new Batch dated today at cost 0, flagged as recount-origin, rather than silently inflating an existing Batch's cost basis. Distinct from **Write-off**: a Write-off names a cause (wilted, damaged), a Recount claims no cause — it records drift. Keeping them apart is what stops counter drift from polluting waste analytics.
_Avoid_: Reconciliation, stocktake, inventory count, adjustment

**Continuous Material**:
A Material sold and stored as a roll or pack rather than as countable pieces — wrapping paper, ribbon, mesh. Its quantity is held in an integer base unit (centimetres, sheets), but a Florist can never Recount it by measuring: unrolling 50 m of paper to find 37 m left is not a real workflow. A Continuous Material is therefore Recounted as **whole packs plus a rough fraction of the open one** — "3 full rolls and about half" — which the system multiplies by the Material's Lot Size to reach base units. The fraction is an estimate by design; a half-used roll is worth knowing to the nearest quarter and no better. Contrast a **discrete Material** (boxes, ribbons cut to length, foam bricks) which is Recounted by simply counting pieces.
_Avoid_: Bulk material, measured stock, partial roll

### Bouquets and products

**Bouquet**:
An arrangement of multiple stems. Used in two contexts: as a **Product** (sold via Wix) or as a **Premade Bouquet** (built ahead of any order).
_Avoid_: Arrangement, composition, booklet (speech-to-text artifact)

**Product**:
A bouquet listed in the Wix online store (website). Customers browse and order Products online. Not the same as a Stock Item — Products are what customers see; Stock Items are the raw stems used to build them. A Product's **name is localized** — it has an EN/PL/RU/UK version, and the live storefront shows the version matching the visitor's language. These name translations are **owned by flower-studio** (edited in the Dashboard, pushed to Wix); see ADR-0008. The English name is the canonical Product name; the others are its translations.
_Avoid_: Wix product, catalog item, listing

**Product price**:
What a Product's variant sells for on the storefront. The Owner sets it in the Dashboard (or Florist app) and **Push** carries it to Wix; the storefront is downstream. Setting a price and pushing it are separate acts — until a Push lands, a price exists in the app but not on the website. **Pull** imports a Wix price only when Wix's own price changed since the previous Pull (ADR-0020), so a price the storefront has not taken yet is never silently reverted; the Pull result reports how many are in that state. A price changed directly in the Wix admin still flows back on the next Pull.
_Avoid_: "synced price" (a price is either live on the storefront or not — "synced" hides which)

**Premade Bouquet**:
A bouquet a Florist assembles before any customer order exists. Under the reservation model (ADR-0005), Batch quantity is unchanged at build — the `premade_bouquet_lines` rows are the reservation ledger; the Batch is decremented only when the Premade Bouquet is sold and becomes an Order. The bouquet can be sold (an Order is created, the premade record + lines are deleted, standard Batch deduction runs) or dissolved (lines deleted; Batch quantity unchanged).
_Avoid_: Ready-made, walk-in bouquet, pre-built

**Delivery Result**:
The outcome logged by the Driver when completing a delivery. Success means delivered; all other results (Not Home, Wrong Address, Refused, Incomplete) indicate a failed attempt. Owner handles failed deliveries manually — currently no automated re-queue. A re-delivery attempt requires adjusting the delivery fee on the Order.
_Avoid_: Delivery status (that is a separate field)

### Notes and messages

**Card Message**:
Text specified by the customer to be physically written on a greeting card and included with a delivery bouquet.
_Avoid_: Card text, opening text, note

**Florist Note**:
An internal note from the Owner to the Florist, visible in the Florist app. Used to pass instructions or context about a specific order.
_Avoid_: Internal note, staff note

**Driver Note**:
An internal note from the Owner to the Driver, visible in the Delivery app. Used to pass instructions or context. Exists on two entities: on a **Delivery** (instructions for that one drop) and on a **Stock Order** (instructions for the whole shopping run — how to pay, which stall, what to prioritise). Editable by the Owner at any status, not only at creation. Everything the Owner writes there is visible to the Driver — there is no Owner-private note on a Stock Order.
_Avoid_: Delivery note, internal note

**Market Note**:
A note the *Driver* writes on a Stock Order line at the market, explaining a Partial or Not Found result ("stall was closed", "only 8 left"). Distinct from the Owner's line-level instruction, which it must never overwrite — the two are separate fields on the line. Read by the Owner during Reviewing.
_Avoid_: Driver note (a Driver Note travels Owner → Driver; this travels Driver → Owner), comment

### People around the customer

**Key Person**:
A named person in a Customer's social network for whom the Customer has previously ordered (or might order again) a bouquet — a recipient of past delivery orders, plus an optional important date (birthday, anniversary). Used for outreach: "It's been a year since you ordered for Maria — order again?". A Customer has zero or more Key People; there is no fixed limit (the current 2-slot UI is an Airtable-era constraint and is being lifted with the Postgres cutover).
_Avoid_: Contact, recipient (a Recipient is the per-order delivery target — a Recipient becomes a Key Person when the Owner explicitly links them on the Order)

**Recipient**:
The person a Delivery is being brought to, captured per-order as `Recipient Name` + `Recipient Phone` on the Delivery record. Often different from the Customer (e.g. Customer buys flowers for their mother — the mother is the Recipient). The Recipient may be linked to a Key Person at order creation, but isn't required to be.
_Avoid_: Receiver, delivery target

## Relationships

- An **Order** of delivery type "delivery" has exactly one **Delivery**
- An **Order** belongs to exactly one **Customer**
- An **Order** may reference at most one **Key Person** (the person it was placed for; nullable, set at order creation)
- A **Delivery** is always linked to an **Order** — it cannot exist independently
- A **Delivery** has one **Recipient** (Recipient Name/Phone fields), which may or may not correspond to a **Key Person** on the Customer
- A **Customer** has zero or more **Key People**
- A **Variety** is identified by the four-tuple (Type, Colour, Size, Cultivar), where Type is required and the others are optional. Two **Stock Items** belong to the same Variety when all four fields match exactly (including matching null values).
- An **Order Line** has one or more **Consumptions**; each Consumption references exactly one **Stock Item** (Batch or Demand Entry). The sum of Consumption qty equals the Order Line quantity.
- A **Stock Order** has one or more lines, each referencing a **Stock Item** by name
- A **Premade Bouquet** consumes **Stock Items** (stems) immediately on creation
- A **Product** (Wix) is a bouquet for sale online — it is not directly tied to a specific **Stock Item**; the mapping is implicit through the bouquet's composition

## Example dialogue

> **Dev:** "When a customer buys a Product on Wix, does that create an Order?"
> **Domain expert:** "Yes — the Wix webhook fires and the system creates an Order linked to the Customer. The Florist then sees it as a normal Order to fulfil."

> **Dev:** "If a Premade Bouquet isn't sold, what happens to the stems?"
> **Domain expert:** "The Florist returns it to stock — the Stock Items go back to inventory and the Premade Bouquet record is deleted. No Order is ever created."

> **Dev:** "Is a Write-off only for Stock Orders, or can it happen anytime?"
> **Domain expert:** "Anytime — flowers wilt, things get damaged. The Florist logs a Write-off whenever stems leave inventory for a reason other than an Order or Premade Bouquet."

### Operations

**Expense**:
Money the studio spends that has **no Stock Item behind it** — tools that are bought once and used for years (scissors, knives), office supplies, rent, utilities. Recorded directly by the Owner with a date, category, and amount; nothing is counted, nothing depletes. Distinct from a Material or Supply, which are also period costs but *do* carry a quantity worth tracking. Expenses exist so the Owner's financial overview can be complete: revenue minus flower COGS, delivery payout, payroll, Material/Supply purchases, and Expenses.
_Avoid_: Cost (Cost is the per-unit purchase price of a Stock Item), overhead, spend

**Recurring Expense**:
An Expense the Owner defines once because it arrives every month — rent, utilities, a subscription. The definition carries an amount and a category; each month it materialises a real Expense row, which the Owner can then **edit or skip** when the actual bill differs. Materialisation is lazy: the current month's rows appear the first time the financial overview is opened, so nothing depends on a background job. The definition is a default, never a claim about what was actually paid — an edited row wins, and the template is left untouched for next month.
_Avoid_: Subscription, standing cost, fixed cost

**Marketing Spend**:
Tracks advertising costs and flowers used for marketing purposes (social media, promotions). Feature still in development — not fully in use.

**Florist Hours**:
Time-tracking records for payroll. Florists log their working hours; the Owner reviews them to calculate wages.
_Avoid_: Shifts, timesheets, schedule

**Driver of the Day**:
The Driver the Owner designates as responsible for today's runs. Setting it bulk-assigns every still-unassigned Delivery dated today to that Driver, and is the fallback assignee for new delivery Orders. Resets automatically at midnight.
_Avoid_: Default driver, on-call driver

**Assignment Notification**:
A Telegram message sent to a Driver the moment a Delivery or Stock Order becomes their responsibility. Targeted to that one Driver only (never broadcast), and only after the Driver has registered their Telegram chat with the bot. Sent in the Driver's **Notification Language**. A Driver who self-claims a Delivery (by advancing its status) is not notified of their own action.
_Avoid_: Alert, push (Push is a generic web/SSE concept; this is Telegram-specific)

**Florist New-Order Notification**:
A Telegram message sent to the shared florist phone every time a new Order is created — regardless of source (In-store, Wix, Flowwow, AI-intake, premade conversion). The florists share one PIN and one phone; they register that phone once by sending `/start <PIN_FLORIST>` to the alerts bot. The message is written in the **Notification Language** configured for the florist group (one language for all florists, set by the Owner). If the florist phone has not been registered, the ping is silently skipped and order creation is unaffected.
_Avoid_: Florist alert, new-order alert (these are informal; "Florist New-Order Notification" is the canonical term)

**Notification Language**:
The language a Driver's Assignment Notifications are written in — `ru`, `en`, or `pl`, defaulting to `ru`. Set by the Owner per Driver (a Driver does not choose their own). Can be set before the Driver has registered. Also applies to the shared florist group, where a single language is set for all florists (not per-florist).
_Avoid_: Locale (no regional formatting is implied — only the message strings change)

## Apps

**Blossom app** (or just "Blossom"):
The collective system — all three apps together. When a feature is discussed for "Blossom", it means all apps unless a specific one is named.
_Avoid_: "The app" (ambiguous)

**Florist app**:
The tablet/phone app used by Florists. Covers orders, stock, POs, evaluation, and hours.

**Dashboard**:
The desktop app used by the Owner. Full control over operations, CRM, finances, products, and settings.

**Delivery app**:
The phone app used by Drivers. Covers assigned deliveries and Stock Order shopping runs.

**Explorer**:
A read-only linked-record surface inside the Dashboard (owner-only, desktop) for exploring Blossom's data. The Owner picks a start-point (a Flower, Order, Customer, Supplier, …), filters it, and drills through relationships by clicking a row to open its related records — e.g. a Flower → the Orders that used it → each Order's Customer → that Customer's Key People. Distinct from **Ask Blossom** (natural-language questions, one answer per turn): Explorer is click-driven navigation with no LLM per click. Ask Blossom can hand a query off to Explorer ("Open in Explorer"). Safe by construction — it can only emit the same validated declarative query spec the assistant uses (allow-listed entities/fields/joins, row cap), never raw SQL, and never edits data (rows deep-link into the existing edit screens).
_Avoid_: Super-search (the origin term for this idea; "Explorer" is canonical), linked-record explorer, grid

**Deep-join report** (Explorer v2):
A single flat grid that follows a **fixed chain of relationship edges** across 3+ entities and flattens them into one denormalized row set — e.g. Flower → the Orders that used it → each Order's Customer → that Customer's Key Person, all as columns of one grid. Distinct from **navigation drilling** (v1: clicking a row opens a fresh single-hop query — you move *between* grids). A deep-join report shows every hop at once. Only follows the pre-defined descriptor edges (no arbitrary entity-to-entity joins — that is the deferred **Arbitrary join builder**, v3). Bounded by the same row cap; fan-out (a "many" hop) is warned/capped.
_Avoid_: multi-hop join, chained query, denormalized report

**Pivot** (Explorer v2):
A two-dimension summary of a **Measure** — rows × columns × measure (e.g. sales *summed* with Order status down the side and month across the top). A **Measure** is an aggregate of a numeric field: sum / avg / min / max / count. v1 exposed count-only over a single group-by; v2 adds real measures and the second (column) dimension.
_Avoid_: cross-tab, matrix report

## Flagged ambiguities

- "Bouquet" is used both for a **Product** (Wix listing) and a **Premade Bouquet** (pre-built inventory item) — these are distinct. Context determines which is meant; prefer the full term when precision matters.
- "Flowers in the order" = the individual stem entries per Order (Order Lines in code) — not a domain term, just how the team describes the order contents informally.
- "Wix" and "website" are used interchangeably to refer to the online store.
