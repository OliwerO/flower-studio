# Blossom — Flower Studio Management App

Web app replacing multi-spreadsheet workflow for **Blossom**, a flower studio in Krakow.
Manages orders (6 channels), flower inventory, customer CRM, deliveries, and owner dashboards.

## Users

- **1 owner** (desktop) — full dashboard, financial KPIs, settings
- **2-4 florists** (tablet/phone) — orders, bouquet builder, stock management
- **2 delivery drivers** (phone) — task board, navigation, delivery confirmation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | Airtable (existing base — extended, not replaced) |
| Backend | Node.js + Express |
| Frontend | 3 React apps (Vite + Tailwind) |
| Translation | Anthropic Claude Haiku (auto-translate to Russian) |
| Hosting | Vercel (frontends), Railway (backend) |
| Auth | Stateless PIN per role via `X-Auth-PIN` header |

## Project Structure

```
flower-studio/
  backend/           # Express API server
    src/
      config/        # Airtable table mappings
      middleware/     # Auth (PIN), error handler
      routes/        # REST endpoints
      services/      # Airtable, translation, notifications, webhook processing
  apps/
    florist/         # Bouquet builder + order form (tablet-optimized)
    delivery/        # Driver task board (phone-optimized)
    dashboard/       # Owner dashboard — operations, financials, settings
```

## Running Locally

### Prerequisites

- Node.js 18+
- Airtable account with base configured
- Environment variables (see below)

### Backend

```bash
cd backend
npm install
npm run dev          # starts on port 3001, loads .env.dev
```

### Frontend Apps

```bash
cd apps/florist      # or delivery, or dashboard
npm install
npm run dev          # Vite dev server with HMR
```

Default ports: Backend 3001, Florist 5173, Delivery 5174, Dashboard 5175.

## Environment Variables

### Backend (.env)

```
# Airtable
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_ORDERS_TABLE=
AIRTABLE_ORDER_LINES_TABLE=
AIRTABLE_CUSTOMERS_TABLE=
AIRTABLE_STOCK_TABLE=
AIRTABLE_DELIVERIES_TABLE=
AIRTABLE_STOCK_PURCHASES_TABLE=
AIRTABLE_WEBHOOK_LOG_TABLE=
AIRTABLE_MARKETING_SPEND_TABLE=
AIRTABLE_STOCK_LOSS_LOG_TABLE=

# Auth PINs
PIN_OWNER=
PIN_FLORIST=
PIN_DRIVER_TIMUR=
PIN_DRIVER_NIKITA=
PIN_DRIVER_DMITRI=
PIN_DRIVER_BACKUP=          # shared PIN for freelance drivers

# Services
ANTHROPIC_API_KEY=           # Claude Haiku for auto-translation
WIX_WEBHOOK_SECRET=          # HMAC verification for Wix webhooks

# Server
PORT=3001
NODE_ENV=development
CORS_ORIGINS=                # comma-separated frontend URLs (production)
```

### Frontend (.env)

```
VITE_BACKEND_URL=            # Railway backend URL (for SSE direct connection)
VITE_OWNER_PIN=              # auto-login for dashboard dev
```

## Deployment

- **Backend**: Railway (auto-deploys from `master` branch)
- **Frontends**: Vercel (each app has its own `vercel.json` with API proxy rewrites)

## Key Features

- **Multi-channel order intake**: In-store, Instagram, WhatsApp, Telegram, Wix, Flowwow
- **Bouquet builder**: Visual flower selector with live cost/sell totals
- **AI text import**: Paste order text, Claude parses it into structured fields
- **Price snapshotting**: Order lines lock in prices at creation (historical accuracy)
- **Atomic stock management**: Serialized queue prevents race conditions
- **Wix webhook**: Auto-creates orders from eCommerce (dedup, customer matching, delivery)
- **Auto-translation**: Order notes translated to Russian via Claude Haiku
- **SSE notifications**: Real-time alerts when new orders arrive (sound + toast)
- **Delivery tracking**: Driver task board with GPS navigation, problem reporting
- **Financial KPIs**: Revenue, margins, waste, supplier scorecard, prep time
- **Customer CRM**: RFM segmentation, churn risk, lifetime value
- **Settings tab**: All operational config editable from dashboard (no Airtable needed)

## License

Private — proprietary software for Blossom flower studio.
