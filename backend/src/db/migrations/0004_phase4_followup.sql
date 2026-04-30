-- Phase 4 follow-on: fields the original 0003 migration missed.
--
-- deliveries.delivered_at  — driver-app PATCH stamps this on Status='Delivered'.
-- orders.wix_order_id      — Wix webhook idempotency key (one row per Wix order).

ALTER TABLE "deliveries" ADD COLUMN "delivered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "wix_order_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_wix_order_id_idx" ON "orders" USING btree ("wix_order_id") WHERE "wix_order_id" IS NOT NULL;
