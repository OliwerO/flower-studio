# Airtable Setup Guide

Open your existing base "CRM Blossom (NEW)" for all steps below.

---

## Step 1 — Import the 5 core tables

For each CSV file, in Airtable:
**+ Add or import → Import a CSV file → upload the file → name the table exactly as shown below**

| File | Table name (exact) |
|------|--------------------|
| 01_app-orders.csv | App Orders |
| 02_order-lines.csv | Order Lines |
| 03_stock.csv | Stock |
| 04_deliveries.csv | Deliveries |
| 05_stock-purchases.csv | Stock Purchases |

After importing, delete the sample data row in each table — it was only there to help Airtable detect field types.

---

## Step 2 — Fix field types after import

Airtable imports everything as plain text. Change these fields:

### App Orders
| Field | Change to |
|-------|-----------|
| Order Date | Date |
| Required By | Date — enable "Include time" |
| Source | Single Select → options: Instagram, WhatsApp, Telegram, Wix, Flowwow, In-store, Other |
| Delivery Type | Single Select → options: Delivery, Pickup |
| Delivery Fee | Currency (PLN) |
| Price Override | Currency (PLN) |
| Payment Status | Single Select → options: Paid, Unpaid, Partial |
| Payment Method | Single Select → options: Mbank, Monobank, Revolut, PayPal, Cash, Card, Wix Online, Other |
| Status | Single Select → options: New, Accepted, In Preparation, Ready, Out for Delivery, Delivered, Picked Up, Cancelled |
| Created By | Single Select → options: Owner, Florist, Wix Webhook |

### Order Lines
| Field | Change to |
|-------|-----------|
| Quantity | Number (integer) |
| Cost Price Per Unit | Currency (PLN) |
| Sell Price Per Unit | Currency (PLN) |

### Stock
| Field | Change to |
|-------|-----------|
| Category | Single Select → options: Roses, Hydrangeas, Tulips, Peonies, Ranunculus, Greenery, Fillers, Supplies, Other |
| Current Quantity | Number (integer) |
| Unit | Single Select → options: Stems, Bunches, Pots, Pieces |
| Current Cost Price | Currency (PLN) |
| Current Sell Price | Currency (PLN) |
| Reorder Threshold | Number (integer) |
| Last Restocked | Date |
| Dead/Unsold Stems | Number (integer) |
| Active | Checkbox |
| Supplier | Single Select → options: Stojek, 4f, Stefan, Mateusz, Other |

### Deliveries
| Field | Change to |
|-------|-----------|
| Recipient Phone | Phone number |
| Delivery Date | Date |
| Assigned Driver | Single Select → options: Timur, Nikita, Dmitri, Backup Driver |
| Status | Single Select → options: Pending, Out for Delivery, Delivered |
| Delivery Fee | Currency (PLN) |
| Driver Payment Status | Single Select → options: Paid, Unpaid |
| Delivered At | Date — enable "Include time" |

### Stock Purchases
| Field | Change to |
|-------|-----------|
| Purchase Date | Date |
| Supplier | Single Select → options: Stojek, 4f, Stefan, Mateusz, Other |
| Quantity Purchased | Number (integer) |
| Price Per Unit | Currency (PLN) |

---

## Step 3 — Add linked fields, formulas, rollups manually

These cannot be imported from CSV. Add them field by field in each table.

### App Orders — add these fields:
| Field | Type | Configuration |
|-------|------|---------------|
| Customer | Link to another record | → Clients (B2C) - MASTER table |
| Order Lines | Link to another record | → Order Lines table |
| Assigned Delivery | Link to another record | → Deliveries table |
| Flowers Cost Total | Rollup | From: Order Lines → Line Cost → SUM |
| Sell Price Total | Rollup | From: Order Lines → Line Sell Price → SUM |
| Final Price | Formula | `IF({Price Override}, {Price Override}, {Sell Price Total} + {Delivery Fee})` |
| Order ID | Autonumber | (add as first field, replace the default Name field if desired) |

### Order Lines — add these fields:
| Field | Type | Configuration |
|-------|------|---------------|
| Order | Link to another record | → App Orders table |
| Stock Item | Link to another record | → Stock table |
| Line Cost | Formula | `{Quantity} * {Cost Price Per Unit}` |
| Line Sell Price | Formula | `{Quantity} * {Sell Price Per Unit}` |

### Stock — add these fields:
| Field | Type | Configuration |
|-------|------|---------------|
| Markup Factor | Formula | `{Current Sell Price} / {Current Cost Price}` |
| Order Lines | Link to another record | → Order Lines table |

