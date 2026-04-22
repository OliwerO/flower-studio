# Repository layer

Thin interface between route handlers and persistence. Handlers call repo
methods instead of `db.list()` / `db.getById()` directly.

## Why

This repo exists to enable the upcoming **Airtable → Postgres migration**
without a big-bang rewrite. The pattern is Strangler Fig:

1. Routes call `customerRepo.list()`, `customerRepo.update(...)`, etc. Today
   those methods are thin wrappers around the existing `airtable.js` service.
2. When we swap Postgres in, **only files in this directory change**. Route
   handlers, service layers, and frontends stay identical.
3. Migration happens per entity — customer first, then stock, then orders —
   with a shadow-write period where both stores are written to verify parity
   before cutting over.

IE framing: supplier-agnostic receiving dock. Production lines don't care
which vendor delivered the materials, only that they arrive in the
expected shape.

## What goes in here

- **Field-name translation** (Airtable aliases ↔ domain names)
- **PATCH allowlists** — so routes can't write arbitrary fields
- **Cross-table joins** that are logically one entity's domain (e.g. a
  customer's merged legacy + app order history)
- **In-process caches** tied to a single entity (e.g. customer aggregates)

## What does NOT go in here

- Cross-entity analytics (customer insights that read orders AND customers
  AND compute RFM) — those belong in a service.
- HTTP concerns (req/res, status codes, error translation) — stay in routes.
- Write cascades that span multiple domains (order → delivery status, stock
  return on cancel) — those belong in `services/`.

## Status

- `customerRepo.js` — pilot, live on Airtable
- `orderRepo.js` — TODO
- `stockRepo.js` — TODO
