-- Bouquet image URL on orders.
-- Driver delivery card renders this so the courier knows which bouquet to grab.
-- File itself lives in Wix Media; this column caches the public URL.

ALTER TABLE "orders" ADD COLUMN "image_url" text;
