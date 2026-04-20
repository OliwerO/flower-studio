# Flower Studio — Technical Breakdown

> Full architecture reference for the Blossom flower studio management app.
> Built March 2026 as a learning project — first production web application.
> Use this document as a template and reference for future app builds.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Stack & Technology Choices](#stack--technology-choices)
3. [Project Structure](#project-structure)
4. [Data Model (Airtable)](#data-model-airtable)
5. [Backend Architecture](#backend-architecture)
6. [API Reference](#api-reference)
7. [Frontend Architecture](#frontend-architecture)
8. [Key Patterns & Design Decisions](#key-patterns--design-decisions)
9. [Authentication & Security](#authentication--security)
10. [Real-Time Features (SSE)](#real-time-features-sse)
11. [AI Integration](#ai-integration)
12. [Deployment](#deployment)
13. [What Was Built in Each Phase](#what-was-built-in-each-phase)
14. [Lessons Learned](#lessons-learned)

---

## Project Overview

**Problem:** A small flower studio in Krakow manages orders across 6 channels (Instagram, WhatsApp, Telegram, Wix, Flowwow, in-store) using Excel spreadsheets and manual Airtable CRM entries. Orders are multi-row blocks in Excel with mixed data layouts. The owner needs KPIs that require manual calculation in Google Sheets.

**Solution:** Three role-specific web apps sharing one backend and one Airtable database:

| App | User | Device | Purpose |
|-----|------|--------|---------|
| **Florist** | 2-4 florists | Tablet/Phone | Compose bouquets, create orders, manage stock |
| **Delivery** | 2 drivers | Phone | View deliveries, navigate, mark delivered |
| **Dashboard** | 1 owner | Desktop | Full data management, financial KPIs, CRM |

**Users:** 5-7 total (1 owner, 2-4 florists, 2 drivers). All UI text in Russian with English toggle for debugging.

**Scale:** ~40-125 orders/month, ~200 stock items, ~1,059 existing CRM customers.

---

## Stack & Technology Choices

| Layer | Technology | Why This |
|-------|-----------|----------|
| **Database** | Airtable | Already in use for CRM (~1,059 clients). Extending existing base avoids migration risk. API-first, no SQL needed. Tradeoff: 5 req/sec rate limit, no joins. |
| **Backend** | Node.js + Express | Lightweight, same language as frontend (JS everywhere). Express is simple, well-documented, minimal abstraction. |
| **Frontend** | React (Vite) + Tailwind CSS | React for component reuse across 3 apps. Vite for fast dev builds. Tailwind for rapid styling without CSS files. |
| **AI** | Claude Haiku (Anthropic) | Cheapest/fastest model for text parsing and translation. Used for order intake parsing and note translation. |
| **Hosting (FE)** | Vercel (free tier) | Zero-config React deployment. Automatic HTTPS. |
| **Hosting (BE)** | Railway (~$5/mo) | Simple Node.js deployment. Built-in env var management. |
| **Auth** | PIN-based (stateless) | 5-7 users, no registration flow needed. PIN in header per request. No JWT complexity. |

### Why NOT these alternatives?

| Alternative | Why Rejected |
|-------------|-------------|
| PostgreSQL/MySQL | Overkill for 5 users. Airtable already has real CRM data. Would need migration. |
| Next.js (fullstack) | Three separate apps with different layouts needed. SSR unnecessary for internal tool. |
| Firebase | Vendor lock-in, Firestore query model doesn't fit relational data well. |
| Redux/Zustand | React Context sufficient for PIN + toast + language. No complex shared state. |
| JWT auth | 5 users, all internal. PIN simplicity wins over JWT session management. |

---

## Project Structure

```
flower-studio/
├── CLAUDE.md                          # AI assistant instructions
├── package.json                       # Root workspace config (npm workspaces)
├── .env.dev                           # Dev environment (dev Airtable base)
├── .env                               # Production environment
│
├── backend/
│   ├── package.json
│   └── src/
│       ├── index.js                   # Express server entry
│       ├── config/
│       │   └── airtable.js            # Airtable client + table ID registry
│       ├── routes/
│       │   ├── auth.js                # PIN verification
│       │   ├── orders.js              # Order CRUD + bulk enrichment
│       │   ├── customers.js           # CRM search + insights
│       │   ├── stock.js               # Inventory + velocity tracking
│       │   ├── deliveries.js          # Delivery management
│       │   ├── dashboard.js           # Day-to-day operational data
│       │   ├── analytics.js           # Financial KPIs
│       │   ├── stockPurchases.js      # Supplier deliveries
│       │   ├── webhook.js             # Wix eCommerce receiver
│       │   ├── events.js              # SSE real-time broadcasts
│       │   └── intake.js              # AI text-to-order parser
│       ├── services/
│       │   ├── airtable.js            # Generic Airtable CRUD with rate limiting
│       │   ├── notifications.js       # SSE client management + broadcast
│       │   ├── wix.js                 # Wix webhook processing
│       │   └── intake-parser.js       # Claude AI text parsing
│       ├── middleware/
│       │   ├── auth.js                # PIN validation + role authorization
│       │   └── errorHandler.js        # Central error formatting
│       └── utils/
│           └── sanitize.js            # Formula injection prevention
│
├── apps/
│   ├── florist/                       # Vite + React + Tailwind
│   │   └── src/
│   │       ├── App.jsx                # Router + providers
│   │       ├── translations.js        # Proxy-based i18n (EN/RU)
│   │       ├── guideContent.js        # Help FAQ content
│   │       ├── pages/                 # LoginPage, OrderListPage, NewOrderPage,
│   │       │                          #   OrderDetailPage, StockPanelPage
│   │       ├── components/            # OrderCard, StockItem, HelpPanel,
│   │       │   └── steps/             #   Step1-4 order form wizard
│   │       ├── context/               # AuthContext, ToastContext, LanguageContext
│   │       ├── hooks/                 # useNotifications (SSE)
│   │       └── api/client.js          # Axios with PIN interceptor
│   │
│   ├── delivery/                      # Vite + React + Tailwind
│   │   └── src/
│   │       ├── App.jsx
│   │       ├── translations.js
│   │       ├── guideContent.js
│   │       ├── pages/                 # LoginPage, DeliveryListPage
│   │       ├── components/            # DeliveryCard, DeliverySheet, MapView, HelpPanel
│   │       ├── context/               # AuthContext, ToastContext, LanguageContext
│   │       ├── hooks/                 # useNotifications (SSE)
│   │       └── api/client.js
│   │
│   └── dashboard/                     # Vite + React + Tailwind
│       └── src/
│           ├── App.jsx                # No router — single-page tabbed layout
│           ├── translations.js
│           ├── guideContent.js
│           ├── pages/                 # DashboardPage (tab container)
│           ├── components/            # OrdersTab, StockTab, CustomersTab,
│           │   └── steps/             #   DayToDayTab, FinancialTab, NewOrderTab,
│           │                          #   OrderDetailPanel, CustomerDetailView, CustomerDrawer,
│           │                          #   KanbanBoard, SourceChart, SummaryCard, etc.
│           ├── context/               # ToastContext, LanguageContext (no AuthContext)
│           ├── hooks/                 # useNotifications (SSE)
│           └── api/client.js
│
└── scripts/                           # Migration & maintenance utilities
```

**Key structural decision:** Three separate Vite apps, not one monolith. Each app has its own build, its own Vercel deployment, and its own set of translations. This means some code is duplicated (context providers, API client, step components) — the tradeoff is simpler deployment and no cross-app coupling.

---

## Data Model (Airtable)

Airtable is used as both the database and the admin UI (the owner can always fall back to viewing raw data in Airtable's web interface).

### Tables

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   Customers     │◄────│  App Orders   │────►│ Order Lines  │
│  (existing CRM) │     │   (NEW)       │     │   (NEW)      │
│  ~1,059 records │     │               │     │ junction tbl │
└─────────────────┘     └──────┬───────┘     └──────┬──────┘
                               │                     │
                               ▼                     ▼
                        ┌──────────────┐     ┌─────────────┐
                        │  Deliveries  │     │    Stock     │
                        │   (NEW)      │     │   (NEW)     │
                        └──────────────┘     └──────┬──────┘
                                                    │
                                              ┌─────┴───────┐
                                              │   Stock      │
                                              │  Purchases   │
                                              │   (NEW)      │
                                              └─────────────┘
```

### Customers (extends existing "Clients (B2C) - MASTER")
Existing fields preserved (Nickname, Name, Segment, Phone, Email, Link, Language, Key Persons, etc.). New fields added:
- `App Orders` — Link to App Orders table
- `App Total Spend` — Rollup SUM of linked orders
- `App Order Count` — Count of linked orders
- `Notes / Preferences` — Long text for allergies, style preferences

### App Orders
| Field | Type | Notes |
|-------|------|-------|
| Order ID | Autonumber | |
| Customer | Link → Customers | Required |
| Customer Request | Long Text | Original ask (e.g. "25 pink roses for birthday") |
| Order Date | Date | Auto-set |
| Source | Single Select | Instagram / WhatsApp / Telegram / Wix / Flowwow / In-store / Other |
| Order Lines | Link → Order Lines | Individual flowers |
| Delivery Fee | Currency (PLN) | |
| Price Override | Currency (PLN) | Manual total override |
| Final Price | Formula | `IF(Price Override, Price Override, Sell Total + Delivery Fee)` |
| Delivery Type | Single Select | Delivery / Pickup |
| Payment Status | Single Select | Paid / Unpaid / Partial |
| Payment Method | Single Select | Optional |
| Status | Single Select | New → Accepted → Ready → Out for Delivery → Delivered (or Picked Up) |
| Wix Order ID | Single Line | Webhook deduplication key |

### Order Lines (junction table)
| Field | Type | Notes |
|-------|------|-------|
| Order | Link → App Orders | |
| Stock Item | Link → Stock | May be empty (unmatched Wix products) |
| Flower Name | Single Line | Display name |
| Quantity | Number | Stems/units |
| Cost Price Per Unit | Number | **Snapshot** — copied at creation, not a live lookup |
| Sell Price Per Unit | Number | **Snapshot** — copied at creation, not a live lookup |
| Line Cost | Formula | Quantity x Cost Price |
| Line Sell Price | Formula | Quantity x Sell Price |

> **Critical pattern:** Prices are **snapshotted** at order creation time. If you used Airtable Lookups instead, changing a stock price would retroactively alter all historical order margins. Snapshots preserve accurate financial history.

### Stock / Inventory
| Field | Type | Notes |
|-------|------|-------|
| Display Name | Single Line | What florists see |
| Category | Single Select | Roses, Hydrangeas, Greenery, etc. |
| Current Quantity | Number | Live count, updated by adjustments |
| Current Cost Price | Currency | From latest supplier purchase |
| Current Sell Price | Currency | Customer-facing price |
| Supplier | Single Select | Stojek / 4f / Stefan / Mateusz / Other |
| Reorder Threshold | Number | Alert when qty drops below |
| Dead/Unsold Stems | Number | Running waste counter |
| Active | Checkbox | Only active items in bouquet builder |

### Deliveries
| Field | Type | Notes |
|-------|------|-------|
| Linked Order | Link → App Orders | |
| Delivery Address | Long Text | Per-order (may differ from customer home) |
| Recipient Name | Single Line | Often different from customer (gifts) |
| Recipient Phone | Phone | |
| Delivery Date | Date | |
| Delivery Time | Single Line | Freeform ("after 17:00", "10-12") |
| Assigned Driver | Single Select | Timur / Nikita / Dmitri |
| Status | Single Select | Pending → Out for Delivery → Delivered |
| Delivered At | Date + Time | Set when driver marks delivered |

### Stock Purchases
Tracks incoming flower deliveries from suppliers. Used for financial KPI calculations (total flower cost, margin analysis).

---

## Backend Architecture

### Server Setup (`index.js`)

```
Express Server (port 3001)
  ├── Helmet (security headers)
  ├── CORS (all origins in dev, whitelist in prod)
  ├── JSON body parser (with raw body capture for webhooks)
  ├── Auth middleware (PIN → role)
  ├── Route handlers (11 route files)
  ├── Error handler middleware
  └── Graceful shutdown (drains connections)
```

### Airtable Service Layer

The generic CRUD service (`services/airtable.js`) wraps the Airtable npm package:

- `list(tableId, options)` — Fetch with filterByFormula, sort, pagination
- `getById(tableId, recordId)` — Single record
- `create(tableId, fields)` — Insert
- `update(tableId, recordId, fields)` — Patch
- `deleteRecord(tableId, recordId)` — Remove

**Rate limiting:** Airtable allows 5 requests/second. A `p-queue` instance enforces this with concurrency 5, interval 1000ms. Without this, bulk operations (order creation = 3+ API calls) would hit 429 errors.

### Request Flow

```
Client Request
  → CORS check
  → JSON parse
  → Auth middleware (PIN → role)
  → Route handler
    → Service layer (Airtable CRUD, rate-limited)
    → Response
  → Error handler (if error)
```

### Bulk Enrichment Pattern

The biggest performance optimization. Instead of N+1 queries:

```
BAD:  50 orders → 50 customer lookups → 50 API calls (10 seconds)
GOOD: 50 orders → extract 50 customer IDs → 1 bulk fetch → attach in memory
```

Implementation uses `OR(RECORD_ID()="x", RECORD_ID()="y", ...)` formula to batch-fetch linked records in a single API call.

---

## API Reference

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/verify` | None | Verify PIN, returns role + driverName |

Rate limited: 5 attempts per 15 minutes per IP.

### Orders
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orders` | Florist+ | List orders (filterable by status, date, source, payment) |
| GET | `/api/orders/:id` | Florist+ | Single order with lines, customer, delivery |
| POST | `/api/orders` | Florist+ | Create order + lines + delivery + deduct stock |
| PATCH | `/api/orders/:id` | Florist+ | Update status, prices, payment, notes |

### Customers
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/customers` | Florist+ | Search by name, phone, Instagram, email |
| GET | `/api/customers/insights` | Florist+ | CRM analytics (segments, churn risk, RFM) |
| GET | `/api/customers/:id` | Florist+ | Single customer profile |
| POST | `/api/customers` | Florist+ | Create new customer |
| PATCH | `/api/customers/:id` | Florist+ | Update customer fields |

### Stock
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stock` | Florist+ | List active stock by category |
| GET | `/api/stock/velocity` | Florist+ | 30-day usage velocity per item |
| POST | `/api/stock` | Florist+ | Create new stock item |
| PATCH | `/api/stock/:id` | Florist+ | Update prices, quantity, threshold |
| POST | `/api/stock/:id/adjust` | Florist+ | Increment/decrement quantity |
| POST | `/api/stock/:id/write-off` | Florist+ | Record dead stems |

### Deliveries
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/deliveries` | Driver+ | List deliveries (filterable by date, status, driver) |
| PATCH | `/api/deliveries/:id` | Driver+ | Update status, assign driver, add notes |

### Dashboard & Analytics
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard` | Owner | Day-to-day operational summary |
| GET | `/api/analytics?from=&to=` | Owner | Financial KPIs for date range |

### Other
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/stock-purchases` | Florist+ | Record supplier delivery |
| POST | `/api/webhook/wix` | HMAC sig | Wix eCommerce webhook receiver |
| GET | `/api/events?pin=` | PIN query | SSE real-time event stream |
| POST | `/api/intake/parse` | Florist+ | AI text-to-order parser |
| GET | `/api/health` | None | Health check |

---

## Frontend Architecture

### Component Provider Tree

**Florist & Delivery:**
```
BrowserRouter
  → AuthProvider (PIN + role state)
    → ToastProvider (notifications)
      → App
        → LanguageProvider (ru/en toggle)
          → Pages (via React Router)
```

**Dashboard:**
```
ToastProvider
  → App (reads VITE_OWNER_PIN from env, no login screen)
    → LanguageProvider
      → DashboardPage (tab-based, no router)
```

### Routing

| App | Routes |
|-----|--------|
| Florist | `/login`, `/orders`, `/orders/new`, `/orders/:id`, `/stock` |
| Delivery | `/login`, `/deliveries` |
| Dashboard | Single page — tabs: Today, Orders, New Order, Stock, Customers, Financial |

### API Client Pattern

Each app has an identical `api/client.js`:

```javascript
// Axios instance with interceptors
const client = axios.create({ baseURL: '/api' });

// Request: inject PIN header automatically
client.interceptors.request.use(config => {
  if (_pin) config.headers['X-Auth-PIN'] = _pin;
  return config;
});

// Response: clear PIN on 401 (session expired / invalid)
client.interceptors.response.use(null, error => {
  if (error.response?.status === 401) _pin = null;
  return Promise.reject(error);
});
```

Think of this as a **quality stamp** on every outgoing shipment — the interceptor automatically labels every request with credentials, and the response interceptor catches rejected shipments at the receiving dock.

### Proxy-Based Translations

Instead of `t('key')` function calls or `{t.key}` from an imported object:

```javascript
const t = new Proxy({}, {
  get(_, key) {
    return langs[currentLang]?.[key] ?? langs.en[key] ?? key;
  },
});
```

The Proxy intercepts property access at runtime. When language changes, `currentLang` updates, and the next render reads from the new language object. No prop drilling, no context for translations — just `t.orderTitle` everywhere.

**Gotcha:** Module-level captures like `const STEPS = [t.step1, t.step2]` freeze at initial language. These must be inside component functions so the Proxy reads on each render.

### Tab-Based Dashboard (No Router)

The dashboard keeps all tabs mounted but hides inactive ones with `display: none`. This preserves state (fetched data, scroll position, filters) when switching tabs. Only the Financial tab is lazy-loaded (Recharts is ~160KB).

```jsx
<div style={{ display: activeTab === 'orders' ? 'block' : 'none' }}>
  <OrdersTab key={filterKey} initialFilter={tabFilter} />
</div>
```

The `filterKey` increments on cross-tab navigation, forcing a remount with the new filter. Direct tab clicks don't increment it — state is preserved.

---

## Key Patterns & Design Decisions

### 1. Price Snapshotting
**Problem:** Flower prices change when suppliers update their rates. If Order Lines used live lookups to Stock prices, changing a stock price would retroactively change the margin on every past order.

**Solution:** When an order is created, the current cost and sell prices are **copied** to the Order Line record. The Order Line has its own price fields, independent of Stock.

**IE analogy:** Like a purchase order that locks in the quoted price — the supplier can change their price list later, but your existing PO stays at the agreed rate.

### 2. Bulk Enrichment (Avoiding N+1)
**Problem:** Displaying 50 orders requires customer names, order line totals, and delivery dates — all stored in separate Airtable tables.

**Solution:** Extract all linked record IDs from the parent records, then batch-fetch them in one API call using `OR(RECORD_ID()="x", RECORD_ID()="y")`.

**IE analogy:** Instead of sending 50 separate purchase orders to the warehouse, you send one consolidated picking list.

### 3. Search-First Customer Selection
**Problem:** Duplicate customer records are expensive (split order history, wrong CRM data).

**Solution:** The order form enforces search-first. You cannot create a new customer without first searching. The "Create New" button only appears after a search with no exact match.

### 4. Airtable Formula Filtering
All server-side filtering uses Airtable's `filterByFormula` to minimize data transfer. Never fetch all records and filter in JavaScript — that wastes API quota and bandwidth.

### 5. Memory-Only PIN Storage
PINs are stored in React state (memory), not localStorage or cookies. Refreshing the page logs you out. This is intentional — if a driver leaves their phone unlocked, the session doesn't persist indefinitely.

### 6. Separate Guide Content
FAQ content lives in `guideContent.js` per app, separate from `translations.js`. UI strings are short keys (`t.orderTitle`); guide content is long prose with Q&A structure. Mixing them would make `translations.js` unwieldy.

### 7. Three Apps, Not One
**Alternative:** One React app with role-based routing.
**Why separate:** Each user type has fundamentally different layouts (phone vs tablet vs desktop), different feature sets, and different deployment needs. A florist never needs financial charts; a driver never needs the bouquet builder. Separate apps = smaller bundles, simpler code, independent deployments.

**Tradeoff:** Some code duplication (context providers, API client, form steps). Acceptable for 3 apps with ~5-15 components each.

---

## Authentication & Security

### PIN-Based Auth
```
Client → X-Auth-PIN: 5678 → Backend
Backend → timingSafeEqual(pin, PIN_FLORIST) → role = "florist"
Backend → authorize('orders') → allowed (florist can access orders)
```

**Per-driver PINs:** Each driver has a unique PIN (`PIN_DRIVER_TIMUR`, `PIN_DRIVER_NIKITA`, `PIN_DRIVER_DMITRI`). On login, the backend returns both the role and the driver's name, so deliveries can be auto-filtered and auto-assigned.

### Security Measures
- **Helmet:** Standard HTTP security headers (X-Frame-Options, CSP, etc.)
- **Rate limiting:** 5 PIN attempts per 15 minutes per IP
- **Timing-safe comparison:** Prevents PIN brute-force via timing side-channel
- **Formula injection prevention:** User input sanitized before interpolation into Airtable formulas
- **Webhook signature verification:** Wix webhooks validated via HMAC-SHA256
- **CORS whitelist:** Production restricts origins to deployed app domains
- **Raw body capture:** Preserved for webhook signature verification (JSON parsing alters the body)

---

## Real-Time Features (SSE)

Server-Sent Events provide one-way real-time updates from backend to all connected clients.

```
Backend (events.js)          Clients (useNotifications.js)
     │                              │
     │  ← EventSource connection ───│
     │                              │
     │── { type: "connected" } ────►│
     │                              │
     │   ... Wix webhook arrives ...│
     │                              │
     │── { type: "new_order" } ────►│  → Toast + sound alert
     │                              │
     │── heartbeat (30s) ──────────►│  (prevents proxy timeout)
```

**Why SSE over WebSockets?** SSE is simpler (HTTP-based, auto-reconnects, works through proxies), and we only need server→client push. No bidirectional communication needed.

**Fallback:** If SSE connection drops, the notification hook could poll, but in practice EventSource auto-reconnects natively.

---

## AI Integration

### Intake Parser (`services/intake-parser.js`)

Two parsing modes for converting pasted text into order drafts:

**1. General text parsing** (Instagram/WhatsApp messages):
- Claude Haiku extracts: customer name, phone, flowers + quantities, delivery info
- System prompt includes current stock names for guided extraction
- Returns structured JSON with confidence levels

**2. Flowwow email parsing:**
- Regex-first: extracts order ID, delivery details, items, prices from Russian-language email format
- Falls back to AI if regex captures too little
- Merges both results, preferring regex for structured fields

**Stock matching** is a two-pass process:
1. **Exact match:** Case-insensitive comparison of extracted names vs stock Display Names
2. **AI match:** Claude matches remaining items across languages (a customer might say "ромашки" but stock is listed as "Chamomile")

Each match gets a confidence level: `high` (exact), `low` (AI probable), `none` (no match). UI shows green/yellow/red borders accordingly.

### Translation
Order notes can arrive in Russian, Ukrainian, Polish, English, or Turkish. Claude Haiku translates to Russian (the team's working language). Translation is async and non-blocking — if it fails, the original text is preserved.

---

## Deployment

### Architecture

```
┌──────────────┐     ┌──────────────┐
│   Vercel     │     │   Railway    │
│  (Frontend)  │────►│  (Backend)   │────► Airtable API
│              │     │              │────► Claude API
│  3 apps:     │     │  Express     │
│  - florist   │     │  port 3001   │
│  - delivery  │     │              │
│  - dashboard │     │              │
└──────────────┘     └──────────────┘
```

### Environment Variables

**Backend (Railway):**
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` — Database connection
- `AIRTABLE_*_TABLE` — Table IDs for each table (6 tables)
- `PIN_OWNER`, `PIN_FLORIST`, `PIN_DRIVER_*` — Authentication PINs
- `WIX_WEBHOOK_SECRET` — Webhook signature verification
- `ANTHROPIC_API_KEY` — Claude AI for parsing/translation
- `NODE_ENV`, `PORT`

**Frontend (Vercel):**
- `VITE_API_URL` — Backend URL (e.g., `https://flower-studio.railway.app`)
- `VITE_OWNER_PIN` — Dashboard auto-login (dashboard app only)

### Dev Environment
- Backend: `node --env-file=.env.dev src/index.js` (port 3001)
- Florist: `npx vite` (port 5173, proxies `/api` to backend)
- Delivery: `npx vite` (port 5174)
- Dashboard: `npx vite` (port 5175)
- Dev uses separate Airtable base (`appcidaoQofrTFsVb`) to avoid touching production data

---

## What Was Built in Each Phase

| Phase | What | Key Files |
|-------|------|-----------|
| **1. Scaffold** | Monorepo, Express, Airtable CRUD, all REST routes, PIN auth | `backend/src/` (all) |
| **2. Florist App** | Order form with 4-step wizard, bouquet builder, stock panel, customer search | `apps/florist/src/` (all) |
| **3. Delivery App** | Delivery list, status updates, Google Maps integration, driver notes | `apps/delivery/src/` (all) |
| **4. Wix Webhook** | Webhook receiver, customer matching, order creation, SSE broadcast | `routes/webhook.js`, `services/wix.js` |
| **5. Translation** | Claude Haiku note translation (async, non-blocking) | `services/intake-parser.js` |
| **6. Dashboard (Ops)** | Orders tab, Stock tab, Customers tab, DayToDay tab, New Order tab | `apps/dashboard/src/` (tabs) |
| **7. Financial KPIs** | Revenue, margins, waste, delivery P&L, customer metrics, charts | `routes/analytics.js`, `FinancialTab.jsx` |
| **8. SSE Notifications** | Real-time alerts for new Wix orders | `routes/events.js`, `useNotifications.js` |
| **Post-phase** | Smart order intake (AI text parsing), language switcher, in-app help | `routes/intake.js`, `translations.js`, `guideContent.js` |

---

## Lessons Learned

### What Worked Well

1. **Airtable as a database** — For this scale (5-7 users, <200 orders/month), it's surprisingly effective. The web UI doubles as an admin panel. Formula-based filtering keeps queries efficient.

2. **Three separate apps** — Each app stays simple (~10-15 components). No complex routing guards or role-based rendering. Each can be deployed independently.

3. **Proxy-based translations** — Elegant solution for adding bilingual support to an existing codebase without touching every import. One pattern change, not 35+ file changes.

4. **Price snapshotting** — Avoiding live lookups on Order Lines was the single most important data model decision. Without it, financial reports would be unreliable.

5. **Bulk enrichment** — Solved the N+1 problem elegantly. A page showing 50 orders makes 3-4 API calls instead of 150+.

### What Would Change

1. **Shared component library** — The 3 apps duplicate code (context providers, API client, form steps). A shared npm workspace package would reduce this, at the cost of more complex builds.

2. **TypeScript** — Plain JavaScript works for a small project, but type safety would have caught several bugs earlier (wrong field names, missing properties on Airtable records).

3. **Proper testing** — No automated tests were written. For a production app, at least the backend routes should have integration tests against a test Airtable base.

4. **Airtable rate limiting** — The 5 req/sec limit is the primary scaling bottleneck. At 10x current volume, we'd need to add caching (Redis) or migrate to a real database.

5. **Offline support** — The apps require constant internet. For delivery drivers in areas with poor coverage, a service worker with queue-and-sync would improve reliability.

### Architecture Stress Points

| Component | Breaks At | Mitigation |
|-----------|-----------|------------|
| Airtable rate limit | >5 req/sec sustained | Add Redis cache layer |
| SSE connections | >100 concurrent | Switch to WebSocket with rooms |
| Order creation (3+ API calls) | High concurrency | Transaction-like pattern with rollback |
| Stock quantity (no locking) | Concurrent adjustments | Optimistic locking or CAS |
| Bundle size (dashboard) | Adding more chart types | Code splitting per tab (already done for Financial) |

---

## Quick Reference

### Dev Commands
```bash
# Start backend (dev)
cd backend && node --env-file=.env.dev src/index.js

# Start frontend (any app)
cd apps/florist && npx vite     # port 5173
cd apps/delivery && npx vite    # port 5174
cd apps/dashboard && npx vite   # port 5175

# Build for production
cd apps/florist && npx vite build
cd apps/delivery && npx vite build
cd apps/dashboard && npx vite build
```

### Key URLs (Production)
- Florist: `https://florist.vercel.app`
- Delivery: `https://delivery.vercel.app`
- Dashboard: `https://dashboard.vercel.app`
- Backend: `https://flower-studio.railway.app`

### Airtable Bases
- **Production:** `appM8rLfcE9cbxduZ` (NEVER use during dev)
- **Development:** `appcidaoQofrTFsVb`
