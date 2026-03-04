# Changelog — Blossom Flower Studio

Tracks all changes that may impact **go-live** (switching from dev base to production base).
Review this entire file before flipping to production.

---

## Schema Changes (Airtable)

Changes made to the **dev base** that must be replicated in **production** before go-live.

| Date | Table | Change | Applied to Prod? |
|------|-------|--------|:-:|
| 2026-03-05 | App Orders | Renamed `Deliveries` → `_Deliveries OLD`, `Deliveries 2` → `Deliveries` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |
| 2026-03-05 | App Orders | Renamed `Order Lines` → `_Order Lines OLD`, `Order Lines 2` → `Order Lines` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |

---

## Environment / Config Changes

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/.env` | Original production config — DO NOT EDIT | This IS the production config |
| 2026-03-04 | `backend/.env.dev` | Created — points to Blossom Dev base | Delete or ignore at go-live |
| 2026-03-04 | `backend/package.json` | `dev` script uses `--env-file=.env.dev` | Change to `--env-file=.env` or remove flag at go-live |
| 2026-03-04 | `backend/src/index.js` | Removed `import 'dotenv/config'` (replaced by `--env-file`) | No change needed — same flag works with `.env` |
| 2026-03-04 | `.gitignore` | Changed to `.env.*` glob pattern | Keep |
| 2026-03-04 | `scripts/seed-stock.js` | Removed `import 'dotenv/config'`, now uses `--env-file` | Run with `--env-file=.env` for production |

---

## Code Changes Affecting Go-Live

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/src/services/airtable.js` | Added `typecast: true` to create/update | Keep — helps with new select values |
| 2026-03-04 | `apps/florist/src/components/steps/Step2Bouquet.jsx` | Stock oversell prevention | Keep |
| 2026-03-04 | `apps/florist/src/components/steps/Step3Details.jsx` | Payment method hidden when Unpaid | Keep |
| 2026-03-04 | `apps/florist/src/components/OrderDetailSheet.jsx` | New: order detail bottom sheet | Keep |
| 2026-03-04 | `apps/florist/src/pages/OrderListPage.jsx` | Orders clickable → detail sheet | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Status transition validation + stock rollback on cancel | Keep |
| 2026-03-05 | `apps/florist/src/components/OrderDetailSheet.jsx` | Only show allowed next statuses, added "Picked Up" | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Fixed field name `Assigned Delivery` → `Deliveries` (matches actual Airtable field) | Keep — same field name in production |

---

## Go-Live Checklist

- [ ] Apply all schema changes from "Schema Changes" table above to production base
- [ ] Grep codebase for `fld` — ensure no hardcoded field IDs
- [ ] Verify all Airtable select options exist in production (Source, Status, Payment, etc.)
- [ ] Switch backend to production env: `--env-file=.env` (or remove flag)
- [ ] Seed stock in production base (if not already there)
- [ ] Test one order end-to-end against production
- [ ] Remove or archive `.env.dev`
