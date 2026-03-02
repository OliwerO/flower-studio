# Flower Studio Management App — CLAUDE.md (Final)

## Quick Start

This file goes in your project root as `CLAUDE.md`. Open Claude Code and say:

```
Read CLAUDE.md and begin Phase 1.
```

---

## Project Overview

Build a web application to replace a multi-spreadsheet workflow for **Blossom**, a small flower studio in Krakow, Poland. The system manages orders from 6 channels, flower inventory with supplier/cost tracking, customer CRM (extending an existing Airtable base with ~1,059 B2C clients), deliveries, and two owner dashboards (day-to-day operations + financial KPIs).

**Users:** 1 owner (desktop), 2–4 florists (tablet/phone), 2 delivery drivers (phone).
**UI language:** Russian (Ukrainian & Polish optionally later).
**Data language:** Customer notes arrive in Russian, Ukrainian, Polish, English, Turkish, etc. — auto-translate to Russian via Claude API (Haiku).

---

## Current State (What Exists Today — Do NOT Modify or Delete)

### Existing Airtable CRM — "CRM Blossom (NEW)"
This base MUST be preserved. New tables are ADDED alongside existing ones. The existing Clients (B2C) table gets new fields added but nothing is deleted.

**Clients (B2C) — MASTER** (~1,059 records). Existing fields:
- Nickname, Name, Segment (Rare/Constant/New/DO NOT CONTACT — manually assigned)
- Link (usually Instagram URL), Source (Insta/WhatsApp/Telegram/Fb/Outlook/SMS/Gmail)
- Language (RUS/UKR/PL/ENG), Phone, Email, Home address
- Sex/Business (Female/Male/Business)
- Orders (list) — legacy format: YYYYMM-number (e.g., "202402-83")
- Orders (TOTAL), AVG Check, Last order date
- Campaigns (marketing campaign tags — stays Airtable-only for now)
- Connected people, Key person 1/2 (Name + Contact details), Key person 1/2 (important DATE)
- Found us from, Last engagement DATE/CHAT, Exported from

**Clients (B2B)** — out of scope for v1.
**MKT-Campaigns** — out of scope for v1 (stays Airtable-only).
**Orders (LEGACY)** — has real historical data. DO NOT WRITE TO THIS TABLE. Keep as archive. The app creates a NEW separate Orders table.

### Existing Excel: "Orders and stock 2025" (SharePoint)
The daily operations workbook the app replaces. Each monthly tab (01–12) contains ~40–125 orders.

**Each order is a MULTI-ROW BLOCK (not a flat row).** Actual structure from CSV analysis:
```
Row 1: Customer ID | Date | Delivery fee | Total price | Payed/Unpayed | Payment method | "Comments to this order" | "Source client came from"
Row 2: "Stock Flower name" | "Price" | "Max" | "Quantity" | "Total" | Customer request text (e.g. "25 country. friends bday") | | "IG search" / source detail
Row 3: (empty or flower) | ... | ... | ... | ... | (empty or "Comment to the source")
Row 4+: Flower name | price | max | quantity | total | "Delivery info" header then: Date / Time / Address / Recipient name / Recipient tel / Card text (on right side)
...
Last row: "Delivery (no data input here)" | fee | | qty | total | Driver name | Payed/Unpayed status
--- blank separator row ---
```

**Customer identification varies:** Instagram URL (most common), "WA +phone Name", just a name, "flowwow From Name", or "Customer (link/tel/email/name)" for blank template rows.

**Flower lines** fill in on left columns (A–E), while delivery info fills in on right columns (F–G), in the same rows. Most prices show as "- zł" in CSV because they are formula lookups from STOCK/Tech.data tabs.

**STOCK tab:** Flower inventory with: Order date, Supplier, Farmer, Color, Purchase Flower name, Purchase price PLN, Purchase quantity (stems), Purchase sum PLN, Price to sell for, Dead/Unsold stems, Batch, Stock (current quantity), Stock Flower name (display name).

### Existing Excel: "Blossom Audit Dasha owner" (Google Sheets)
Business analytics workbook with monthly KPIs the Financial Dashboard must replicate:

**Deliveries tab** — Monthly aggregated metrics:
- Bouquets sold (excl. promo), Website revenue, Promo bouquets, Pickup vs delivery counts
- Delivery revenue (customer-paid), delivery costs (driver-paid), delivery gain/loss
- Total revenue, AVG price, Revenue YoY% growth
- Flower purchase costs, Marketing costs
- Estimated revenue at standard markup (cost × 2.2), Unrealised revenue (unsold flowers)
- % unrealised revenue (waste/loss ratio)

**WeddingsEvents tab** — Separate pipeline (Phase 2 backlog):
- Date, Type (Wedding/Christmas dec), Bride/Client, Cost of flowers, Revenue
- Status pipeline: заявка получена → офер выслан → оплачена → подготовка → монтаж → демонтаж закончен

---

## CRITICAL: How Orders Actually Work

**Florists do NOT select from a fixed product catalog.** The real workflow:

