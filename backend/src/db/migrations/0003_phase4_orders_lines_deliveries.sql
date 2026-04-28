CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"order_id" uuid NOT NULL,
	"delivery_address" text,
	"recipient_name" text,
	"recipient_phone" text,
	"delivery_date" date,
	"delivery_time" text,
	"assigned_driver" text,
	"delivery_fee" numeric(10, 2),
	"driver_instructions" text,
	"delivery_method" text,
	"driver_payout" numeric(10, 2),
	"status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"order_id" uuid NOT NULL,
	"stock_item_id" text,
	"flower_name" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"cost_price_per_unit" numeric(10, 2),
	"sell_price_per_unit" numeric(10, 2),
	"stock_deferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"app_order_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"delivery_type" text NOT NULL,
	"order_date" date DEFAULT now() NOT NULL,
	"required_by" date,
	"delivery_time" text,
	"customer_request" text,
	"notes_original" text,
	"florist_note" text,
	"greeting_card_text" text,
	"source" text,
	"communication_method" text,
	"payment_status" text DEFAULT 'Unpaid' NOT NULL,
	"payment_method" text,
	"price_override" numeric(10, 2),
	"delivery_fee" numeric(10, 2),
	"created_by" text,
	"payment_1_amount" numeric(10, 2),
	"payment_1_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_airtable_id_idx" ON "deliveries" USING btree ("airtable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_id_idx" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_driver_date_idx" ON "deliveries" USING btree ("assigned_driver","delivery_date");--> statement-breakpoint
CREATE INDEX "deliveries_status_date_idx" ON "deliveries" USING btree ("status","delivery_date");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_airtable_id_idx" ON "order_lines" USING btree ("airtable_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_id_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_stock_item_id_idx" ON "order_lines" USING btree ("stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_airtable_id_idx" ON "orders" USING btree ("airtable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_app_order_id_idx" ON "orders" USING btree ("app_order_id");--> statement-breakpoint
CREATE INDEX "orders_customer_date_idx" ON "orders" USING btree ("customer_id","order_date");--> statement-breakpoint
CREATE INDEX "orders_active_status_idx" ON "orders" USING btree ("status","required_by");--> statement-breakpoint
CREATE INDEX "orders_deleted_idx" ON "orders" USING btree ("deleted_at");