# Flower Studio Management App — CLAUDE.md

## Project Overview

Web app replacing multi-spreadsheet workflow for **Blossom**, a flower studio in Krakow. Manages orders (6 channels), flower inventory, customer CRM (extends existing Airtable base with ~1,059 B2C clients), deliveries, and owner dashboards.

**Users:** 1 owner (desktop), 2–4 florists (tablet/phone), 2 delivery drivers (phone).
**UI language:** Russian. Data arrives in RU/UK/PL/EN/TR — auto-translate to Russian via Claude API.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Database | Airtable (existing base — extend, don't replace) |
| Backend | Node.js + Express |
| Frontend | 3 React apps (Vite + Tailwind): florist, delivery, dashboard |
| Translation | Anthropic Claude API (Haiku) |
| Hosting | Vercel (frontends), Railway (backend) |
| Auth | Stateless PIN per role via `X-Auth-PIN` header |

---

## Build Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Backend scaffold + Airtable CRUD |
| 2 | Done | Florist app — bouquet builder + order form |
| 3 | Done | Delivery app — driver task board |
| 4 | Done | Wix webhook — full pipeline + logging + dedup |
| 5 | Done | Translation integration (Claude Haiku) |
| 6 | Done | Owner dashboard — day-to-day operations |
| 7 | Done | Owner dashboard — financial KPIs |
| 8 | Done | SSE notifications (florist + dashboard) |
| 9 | Not started | Polish + testing + deployment |
| 10 | Future | Excel migration script |

---

## Airtable Schema (compact reference)

**Existing table — DO NOT delete fields:**
- **Clients (B2C) - MASTER**: Nickname, Name, Segment, Link, Source, Language, Phone, Email, Home address, Sex/Business, Orders (legacy), Key persons, Campaigns, etc.
- **Orders (LEGACY)**: Read-only archive. DO NOT WRITE.

**App tables (created by us):**
- **App Orders**: Order ID (auto), Customer (link), Customer Request, Order Date, Required By, Source, Order Lines (link), Flowers Cost Total (rollup), Sell Price Total (rollup), Delivery Fee, Price Override, Final Price (formula), Delivery Type, Payment Status, Payment Method (optional), Notes Original, Notes Translated, Greeting Card Text, Status (New/Accepted/In Preparation/Ready/Out for Delivery/Delivered/Picked Up/Cancelled), Assigned Delivery (link), Wix Order ID, Created By
- **Order Lines**: Order (link), Stock Item (link, may be empty), Flower Name, Quantity, Cost Price Per Unit (snapshot), Sell Price Per Unit (snapshot), Line Cost (formula), Line Sell Price (formula)
- **Stock**: Display Name, Purchase Name, Category, Current Quantity, Unit, Current Cost Price, Current Sell Price, Markup Factor (formula), Supplier, Reorder Threshold, Last Restocked, Dead/Unsold Stems, Active (checkbox), Order Lines (link)
- **Deliveries**: Linked Order, Customer Name (lookup), Delivery Address, Recipient Name, Recipient Phone, Customer Phone (lookup), Order Contents (lookup), Special Instructions (lookup), Greeting Card Text (lookup), Delivery Date, Delivery Time (freetext), Assigned Driver, Status (Pending/Out for Delivery/Delivered), Delivery Fee, Driver Payment Status, Driver Notes, Delivered At
- **Stock Purchases**: Purchase Date, Supplier, Flower (link), Quantity Purchased, Price Per Unit, Total Cost (formula), Notes

---

## Key Technical Decisions

- **Price snapshotting:** Order Lines COPY cost/sell prices at creation (not live lookups) — preserves historical margins
- **Airtable rate limit:** 5 req/sec — use p-queue for concurrency control
- **Airtable filtering:** Always use `filterByFormula` server-side, never fetch-all-then-filter
- **Bouquet builder perf:** Pre-fetch all active stock on load (<200 items), client-side search, API only on submit
- **Customer search formula:** `OR(SEARCH(LOWER(query), LOWER(Name)), SEARCH(LOWER(query), LOWER(Nickname)), SEARCH(query, Phone), SEARCH(LOWER(query), LOWER(Link)), SEARCH(LOWER(query), LOWER(Email)))`
- **Order creation:** Multi-step (Order → Lines → Delivery → Stock updates) — sequential with error recovery
- **Status workflows:** Delivery: New→Accepted→In Preparation→Ready→Out for Delivery→Delivered. Pickup: skips last two, ends with Picked Up. Cancellation does NOT auto-return stock.
- **PIN auth:** `X-Auth-PIN` header, stateless. Owner=all, Florist=orders+customers+stock, Driver=deliveries only.
- **Responsive targets:** Florist=iPad (768px+), Delivery=iPhone (375px), Dashboard=desktop (1024px+)

---

## Coding Standards

- ES modules (`import/export`), `async/await` only
- Express routes thin — business logic in service files
- Functional React + hooks, React Context + useReducer for global state
- Tailwind utility classes only, no custom CSS
- All UI text in Russian via `translations.js` (`t.orders.title`, etc.)
- Comments in English
- Prices in PLN, display with "zł", store as numbers
- Console.error for caught errors, user-friendly Russian toasts in UI

---

## Environment Variables

```
AIRTABLE_API_KEY, AIRTABLE_BASE_ID
AIRTABLE_ORDERS_TABLE, AIRTABLE_ORDER_LINES_TABLE, AIRTABLE_CUSTOMERS_TABLE
AIRTABLE_STOCK_TABLE, AIRTABLE_DELIVERIES_TABLE, AIRTABLE_STOCK_PURCHASES_TABLE
AIRTABLE_LEGACY_ORDERS_TABLE (read-only)
ANTHROPIC_API_KEY
WIX_WEBHOOK_SECRET
PIN_OWNER, PIN_FLORIST, PIN_DRIVER
PORT=3001, NODE_ENV
```
