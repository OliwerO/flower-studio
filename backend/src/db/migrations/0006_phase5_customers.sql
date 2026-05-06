CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"name" text NOT NULL,
	"nickname" text,
	"phone" text,
	"email" text,
	"link" text,
	"language" text,
	"home_address" text,
	"sex_business" text,
	"segment" text,
	"found_us_from" text,
	"communication_method" text,
	"order_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "key_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_details" text,
	"important_date" date,
	"important_date_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legacy_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_date" date,
	"description" text,
	"amount" numeric(10, 2),
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "key_person_id" uuid;
--> statement-breakpoint
ALTER TABLE "key_people" ADD CONSTRAINT "key_people_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_orders" ADD CONSTRAINT "legacy_orders_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_key_person_id_fk" FOREIGN KEY ("key_person_id") REFERENCES "public"."key_people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_airtable_id_idx" ON "customers" USING btree ("airtable_id");
--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "customers_deleted_idx" ON "customers" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "key_people_customer_id_idx" ON "key_people" USING btree ("customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_orders_airtable_id_idx" ON "legacy_orders" USING btree ("airtable_id");
--> statement-breakpoint
CREATE INDEX "legacy_orders_customer_id_idx" ON "legacy_orders" USING btree ("customer_id");
--> statement-breakpoint
INSERT INTO system_meta (key, value) VALUES ('customers_migration_at', NOW()::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
