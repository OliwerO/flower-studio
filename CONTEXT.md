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

**Stem**:
The unit of quantity for a Stock Item. "We have 15 stems of pink peonies."
_Avoid_: Unit, piece, flower (too generic)

**Consumption**:
One row in the `order_line_consumptions` ledger representing N Stems drawn from one Stock Item (Batch or Demand Entry) against one Order Line. An Order Line has one or more Consumptions; a single-source line has exactly one (mirrors pre-2026-05 behaviour); a multi-Batch split has two or more. The sum of `Consumption.qty` across an Order Line equals `OrderLine.quantity`. The Stock Item FK on Consumption is the authoritative trace link — supersedes the prior `order_line.stockItemId` link from ADR-0007.
_Avoid_: Allocation (Allocation is the engine's *proposed* plan in the picker; Consumption is the *persisted* ledger row after the Florist confirms)

**Allocation**:
The engine's proposed plan in the order-line picker before the Florist confirms — a ranked option emitted by `stockAllocationEngine` of kind `batch`, `merge`, `fresh`, or `split`. A `split` Allocation carries two or more sub-allocations covering one Order Line from multiple Stock Items. Once the Florist confirms, the Allocation crystallises into one or more Consumptions in the ledger.
_Avoid_: Reservation (premade bouquets reserve; orders consume), Plan

**Stock Order**:
A procurement order to replenish inventory. Lifecycle: Draft → Sent → Shopping → Reviewing → Evaluating → Complete. Owner creates and plans the order; Driver shops and collects flowers; Owner enters actual quantities and substitutes (Reviewing); Florist marks damaged stems to reconcile incoming stock (Evaluating).
_Avoid_: Purchase Order, PO, supply order

**Substitute**:
An alternative flower used in a Stock Order when the originally planned stem was unavailable at the market. Entered by the Owner during the Reviewing stage.
_Avoid_: Alternative, replacement

**Write-off**:
A recorded reduction of stock quantity due to waste or damage (wilted, damaged, arrived broken, overstock). Happens routinely during Stock Order evaluation and in daily operations.
_Avoid_: Stock loss, shrinkage, wastage

### Bouquets and products

**Bouquet**:
An arrangement of multiple stems. Used in two contexts: as a **Product** (sold via Wix) or as a **Premade Bouquet** (built ahead of any order).
_Avoid_: Arrangement, composition, booklet (speech-to-text artifact)

**Product**:
A bouquet listed in the Wix online store (website). Customers browse and order Products online. Not the same as a Stock Item — Products are what customers see; Stock Items are the raw stems used to build them. A Product's **name is localized** — it has an EN/PL/RU/UK version, and the live storefront shows the version matching the visitor's language. These name translations are **owned by flower-studio** (edited in the Dashboard, pushed to Wix); see ADR-0008. The English name is the canonical Product name; the others are its translations.
_Avoid_: Wix product, catalog item, listing

**Premade Bouquet**:
A bouquet a Florist assembles before any customer order exists. Under the legacy model (`STOCK_Y_MODEL=false`), Batch quantity is decremented immediately on creation. Under the Y-model (`STOCK_Y_MODEL=true`, ADR-0005), Batch quantity is unchanged at build — the `premade_bouquet_lines` rows are the reservation ledger; the Batch is decremented only when the Premade Bouquet is sold and becomes an Order. Either way, the bouquet can be sold (an Order is created, the premade record + lines are deleted, standard Batch deduction runs) or dissolved (lines deleted; Batch unchanged in the Y-model, credited in legacy).
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
An internal note from the Owner to the Driver, visible in the Delivery app. Used to pass delivery instructions or context.
_Avoid_: Delivery note, internal note

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

## Flagged ambiguities

- "Bouquet" is used both for a **Product** (Wix listing) and a **Premade Bouquet** (pre-built inventory item) — these are distinct. Context determines which is meant; prefer the full term when precision matters.
- "Flowers in the order" = the individual stem entries per Order (Order Lines in code) — not a domain term, just how the team describes the order contents informally.
- "Wix" and "website" are used interchangeably to refer to the online store.
