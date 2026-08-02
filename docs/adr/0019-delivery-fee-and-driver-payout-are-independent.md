# Delivery Fee and Driver Payout are independent numbers, priced from Zone and Driver Rate

What the Customer pays for a Delivery and what the studio pays to have it delivered are two separate numbers. The **Delivery Fee** is suggested from the **Delivery Zone**; the **Driver Payout** defaults from the assigned Driver's **Driver Rate** for that Zone. Both are freely overridable, and neither is ever derived from the other. The gap between them is the **Delivery Margin**.

## Why

The two numbers were nominally independent already — `deliveries.delivery_fee` and `deliveries.driver_payout` are separate columns — but in practice both resolved to the same constant, so the margin was structurally zero. Measured against production on 2026-08-02:

- **99 of 120** completed Deliveries broke even *exactly*. Average fee 32.83 zł, average payout 32.96 zł.
- Nikita: 105 Deliveries, 3 535 zł charged, 3 535 zł paid out, margin **0**.
- Across all Deliveries the studio is **235 zł down** — payouts 4 165 zł against 3 930 zł of fees.

The cause was two defaults colliding. `orders.js` stamps `Driver Payout = getConfig('driverCostPerDelivery')`, a flat **35 zł**. Both order wizards render the Fee as a free-text number with `placeholder="35"`. The Owner types the placeholder, the backend stamps the constant, and the margin cancels.

Meanwhile `deliveryZones` already existed in config with real pricing — Central Krakow 35, Suburbs 50, Out of city 80 — but its only consumers were `routes/public.js` (the Wix storefront) and the settings editor that maintains it. **No internal order path read it.** A suburb delivery the website prices at 50 zł was charged 35 when the Owner booked it by phone, and the same 35 was paid out regardless of distance. The zone premium was being lost on every internally-created Order.

Pricing the Fee by Zone and the Payout by Driver Rate is what makes the margin a number the Owner *sets* rather than one she *discovers*. It is also the precondition for [#356](https://github.com/OliwerO/flower-studio/issues/356) — per-Driver delivery reporting is meaningless while every Driver is paid an identical constant.

## Considered alternatives

- **Keep a single flat payout, earn margin only on the Fee side.** Simplest, and closest to today. Rejected because it cannot answer "which Driver got paid what, and was that run worth it" — the Owner's stated goal — and it silently overpays for short runs while underpaying for long ones.
- **Per-Zone payout with no per-Driver dimension.** Handles distance, but not two Drivers on different agreed terms, and a rate change rewrites the meaning of historical rows.
- **Per-Driver rate with no Zone dimension.** Handles who, not how far — the 80 zł out-of-city run pays the same as the corner shop.
- **Derive the payout as a percentage of the fee.** Tempting because it guarantees a positive margin. Rejected: it is not how Drivers are actually paid, and it re-couples the two numbers, which is the exact failure this ADR exists to undo.
- **Fully manual, no defaults.** Total freedom. Rejected on the evidence above — this is effectively what exists, and it drifted to a single number in muscle memory.

## Consequences

- **Neither number may ever be computed from the other.** A future reader will find two columns that were identical on 99 of 120 rows and be tempted to collapse one. That collapse *is* the bug.
- The Delivery Fee is suggested from the Zone in both order wizards, matching what the storefront already charges. The suggestion is a default, never a lock — the Owner overrides freely.
- The Driver Rate belongs to the Driver, not to any Delivery, so changing a rate never rewrites history: existing Deliveries keep the payout they were stamped with.
- `Delivery Method = Florist` pays out zero deliberately — that Florist's time is already captured in Florist Hours, and paying it twice would double-count. `Taxi` has never been used in production (0 rows).
- **Three fields in the deliveries PATCH allow-list have no column and are silently dropped**: `Driver Payment Status`, `Taxi Cost`, and `Delivery Result` — the last is even validated against `VALID_DELIVERY_RESULTS` before being discarded. `Driver Payment Status` must exist before "has this Driver been paid?" is answerable, and analytics reads `Taxi Cost` today as a permanent zero.
- Every read of a fee or payout must first gate on the Order's current Delivery Type via `isDeliveryOrder` — a cancelled Delivery is not a deleted Delivery (pitfall `cancelled-delivery-leak`), and a converted Order otherwise keeps contributing a stale payout to the Delivery Margin.
