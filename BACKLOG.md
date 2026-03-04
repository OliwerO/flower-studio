# Backlog — Blossom Flower Studio

Features and improvements deferred for later. Ordered by priority within each section.

---

## Phase 2 Polish (Florist App)

- [ ] **Phone responsiveness** — Step2 bouquet builder two-column layout needs stacking on small screens, nav bar overflow check
- [ ] **Russian translations** — swap all ~50 strings in `translations.js`
- [ ] **PWA manifest + service worker** — Add to Home Screen support, app icon, splash screen
- [ ] **Status change notifications** — notify driver when order is "Ready" (needs delivery app first)
- [ ] **Time tracking per status** — record timestamp when order moves to each status (add fields to Airtable)
- [ ] **Order editing** — allow florist to edit an existing order (add/remove flowers, change delivery details)

## Phase 3 — Delivery App (`apps/delivery/`)

- [ ] Driver login (PIN 9012)
- [ ] Today's deliveries list with address, time, recipient
- [ ] Mark as delivered (auto-updates order status to "Delivered")
- [ ] Navigation link (open address in Google Maps / Waze)
- [ ] Driver notes field

## Phase 4 — Owner Dashboard (`apps/dashboard/`)

- [ ] Daily/weekly/monthly revenue overview
- [ ] Order volume trends
- [ ] Stock levels and reorder alerts
- [ ] Top customers by order count / revenue
- [ ] Profit margins per flower type

## Infrastructure

- [ ] **Go-live** — see `CHANGELOG.md` Go-Live Checklist
- [ ] **Hosting** — deploy backend + frontend (Railway / Render / Vercel)
- [ ] **Custom domain** — e.g., app.blossomflowers.pl
- [ ] **Backup strategy** — scheduled Airtable data export
- [ ] **Error monitoring** — Sentry or similar for production errors
