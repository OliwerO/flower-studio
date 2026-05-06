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

**Supplier**:
A flower wholesaler or market vendor Blossom buys stock from. A managed list shared across Stock Items and Stock Orders — new entries are added as needed but duplicates are avoided.
_Avoid_: Vendor, distributor

### Inventory and procurement

**Stock Item**:
A named flower variety tracked in inventory (e.g. "Pink Peonies"). The unit of quantity is the **stem**.
_Avoid_: Product (a Product is a Wix catalog item, not a stem), item

**Stem**:
The unit of quantity for a Stock Item. "We have 15 stems of pink peonies."
_Avoid_: Unit, piece, flower (too generic)

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
A bouquet listed in the Wix online store (website). Customers browse and order Products online. Not the same as a Stock Item — Products are what customers see; Stock Items are the raw stems used to build them.
_Avoid_: Wix product, catalog item, listing

**Premade Bouquet**:
A bouquet a Florist assembles before any customer order exists. Stock is deducted immediately on creation. Can either be sold (an Order is created, the premade record is deleted) or returned to stock (stems go back to inventory, record is deleted).
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

## Flagged ambiguities

- "Bouquet" is used both for a **Product** (Wix listing) and a **Premade Bouquet** (pre-built inventory item) — these are distinct. Context determines which is meant; prefer the full term when precision matters.
- "Flowers in the order" = the individual stem entries per Order (Order Lines in code) — not a domain term, just how the team describes the order contents informally.
- "Wix" and "website" are used interchangeably to refer to the online store.
