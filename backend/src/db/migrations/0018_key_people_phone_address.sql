-- Recipient phone + address as first-class key_people columns (CR-30).
-- Makes each connected key person a reusable address book: phone + delivery
-- address are stored once and pre-fill every future delivery to that person.
-- Additive + nullable → safe on prod.

ALTER TABLE "key_people" ADD COLUMN "phone" text;
--> statement-breakpoint
ALTER TABLE "key_people" ADD COLUMN "address" text;
