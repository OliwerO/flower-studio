-- Courier delivery slot, separate from the client-facing window (CR-32).
-- delivery_time holds the wide 2h window the client chose; courier_time holds
-- the tighter 1h slot the owner assigns to the courier within that window.
-- The driver app shows only courier_time. Additive + nullable → safe on prod.

ALTER TABLE "deliveries" ADD COLUMN "courier_time" text;
