# Delivery Cost is computed from driving distance; the Delivery Fee is set on top of it

The **Delivery Cost** — what the studio pays to have an Order delivered — is calculated automatically at order creation from the **driving distance** between the studio and the delivery address, looked up against an editable table of **Distance Bands**. The **Delivery Fee** — what the Customer pays — is then entered by the Owner *on top* of that cost. The gap between them is the **Delivery Margin**, and it is the point of the exercise. Both numbers are freely overridable, and neither is ever derived from the other.

## Why

The two numbers were nominally independent already — `deliveries.delivery_fee` and `deliveries.driver_payout` are separate columns — but both resolved to the same constant, so the margin was structurally zero. Measured against production on 2026-08-02:

- **99 of 120** completed Deliveries broke even *exactly*. Average fee 32.83 zł, average payout 32.96 zł.
- Nikita: 105 Deliveries, 3 535 zł charged, 3 535 zł paid out, margin **0**.
- Across all Deliveries the studio is **235 zł down** — payouts 4 165 zł against 3 930 zł of fees.

Two defaults collided. `orders.js` stamps `Driver Payout = getConfig('driverCostPerDelivery')`, a flat **35 zł**; both order wizards render the Fee as free text with `placeholder="35"`. The Owner types the placeholder, the backend stamps the constant, and the margin cancels.

**Distance is the right basis because it is what the Driver actually bills on.** He is paid for the drive he makes, so any proxy for distance introduces a gap between what the studio pays out and what it charged the Customer — and closing that gap deliberately, as margin rather than as accident, is the whole purpose. An approximation that is merely close is not good enough here: it silently becomes a loss on every run where it under-reads.

The distance is measured **studio → destination**, per Delivery, and is treated as the agreed price regardless of how the Driver sequences a multi-stop run.

## Considered alternatives

- **Postcode Delivery Zones.** This config already exists — Central Krakow 35, Suburbs 50, Out of city 80 — with `postcodes` prefix arrays. Rejected because it is not how the Driver is paid, and Krakow postcodes do not track driving distance: two addresses in one postcode band can be a long drive apart. Notably, no internal code ever read these zones; their only consumers are `routes/public.js` (the Wix storefront) and the settings editor. The same is true of `expressSurcharge` and `freeDeliveryThreshold` — **the whole storefront pricing config is a parallel universe from the Owner's own order form.**
- **Price the actual driven route.** Genuinely correct for a multi-stop run, and rejected on timing: the route is not known until the Driver has driven it, but the cost is needed at order creation, which is when the Customer is quoted. Pricing each drop studio→destination knowingly overpays on a dense run; that is accepted as the agreed deal rather than treated as an error.
- **Keep a flat rate per Delivery.** Today's model. Rejected on the evidence above: it cannot answer "was this run worth it", and it silently overpays short runs while underpaying long ones.
- **Derive the payout as a percentage of the fee.** Guarantees a positive margin, but it is not how Drivers are paid and it re-couples the two numbers — the exact failure this ADR exists to undo.

## Consequences

- **This needs paid infrastructure that does not exist yet.** There is no Google Maps API key in the backend environment or on Railway. The Delivery app only builds Google Maps *deep-link URLs* (`MapView.jsx`), and its own comment records that an API key was deliberately avoided as an unnecessary cost. Distance-based pricing requires a Routes or Distance Matrix key, billing enabled, a backend caller, and caching by normalised address so re-editing an Order does not re-bill.
- **The computed distance, the band applied, and the resulting cost are stored on the Delivery.** The band table is editable config; a Delivery that stored only "35" would lose why once the table changes. Storing all three keeps history honest, makes a disputed charge auditable, and makes per-distance reporting possible. It cannot be backfilled later.
- **Distance calculation must never block order creation.** An unresolvable address or an API outage leaves the cost empty for the Owner to fill by hand; it does not fail the Order.
- **Exceptions are handled by override, not by more rules.** Out-of-hours runs and exceptionally long trips outside the city are priced by the Owner editing the computed cost. `expressSurcharge` exists as prior art for a systematic surcharge should one later prove worth automating.
- **Per-Driver rates are an override of the band table, not a replacement.** The bands are the standard; a Driver may carry their own table when terms differ. Both are Owner-editable, because rates change.
- Because Fee and Cost are independent, **neither may ever be computed from the other.** A future reader will find two columns that were identical on 99 of 120 rows and be tempted to collapse one. That collapse *is* the bug.
- `Delivery Method = Florist` costs zero deliberately — that Florist's time is already captured in Florist Hours, and paying it twice would double-count. `Taxi` has never been used in production (0 rows).
- **Three fields in the deliveries PATCH allow-list have no column and are silently dropped**: `Driver Payment Status`, `Taxi Cost`, and `Delivery Result` — the last is even validated against `VALID_DELIVERY_RESULTS` before being discarded. `Driver Payment Status` must exist before "has this Driver been paid?" is answerable, and analytics reads `Taxi Cost` today as a permanent zero.
- Every read of a fee or cost must first gate on the Order's current Delivery Type via `isDeliveryOrder` — a cancelled Delivery is not a deleted Delivery (pitfall `cancelled-delivery-leak`), and a converted Order otherwise keeps contributing a stale cost to the Delivery Margin.