### Deliveries — add these fields:
| Field | Type | Configuration |
|-------|------|---------------|
| Linked Order | Link to another record | → App Orders table |
| Customer Name | Lookup | Via: Linked Order → Customer → Name |
| Customer Phone | Lookup | Via: Linked Order → Customer → Phone |
| Order Contents | Lookup | Via: Linked Order → Customer Request |
| Special Instructions | Lookup | Via: Linked Order → Notes Translated |
| Greeting Card Text | Lookup | Via: Linked Order → Greeting Card Text |

### Stock Purchases — add these fields:
| Field | Type | Configuration |
|-------|------|---------------|
| Flower | Link to another record | → Stock table |
| Total Cost | Formula | `{Quantity Purchased} * {Price Per Unit}` |

---

## Step 4 — Add new fields to existing Clients (B2C) - MASTER table

**Do NOT delete or modify any existing fields.** Only add:

| Field | Type |
|-------|------|
| WhatsApp Contact | Single line text |
| Default Delivery Address | Long text |
| Notes / Preferences | Long text |
| App Orders | Link to another record → App Orders table |
| App Total Spend | Rollup → From: App Orders → Final Price → SUM |
| App Order Count | Count → Count of linked App Orders |

---

## Step 5 — Import the 3 audit-improvement tables (Phase 2+)

Same process as Step 1: import each CSV, name the table exactly.

| File | Table name (exact) |
|------|--------------------|
| 06_webhook-log.csv | Webhook Log |
| 07_marketing-spend.csv | Marketing Spend |
| 08_stock-loss-log.csv | Stock Loss Log |

After importing, delete the demo rows (they exist to seed single-select options).

### Webhook Log — fix field types:
| Field | Change to |
|-------|-----------|
| Timestamp | Date — enable "Include time" |
| Status | Single Select (should auto-detect: Success, Failed, Duplicate) |

Then add manually:
| Field | Type | Configuration |
|-------|------|---------------|
| App Order | Link to another record | → App Orders table |

### Marketing Spend — fix field types:
| Field | Change to |
|-------|-----------|
| Month | Date |
| Channel | Single Select (should auto-detect: Instagram, WhatsApp, Telegram, Wix, Flowwow, In-store, Other) |
| Amount | Currency (PLN) |

### Stock Loss Log — fix field types:
| Field | Change to |
|-------|-----------|
| Date | Date |
| Quantity | Number (integer) |
| Reason | Single Select (should auto-detect: Wilted, Damaged, Overstock, Other) |

Then add manually:
| Field | Type | Configuration |
|-------|------|---------------|
| Stock Item | Link to another record | → Stock table |
| Loss Value | Formula | `{Quantity} * LOOKUP({Stock Item}, 'Current Cost Price')` — or simpler: add a "Cost Per Unit" number field and use `{Quantity} * {Cost Per Unit}` |

---

## Step 6 — Add new fields to existing App Orders table

These support prep time tracking:

| Field | Type |
|-------|------|
| Prep Started At | Date — enable "Include time" |
| Prep Ready At | Date — enable "Include time" |

---

## Step 7 — Add new field to existing Deliveries table

| Field | Type |
|-------|------|
| Delivery Result | Single Select → options: Success, Not Home, Wrong Address, Refused, Incomplete |

---

## Step 8 — Copy ALL table IDs into .env

In Airtable, right-click each table name → **API documentation**.
The URL will contain the table ID: `https://airtable.com/appXXXXX/tblXXXXX/...`

Copy each ID into `backend/.env`:

```
AIRTABLE_API_KEY=pat_xxxxx       ← from airtable.com/account
AIRTABLE_BASE_ID=appXXXXX        ← from the base URL

AIRTABLE_CUSTOMERS_TABLE=tblXXXXX     ← Clients (B2C) - MASTER
AIRTABLE_ORDERS_TABLE=tblXXXXX        ← App Orders
AIRTABLE_ORDER_LINES_TABLE=tblXXXXX   ← Order Lines
AIRTABLE_STOCK_TABLE=tblXXXXX         ← Stock
AIRTABLE_DELIVERIES_TABLE=tblXXXXX    ← Deliveries
AIRTABLE_STOCK_PURCHASES_TABLE=tblXXXXX ← Stock Purchases
AIRTABLE_LEGACY_ORDERS_TABLE=tblXXXXX ← Orders (LEGACY) — read-only

# New tables (audit improvements)
AIRTABLE_WEBHOOK_LOG_TABLE=tblXXXXX   ← Webhook Log
AIRTABLE_MARKETING_SPEND_TABLE=tblXXXXX ← Marketing Spend
AIRTABLE_STOCK_LOSS_LOG_TABLE=tblXXXXX ← Stock Loss Log
```

---

## Step 9 — Verify

Start the backend and run:
```bash
curl -H "X-Auth-PIN: 1234" http://localhost:3001/api/customers
```

You should see your existing 1,059 CRM clients returned as JSON.