1. Customer makes a request (e.g., "25 blush dianthus + eucalyptus for a birthday", or "florist choice for 300zł", or "BRIDAL bouq - 50 white freesias")
2. Florist **composes the bouquet from individual flowers in stock**
3. Each flower has a cost price (from supplier) and a sell price (markup)
4. **Order total = sum of (flower sell price × quantity) + delivery fee**
5. Florist can override the calculated total (common for negotiations or "florist choice" orders)
6. If supplier cost goes up → sell price goes up (prices are dynamic)

The order form needs a **bouquet builder** where the florist:
- Records the customer's original request text
- Selects individual flowers from current stock
- Enters quantity of each stem
- Sees running cost price and sell price
- Can override the final price
- Adds delivery info if applicable

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Database | Airtable (existing paid base — extend, don't replace) |
| Backend | Node.js + Express |
| Frontend | 3 separate React apps (Vite + Tailwind) |
| Wix integration | Webhook receiver on backend |
| Translation | Anthropic Claude API (Haiku model) |
| Hosting — frontend | Vercel (free tier) |
| Hosting — backend | Railway (~$5/month) |
| Auth | Simple PIN per role |

---

## Project Structure

```
flower-studio/
├── CLAUDE.md                    ← This file
├── package.json                 ← Root workspace config
├── .env.example
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js             ← Express server entry
│   │   ├── config/
│   │   │   └── airtable.js      ← Airtable client setup
│   │   ├── routes/
│   │   │   ├── orders.js
│   │   │   ├── customers.js
│   │   │   ├── stock.js
│   │   │   ├── deliveries.js
│   │   │   ├── dashboard.js     ← Day-to-day dashboard data
│   │   │   ├── analytics.js     ← Financial KPI dashboard data
│   │   │   ├── webhook.js       ← Wix webhook receiver
│   │   │   └── auth.js          ← PIN validation
│   │   ├── services/
│   │   │   ├── airtable.js      ← Generic Airtable CRUD helpers
│   │   │   ├── translation.js   ← Claude Haiku translation
│   │   │   ├── wix.js           ← Wix payload mapping
│   │   │   ├── pricing.js       ← Cost → sell price calculations
│   │   │   └── notifications.js ← New order alerts (SSE)
│   │   └── middleware/
│   │       ├── auth.js          ← PIN middleware
│   │       └── errorHandler.js
│   └── tests/
├── apps/
│   ├── florist/                 ← Vite + React + Tailwind
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.jsx
│   │       ├── pages/
│   │       │   ├── OrderForm.jsx       ← Multi-step with bouquet builder
│   │       │   ├── BouquetBuilder.jsx  ← Core: flower picker + quantities
│   │       │   ├── OrderList.jsx
│   │       │   └── StockPanel.jsx
│   │       ├── components/
│   │       │   ├── CustomerSearch.jsx
│   │       │   ├── FlowerSelector.jsx  ← Search/filter stock, add to bouquet
│   │       │   ├── BouquetSummary.jsx  ← Running total, cost vs sell
│   │       │   ├── DeliveryForm.jsx    ← Address, time, recipient, card
│   │       │   ├── OrderCard.jsx
│   │       │   └── StockItem.jsx
│   │       ├── hooks/
│   │       │   └── useNotifications.js ← SSE listener for new Wix orders
│   │       └── api/
│   │           └── client.js
│   ├── delivery/                ← Vite + React + Tailwind
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.jsx
│   │       ├── pages/
│   │       │   └── DeliveryList.jsx
│   │       ├── components/
│   │       │   └── DeliveryCard.jsx
│   │       └── api/
│   │           └── client.js
│   └── dashboard/               ← Vite + React + Tailwind
│       ├── package.json
│       ├── vite.config.js
│       ├── index.html
│       └── src/
│           ├── App.jsx
│           ├── pages/
│           │   ├── OrdersTab.jsx
│           │   ├── StockTab.jsx
│           │   ├── CustomersTab.jsx
│           │   ├── DailyDashboard.jsx    ← Day-to-day operations
│           │   └── FinancialDashboard.jsx ← Monthly KPIs, margins, waste
│           ├── components/
│           │   ├── RevenueChart.jsx
│           │   ├── OrdersByChannel.jsx
│           │   ├── CostMarginChart.jsx
│           │   ├── WasteTracker.jsx
│           │   ├── DeliveryProfitability.jsx
│           │   ├── YoYGrowthChart.jsx
│           │   └── LowStockAlert.jsx
│           └── api/
│               └── client.js
└── scripts/
    └── migrate-excel.js         ← One-time migration (Phase 10)
```

---

## Airtable Data Model

**IMPORTANT:** The existing Airtable base has real data across 4 tables. The existing "Orders" table is kept as a read-only archive. All new app data goes into NEW tables created alongside the existing ones.

### Table: Customers (EXTENDS existing "Clients (B2C) - MASTER")

All existing fields are PRESERVED unchanged. The following fields are ADDED:

| New Field | Type | Notes |
|-----------|------|-------|
| WhatsApp Contact | Single Line Text | If not already captured in Phone |
| Default Delivery Address | Long Text | May overlap with existing Home address |
| Notes / Preferences | Long Text | Allergies, style preferences, etc. |
| App Orders | Link → App Orders | Separate from legacy "Orders (list)" field |
| App Total Spend | Rollup | SUM of linked App Orders → Final Price |
| App Order Count | Count | Count of linked App Orders |

The app reads ALL existing fields (Nickname, Segment, Key persons, Language, etc.) for display and search. It writes to both existing fields (Phone, Email, Home address, etc.) and new fields.

### Table: App Orders (NEW — separate from legacy Orders table)
| Field | Type | Notes |
|-------|------|-------|
| Order ID | Autonumber | Sequential, managed by Airtable |
| Customer | Link → Customers | Required — always linked |
| Customer Request | Long Text | What the customer asked for, e.g., "25 pink roses for birthday", "florist choice 300zł", "BRIDAL bouq - 50 white freesias" |
| Order Date | Date | Auto-set on creation |
| Required By | Date + Time | When customer needs it |
| Source | Single Select | Instagram / WhatsApp / Telegram / Wix / Flowwow / In-store / Other |
| Order Lines | Link → Order Lines | Individual flowers in this order |
| Flowers Cost Total | Rollup | SUM of Order Lines → Line Cost |
| Sell Price Total | Rollup | SUM of Order Lines → Line Sell Price |
| Delivery Fee | Currency (PLN) | 0 if pickup |
| Price Override | Currency (PLN) | If florist manually adjusts final price |
| Final Price | Formula | IF(Price Override, Price Override, Sell Price Total + Delivery Fee) |
| Delivery Type | Single Select | Delivery / Pickup |
| Payment Status | Single Select | Paid / Unpaid / Partial |
| Payment Method | Single Select | Mbank / Monobank / Revolut / PayPal / Cash / Card / Wix Online / Other |
| Notes Original | Long Text | Any language, kept as-is |
| Notes Translated | Long Text | Auto-translated to Russian |
| Greeting Card Text | Long Text | Keep in original language always |
| Status | Single Select | New / Accepted / In Preparation / Ready / Out for Delivery / Delivered / Picked Up / Cancelled |
| Assigned Delivery | Link → Deliveries | Created when type = Delivery |
| Wix Order ID | Single Line Text | For webhook deduplication |
| Created By | Single Select | Owner / Florist / Wix Webhook |

**Notes:**
- Payment Method is optional — in practice, many orders (~85%) don't record a specific method (likely cash). Do not require this field.
- Customer Request captures what the customer said verbally or in a message. It may differ from the actual bouquet composition the florist builds.
- **Status workflow differs by delivery type:**
  - Delivery orders: New → Accepted → In Preparation → Ready → Out for Delivery → Delivered
  - Pickup orders: New → Accepted → In Preparation → Ready → Picked Up (skips Out for Delivery / Delivered)
  - The florist app should show a "Mark as Picked Up" button when a Pickup order reaches "Ready" status. The delivery app never shows pickup orders.
  - **Cancellation:** When an order is cancelled, stock is NOT automatically returned. The florist must manually re-add quantities via the Stock Panel. This is intentional — flowers may have already been used or discarded.

### Table: Order Lines (NEW — junction table for bouquet composition)
| Field | Type | Notes |
|-------|------|-------|
| Order | Link → App Orders | Parent order |
| Stock Item | Link → Stock | Which flower/item (may be empty for unmatched Wix products) |
| Flower Name | Single Line Text | Flower/product name — auto-filled from Stock Item display name if linked, manually set for unmatched Wix items |
| Quantity | Number | Number of stems/units |
| Cost Price Per Unit | Number (currency) | Snapshot at time of order — copied from stock, not a live lookup. 0 if no stock link. |
| Sell Price Per Unit | Number (currency) | Snapshot at time of order — copied from stock, not a live lookup |
| Line Cost | Formula | Quantity × Cost Price Per Unit |
| Line Sell Price | Formula | Quantity × Sell Price Per Unit |

**IMPORTANT:** Cost and sell prices are COPIED from the Stock item at order creation time, not live lookups. This preserves accurate historical margins even if stock prices change later.

### Table: Stock / Inventory (NEW)
| Field | Type | Notes |
|-------|------|-------|
| Display Name | Single Line Text | e.g., "Hydrangea Pink", "Rose spray Julietta", "Tulips pink" |
| Purchase Name | Single Line Text | Name as listed by supplier (may differ from display name) |
| Category | Single Select | Roses, Hydrangeas, Tulips, Peonies, Ranunculus, Greenery, Fillers, Supplies, etc. |
| Current Quantity | Number | Stems/units on hand. Updated by florists (+/-) and auto-deducted on order creation |
| Unit | Single Select | Stems / Bunches / Pots / Pieces |
| Current Cost Price | Currency (PLN) | Per unit, from latest supplier purchase |
| Current Sell Price | Currency (PLN) | Per unit, what customers are charged |
| Markup Factor | Formula | Sell Price / Cost Price |
| Supplier | Single Select | Stojek / 4f / Stefan / Mateusz / Other |
| Reorder Threshold | Number | Alert owner when quantity drops below |
| Last Restocked | Date | When stock was last added |
| Dead/Unsold Stems | Number | Running waste count (for financial dashboard) |
| Supplier Notes | Long Text | |
| Active | Checkbox | Only active items shown in bouquet builder |
| Order Lines | Link → Order Lines | Shows usage history |

### Table: Deliveries (NEW)
| Field | Type | Notes |
|-------|------|-------|
| Linked Order | Link → App Orders | |
| Customer Name | Lookup | From Order → Customer → Name |
| Delivery Address | Long Text | Entered per-order — can differ from customer home address |
| Recipient Name | Single Line Text | Often different from customer (gift orders are very common) |
| Recipient Phone | Phone | Often different from customer phone |
| Customer Phone | Lookup | From Order → Customer → Phone |
| Order Contents | Lookup | From Order → Customer Request |
| Special Instructions | Lookup | From Order → Notes Translated |
| Greeting Card Text | Lookup | From Order → Greeting Card Text |
| Delivery Date | Date | |
| Delivery Time | Single Line Text | Freeform: "after 17:00", "10 to 12", "19:27-19:57" |
| Assigned Driver | Single Select | Timur / Nikita / Dmitri / Backup Driver |
| Status | Single Select | Pending / Out for Delivery / Delivered |
| Delivery Fee | Currency (PLN) | What customer paid for delivery (typically 35–50 zł) |
| Driver Payment Status | Single Select | Paid / Unpaid |
| Driver Notes | Long Text | |
| Delivered At | Date + Time | Set when driver marks delivered |

### Table: Stock Purchases (NEW — tracks incoming stock for financial dashboard)
| Field | Type | Notes |
|-------|------|-------|
| Purchase Date | Date | |
| Supplier | Single Select | Stojek / 4f / Stefan / Mateusz / Other |
| Flower | Link → Stock | Which stock item |
| Quantity Purchased | Number | Stems/units bought |
| Price Per Unit | Currency (PLN) | Purchase price |
| Total Cost | Formula | Quantity × Price Per Unit |
| Notes | Long Text | |

---

## Environment Variables (.env)

```
AIRTABLE_API_KEY=pat_xxxxx
AIRTABLE_BASE_ID=appXXXXX

# Table IDs — get from Airtable after creating tables
AIRTABLE_ORDERS_TABLE=tblXXXXX
AIRTABLE_ORDER_LINES_TABLE=tblXXXXX
AIRTABLE_CUSTOMERS_TABLE=tblXXXXX
AIRTABLE_STOCK_TABLE=tblXXXXX
AIRTABLE_DELIVERIES_TABLE=tblXXXXX
AIRTABLE_STOCK_PURCHASES_TABLE=tblXXXXX

# Legacy table (read-only — for reference)
AIRTABLE_LEGACY_ORDERS_TABLE=tblXXXXX

# Claude API for translation
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Wix webhook secret
WIX_WEBHOOK_SECRET=xxxxx

# Auth PINs
PIN_OWNER=1234
PIN_FLORIST=5678
PIN_DRIVER=9012

# Server
PORT=3001
NODE_ENV=development
```

---

## Build Phases

Build each phase completely before moving to the next. Each phase ends with a verification step.

### Phase 1: Project Scaffold + Airtable Connection
**Goal:** Monorepo structure, backend connects to Airtable, basic CRUD works.

**Pre-requisite (manual, by the owner):** Create the new Airtable tables (App Orders, Order Lines, Stock, Deliveries, Stock Purchases) in the existing "CRM Blossom (NEW)" base. Add the new fields to the Customers table. Do NOT modify or delete any existing tables or fields. Copy the table IDs into .env.

Tasks:
1. Initialize npm workspace monorepo with the directory structure above
2. Backend: Express with CORS (allow all origins for dev), dotenv, JSON body parser, structured error handling middleware
3. Airtable client config using `airtable` npm package — connection, table references from env vars
4. Generic Airtable service: `list(tableName, options)`, `getById(tableName, id)`, `create(tableName, fields)`, `update(tableName, id, fields)`, `deleteRecord(tableName, id)`. Options support: filterByFormula, sort, maxRecords, pageSize, fields (column filtering)
5. REST routes for each resource:
   - `GET /api/customers` — list with search (filterByFormula on Name, Nickname, Phone, Link)
   - `GET /api/customers/:id` — single customer with linked orders
   - `POST /api/customers` — create new
   - `PATCH /api/customers/:id` — update
   - `GET /api/orders` — list with filter by status, date range, source
   - `GET /api/orders/:id` — single order with expanded order lines and delivery
   - `POST /api/orders` — create order + order lines + delivery (transactional-style: create all related records)
   - `PATCH /api/orders/:id` — update (status changes, price edits, etc.)
   - `GET /api/stock` — list all active stock, sortable by category/name
   - `PATCH /api/stock/:id` — update quantity, prices
   - `POST /api/stock/:id/adjust` — increment/decrement quantity (for +/- buttons)
   - `GET /api/deliveries` — list with filter by date, status, driver
   - `PATCH /api/deliveries/:id` — update (mark delivered, assign driver, etc.)
   - `POST /api/stock-purchases` — record new stock delivery from supplier
6. PIN auth middleware: reads `X-Auth-PIN` header, matches against env vars, sets `req.role` to "owner" / "florist" / "driver". Returns 401 if invalid. Owner PIN grants all routes. Florist PIN: orders, customers, stock. Driver PIN: deliveries only.
7. `GET /api/health` — returns `{ status: "ok", timestamp: ... }`

**Airtable rate limiting:** The Airtable API allows 5 requests/second. The service layer should include a simple request queue (e.g., p-queue with concurrency 5, interval 1000ms) to avoid hitting limits during bulk operations like order creation (which requires 3+ API calls).

**Verification:** `curl -H "X-Auth-PIN: 1234" http://localhost:3001/api/customers` returns existing CRM data from Airtable.

---

### Phase 2: Florist App — Bouquet Builder + Order Form
**Goal:** Florists can compose bouquets from stock and create complete orders from a tablet.

This is the most complex and important phase. The bouquet builder is the core UI of the entire application.

**Scaffold:** Vite + React + Tailwind in `apps/florist/`. Configure proxy to backend (dev: `http://localhost:3001`).

**Screen 1: PIN Login**
- Simple PIN entry screen
- Stores PIN in React state (Context), sends with every API request as header
- Redirects to Order List on success

**Screen 2: Order List**
- Shows today's orders by default, with date picker to view other days
- Each order card shows: customer name, customer request text, status badge (color-coded), delivery/pickup indicator, final price, required time
- Filter by status: All / New / In Preparation / Ready / Out for Delivery
- Tap order → view detail (read-only from florist app, editable from dashboard)
- For Pickup orders in "Ready" status → show prominent "Mark as Picked Up" button (updates status → Picked Up)
- Floating "+" button → opens new order form

**Screen 3: New Order Form (multi-step)**

**Step 1: Customer (CRITICAL — search-first enforced)**
- Large search input at top. Searches as you type across: Name, Nickname, Phone, Instagram (Link field), Email
- Results show: Name, Nickname, Segment badge, Phone, last order info
- If customer has "DO NOT CONTACT" segment → show red warning
- Florist taps a result to select
- "Create New Customer" button appears ONLY after a search with no exact match
- New customer inline form: Name (required), Phone, Instagram handle, Language, Home address
- After customer is selected/created → automatically move to Step 2

**Step 2: Bouquet Builder (the core)**
- **Customer Request** text field at top — florist types what the customer asked for (e.g., "25 pink roses for birthday", "florist choice 300zł", "красные розы на день рождения"). This is the original request, not the final composition.
- **Flower search:** Text input that filters active stock items by Display Name. Shows matching flowers with: name, current quantity available, sell price per stem, category
- **Add flower:** Tap a flower → quantity input (number, default 1) → Add button. Flower appears in the bouquet list below.
- **Bouquet list:** Each line shows: flower name, quantity, sell price per unit, line total (qty × sell price). Quantity is editable inline with +/- or direct input. Swipe/tap to remove.
- **Running totals (always visible at bottom):**
  - Cost total: sum of (qty × cost price) for all lines — visible but grayed out (for florist awareness, not shown to customer)
  - Sell total: sum of (qty × sell price) for all lines
  - Margin: sell total - cost total (percentage)
- **Price override:** Toggle to manually set final price (useful for "florist choice" or negotiated prices). When active, overrides the calculated sell total.
- **Stock warnings:** If adding a flower would bring stock below reorder threshold → yellow warning. If stock would go to 0 or below → red warning (still allow — florist may have stock not yet entered).

**Step 3: Order Details**
- Source channel: Instagram / WhatsApp / Telegram / Wix / Flowwow / In-store / Other (single select)
- Delivery type: Delivery or Pickup (toggle)
- If Delivery:
  - Recipient name (pre-fill from customer name, but editable — gift orders are very common)
  - Recipient phone (pre-fill from customer phone, editable)
  - Delivery address (pre-fill from customer default address, editable)
  - Delivery date (date picker)
  - Delivery time (freetext: "after 17:00", "10 to 12", "19:27-19:57")
  - Greeting card text (long text, keep in original language)
  - Delivery fee (number, default 35 zł — editable)
  - Assigned driver: Timur / Nikita / Dmitri / Backup Driver (can leave unassigned)
- Required by: date + time (for Pickup orders this is the pickup time; for Delivery orders this is usually the same as delivery date/time and can be auto-filled from delivery fields)
- Notes (freetext, any language — will be auto-translated)
- Payment status: Paid / Unpaid / Partial
- Payment method: Mbank / Monobank / Revolut / PayPal / Cash / Card / Wix Online / Other (OPTIONAL — many orders don't record this)

**Step 4: Review + Submit**
- Full order summary: customer info, bouquet composition with prices, delivery details, total
- Edit buttons to go back to any step
- **Submit** button → API call creates:
  1. Order record (linked to customer)
  2. Order Line records for each flower (with cost and sell prices COPIED from current stock values)
  3. Delivery record (if delivery type)
  4. Stock quantity decremented for each flower used
  5. Translation triggered for Notes field (async, non-blocking)
- Success → redirect to order list with new order visible

**Screen 4: Stock Panel**
- List all stock items grouped by category
- Each item shows: display name, current quantity, unit, sell price, supplier
- **+/- buttons** for quick quantity adjustments (e.g., stems broke, miscounted)
- **"Receive Stock" button** → opens form:
  - Select existing stock item OR create new
  - Quantity received
  - Supplier (Stojek / 4f / Stefan / Mateusz / Other)
  - Cost price per unit
  - Updates: Stock quantity incremented, Current Cost Price updated, Last Restocked set, Stock Purchase record created
- **Low stock indicator:** Items below reorder threshold highlighted in orange/red

**All user-facing text in Russian.** Use a constants/translations file.

**Verification:** Create an order with 3 different flowers from tablet → check Airtable: 1 App Order record, 3 Order Line records, 1 Delivery record (if delivery), Stock quantities decremented correctly, cost/sell prices on Order Lines match what stock showed at creation time.

---

### Phase 3: Delivery App
**Goal:** Drivers see today's deliveries and mark them delivered.

Scaffold: Vite + React + Tailwind in `apps/delivery/`.

**PIN Login** — shared driver PIN, stores in state.

**Delivery List:**
- Shows today's deliveries sorted by delivery time (parse freeform time text for approximate sorting; unspecified times go to end)
- Filter by driver: All / Timur / Nikita / Dmitri / Backup Driver (since all drivers share one PIN, they see all deliveries — filter by name for convenience)
- Filter by status: Pending / All / Delivered
- Each delivery card shows:
  - **Recipient name** (prominent — this is who the driver meets)
  - Customer name (smaller, if different from recipient — "From: Anna")
  - Delivery address — **tap → opens Google Maps** via URL: `https://www.google.com/maps/search/?api=1&query={encoded_address}`
  - Delivery time window (e.g., "after 17:00")
  - Order contents / customer request
  - Greeting card text (so driver can verify card is included)
  - Special instructions (translated notes)
  - Recipient phone — **tap → opens dialer** via `tel:{number}`
  - Customer phone (if different from recipient)
  - Payment status badge: Paid (green) / Unpaid (red, driver needs to collect)
  - Driver payment status
- **"Mark Delivered" button:**
  - Updates Delivery status → Delivered
  - Sets Delivered At timestamp to now
  - Updates linked Order status → Delivered
  - Optional: driver can add a note before marking delivered

**All UI in Russian.**

**Verification:** Create delivery via Airtable, see it on phone. Tap address → Maps opens. Tap "Mark Delivered" → Airtable shows Delivered status and timestamp.

---

### Phase 4: Wix Webhook Integration
**Goal:** Wix eCommerce orders arrive automatically and create all necessary records.

Tasks:
1. `POST /api/webhook/wix` endpoint
2. Respond HTTP 200 **immediately** (Wix retries up to 12× on failure). Process async.
3. Parse Wix order payload: customer name, email, phone, shipping address, line items (product names + quantities + prices), order total, Wix order ID
4. **Deduplication:** Check if Wix Order ID already exists in App Orders → skip if found
5. **Customer matching:** Search existing Customers by phone OR email. If found → link. If not → create new Customer record (source = "Wix").
6. **Create App Order:** source = "Wix", status = "New", Payment Status = "Paid" (Wix orders are pre-paid), Payment Method = "Wix Online", Customer Request = concatenated line item descriptions
7. **Order Lines:** Attempt to match Wix product names to Stock items by Display Name. If match found → create Order Line with stock link and snapshot prices, deduct stock. If no match → create Order Line with flower name as text only, no stock link (florist will handle actual flower selection when preparing). This is a best-effort mapping.
8. **Delivery:** If shipping address present → create Delivery record. Recipient info from Wix shipping details.
9. **Trigger notification** (SSE event to connected florist apps)
10. Log all webhook events with full payload for debugging

**Verification:** POST test Wix payload → records appear in Airtable, notification fires.

---

### Phase 5: Translation Integration
**Goal:** Auto-translate order notes to Russian.

1. Translation service using `@anthropic-ai/sdk` package
2. Model: `claude-haiku-4-5-20251001` (cheapest, fastest)
3. System prompt:
   ```
   You are a translator. Translate the following text to Russian.
   If the text is already in Russian, return it unchanged.
   Return ONLY the translation with no additional commentary.
   ```
4. Hook into order creation: when Notes Original is non-empty, call translation async. Save result to Notes Translated. If translation fails → copy original to Notes Translated, log error, do NOT block order creation.
5. Can also be triggered manually from dashboard (re-translate button).

**Verification:** Create order with English notes → Notes Translated has Russian text in Airtable.

---

### Phase 6: Owner Dashboard — Day-to-Day Operations
**Goal:** Real-time operational overview + full data management.

Scaffold: Vite + React + Tailwind in `apps/dashboard/`. Optimized for desktop (1024px+).

**Tab 1: Orders**
- Full order list with search and filters: status, date range, source, delivery type, payment status
- Click order → full detail view with ALL fields editable
- Change status from any state (with confirmation for irreversible changes like Cancelled)
- Assign/reassign driver
- Edit bouquet composition (add/remove order lines)
- Edit prices, payment status/method
- View cost breakdown: flower costs, sell prices, margin per order

**Tab 2: Stock**
- Full inventory table grouped by category
- Columns: Display Name, Category, Quantity, Unit, Cost Price, Sell Price, Markup, Supplier, Reorder Threshold
- Items below threshold: orange row. Items at 0: red row.
- Inline edit: quantities, prices, threshold
- "Add New Stock Item" form
- "Receive Stock" button (same as florist app)
- View stock purchase history per item
- **Dead/Unsold stems** — owner can record waste per item (increments Dead/Unsold counter)

**Tab 3: Customers / CRM**
- Searchable table by name, nickname, phone, Instagram, email
- Click customer → full profile:
  - All contact info, segment badge, language
  - Key Person 1 and Key Person 2 with important dates (display, not mandatory)
  - All orders (from new App Orders table), total spend, order count
  - Legacy orders (from old Orders table — read-only reference)
  - Preferences/notes
- Edit customer details inline
- "DO NOT CONTACT" segment shown as prominent red warning

**Tab 4: Day-to-Day Dashboard**
- **Today's summary cards:** Orders count by status, orders needing attention (New, no driver assigned)
- **Today's revenue:** sum of Final Price for today's paid orders
- **Pending deliveries:** list of today's undelivered orders
- **Orders by source** — pie/donut chart (Instagram / WhatsApp / Telegram / Wix / Flowwow / In-store / Other)
- **Low stock alerts** — items below reorder threshold
- **New order notifications:** SSE-driven, sound + banner when Wix order arrives
- **Recent orders feed:** last 10 orders with status

**All UI in Russian.**

**Verification:** All data visible and editable. Create/edit/cancel orders from dashboard. View customer history. Charts render.

---

### Phase 7: Owner Dashboard — Financial KPIs
**Goal:** Replicate and improve on the analytical depth of the "Deliveries" tab from Blossom Audit spreadsheet.

This is a SEPARATE tab (Tab 5) focused on monthly/periodic business metrics. Data is calculated from Airtable records — not manually entered.

**Date range selector:** This month / Last month / Last 3 months / Last 12 months / Custom range. All metrics below recalculate based on selection.

**Revenue & Orders Section:**
- Total revenue (sum of Final Price for paid/partial orders)
- Revenue from flower sales vs. revenue from delivery fees (stacked bar chart, monthly)
- Average order value (revenue / order count)
- Number of bouquets sold (order count, excluding cancelled)
- Revenue by source channel (monthly breakdown, stacked bar)
- Revenue YoY% growth (compare current period to same period last year — requires historical data or at least one year of app usage)

**Cost & Margins Section:**
- Total flower purchase cost (sum from Stock Purchases table)
- Estimated revenue at 2.2× markup (cost × 2.2 — the standard markup used in the existing spreadsheet)
- Actual revenue vs estimated revenue gap
- Gross margin: (Revenue - Flower Cost) / Revenue × 100%
- Margin trend over time (line chart, monthly)

**Waste & Efficiency Section:**
- Total dead/unsold stems (from Stock table)
- Unrealised revenue: flower cost of unsold/dead stems (waste in PLN)
- % unrealised revenue: waste cost / total flower purchase cost × 100% (KEY metric from existing spreadsheet)
- Waste trend over time (line chart, monthly)

**Delivery Profitability Section:**
- Total delivery revenue (sum of Delivery Fee from orders with delivery type)
- Total delivery cost (sum of what was paid to drivers — if tracked, otherwise note as future feature)
- Delivery gain/loss: revenue - cost
- Pickup vs delivery ratio (pie chart)
- Average delivery fee

**Customer Metrics Section:**
- New customers this period (first order in period)
- Returning customers (had prior orders)
- New vs returning ratio
- Top 10 customers by spend
- Customer segment distribution (pie chart: Rare / Constant / New)

**Charts:** Use Recharts. All charts should be responsive and support the date range selector.

**Verification:** Dashboard loads with data from Airtable. Metrics are mathematically correct. Matches approximate figures from the existing spreadsheet for historical months (once enough data exists).

---

### Phase 8: New Order Notifications (SSE)
**Goal:** Florists see a real-time alert when Wix/Flowwow orders arrive.

1. SSE endpoint: `GET /api/events` — long-lived connection, sends events as they occur
2. When Wix webhook creates new order → push `{ type: "new_order", orderId, customerName, source }` to all connected clients
3. Florist app: `useNotifications` hook subscribes to SSE on mount
4. On event: show notification banner at top of screen + play notification sound (short chime)
5. Tapping the notification navigates to the new order
6. Fallback: if SSE connection drops, poll `GET /api/orders?status=New&since={lastCheck}` every 30 seconds
7. Dashboard app also subscribes (Tab 4 day-to-day dashboard shows live feed)

**Verification:** Open Florist app → send test webhook → notification appears within 3 seconds.

---

### Phase 9: Polish + Testing
**Goal:** Production-ready quality.

1. Error handling: toast notifications on frontend (non-blocking), structured JSON error responses from backend with meaningful messages
2. Loading states: skeleton screens for lists, spinner for form submissions
3. Empty states: "No orders today" / "No deliveries assigned" / "All stock levels OK" with appropriate illustrations or messages
4. Mobile responsiveness: test all 3 apps on actual devices (iPad for florist, iPhone for delivery, desktop for dashboard)
5. Form validation: required fields enforced, phone format basic check, price > 0, quantity > 0
6. Offline resilience: if API call fails, show retry button (not a full offline mode, but graceful degradation)
7. Deployment configs:
   - `vercel.json` for each frontend app (environment variables, build settings, rewrites for SPA routing)
   - Backend: Railway deployment with `railway.toml` or `Procfile`
   - Environment variables set in Vercel/Railway dashboards (never committed to repo)
8. `README.md` with: project overview, setup instructions, deployment steps, Airtable table setup guide
9. End-to-end test: create 5 orders through the full lifecycle — at least 1 delivery order (New → Accepted → In Preparation → Ready → Out for Delivery → Delivered) and at least 1 pickup order (New → Accepted → In Preparation → Ready → Picked Up) — using all 3 apps

---

### Phase 10: Excel Migration Script (Optional / Future)
**Goal:** Import historical order data from the SharePoint Excel into the new Airtable tables.

This is a complex parsing task because of the multi-row block structure:

1. Use `xlsx` npm package to read the Excel file
2. For each monthly tab (01–12): detect order block boundaries (each block starts with a non-empty customer row and ends with "Delivery (no data input here)")
3. Per block, extract:
   - Customer: parse Instagram URL, "WA +phone Name", plain name, or "flowwow From Name"
   - Date, total price, payment status, payment method
   - Customer request text (from row 2, column F area)
   - Flower lines: name + quantity (prices from STOCK/Tech.data lookup)
   - Delivery info: date, time, address, recipient, phone, card text
   - Driver name, delivery fee, driver payment status
4. Match customers against existing Airtable CRM (by Instagram URL → Link field, phone, or name)
5. Create App Order + Order Lines + Delivery records
6. Generate migration report CSV: matched customers, newly created customers, unmapped data, parsing errors
7. **Dry-run mode** (default): logs everything, writes nothing. Pass `--execute` to actually write to Airtable.
8. Idempotency: track migrated order IDs to prevent duplicates on re-run

---

## Phase 2+ Backlog (Not In Scope — For Future Reference)

- **Weddings/Events pipeline** — Separate order type: заявка → офер → оплачена → подготовка → монтаж → демонтаж закончен. Different fields: bride/client, event date, venue, contract signing, cost vs revenue per event.
- **B2B client handling** — Separate CRM table, different fields
- **Instagram/WhatsApp/Telegram auto-intake** — Bot or Meta Business API integration
- **Flowwow API integration** — If they have an API/webhook for incoming orders
- **Auto-segment calculation** — Assign Rare/Constant/New based on order frequency/recency
- **Recipe-based auto-deduction** — Predefined bouquet recipes that auto-fill the bouquet builder
- **Supplier ordering** — Place purchase orders through the app
- **Multi-language UI** — Ukrainian and Polish interface translations
- **Marketing campaign management** — Campaign creation and tracking in-app
- **Duty roster / shift management** — Currently in "дежурные" Excel tab

---

## Key Technical Decisions

### Airtable API Usage
- Official `airtable` npm package
- Rate limit: 5 req/sec — use p-queue or similar for concurrency control
- `filterByFormula` for server-side filtering (never fetch all records and filter in JS)
- Linked records return record IDs — for customer search, fetch customers directly (not through order lookups)
- Order creation is multi-step (Order → Order Lines → Delivery → Stock updates): handle sequentially with error recovery. If Order Line creation fails mid-way, the Order still exists — log the error and let the florist retry or fix in dashboard.

### Price Snapshotting
When creating Order Lines, COPY the current cost and sell prices from the Stock item. Do NOT use Airtable Lookups for prices on Order Lines — those would change retroactively when stock prices update, making historical margin calculations incorrect.

### Bouquet Builder Performance
The florist builds bouquets while the customer is waiting or on the phone. Latency matters.
- Pre-fetch all active stock items on page load (typically <200 items)
- Client-side search/filter (no API call per keystroke)
- Only call API when submitting the order
- Show stale stock quantities with a "last refreshed" timestamp; manual refresh button

### Customer Search
Search across: Name, Nickname, Phone, Link (Instagram), Email. Use Airtable `filterByFormula` with OR + SEARCH:
```
OR(
  SEARCH(LOWER("{query}"), LOWER(Name)),
  SEARCH(LOWER("{query}"), LOWER(Nickname)),
  SEARCH("{query}", Phone),
  SEARCH(LOWER("{query}"), LOWER(Link)),
  SEARCH(LOWER("{query}"), LOWER(Email))
)
```

### Two Dashboards
1. **Day-to-day** (Tab 4): Real-time operational view. What needs attention NOW. Auto-refreshes.
2. **Financial** (Tab 5): Monthly/periodic business analytics. Mirrors the depth of the existing "Deliveries" spreadsheet. On-demand calculation.

### Mobile-First CSS
- Florist app: optimized for iPad (768px+), functional on iPhone (375px)
- Delivery app: optimized for iPhone (375px), touch-friendly cards
- Dashboard: optimized for desktop (1024px+), usable on iPad landscape

### PIN Auth
- `X-Auth-PIN` header on every request
- Backend checks against env vars → returns role
- Owner: all routes. Florist: orders, customers, stock. Driver: deliveries only.
- No JWT, no sessions, no cookies — completely stateless

---

## Coding Standards

- ES modules (`import/export`) throughout
- `async/await` only (no `.then()` chains)
- Express routes are thin — all business logic in service files
- Functional React components with hooks (no classes)
- State management: React Context + useReducer for global state (auth, notifications). Local state for form data.
- CSS: Tailwind utility classes only, no custom CSS files
- All user-facing text in Russian — use a `translations.js` constants file with keys like `t.orders.title`, `t.stock.lowAlert`, etc.
- Comments in English (for Claude Code and future maintainability)
- All prices in PLN — display with "zł" suffix, store as plain numbers
- Console.error for all caught errors (helps debugging), but show user-friendly Russian messages in UI toasts
