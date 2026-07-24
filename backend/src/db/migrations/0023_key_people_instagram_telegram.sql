-- Instagram + Telegram as first-class key_people columns (#553).
-- Owner wants dedicated inputs for a key person's social contact info,
-- alongside phone + address (CR-30, migration 0018).
-- Additive + nullable → safe on prod.

ALTER TABLE "key_people" ADD COLUMN "instagram" text;
--> statement-breakpoint
ALTER TABLE "key_people" ADD COLUMN "telegram" text;
