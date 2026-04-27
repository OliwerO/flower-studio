CREATE TABLE "parity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"field" text,
	"airtable_value" jsonb,
	"postgres_value" jsonb,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_id" text,
	"display_name" text NOT NULL,
	"purchase_name" text,
	"category" text,
	"current_quantity" integer DEFAULT 0 NOT NULL,
	"unit" text,
	"current_cost_price" numeric(10, 2),
	"current_sell_price" numeric(10, 2),
	"supplier" text,
	"reorder_threshold" integer,
	"active" boolean DEFAULT true NOT NULL,
	"supplier_notes" text,
	"dead_stems" integer DEFAULT 0 NOT NULL,
	"lot_size" integer,
	"farmer" text,
	"last_restocked" date,
	"substitute_for" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "parity_log_entity_idx" ON "parity_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "parity_log_kind_idx" ON "parity_log" USING btree ("entity_type","kind","created_at");--> statement-breakpoint
CREATE INDEX "parity_log_created_idx" ON "parity_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_airtable_id_idx" ON "stock" USING btree ("airtable_id");--> statement-breakpoint
CREATE INDEX "stock_active_idx" ON "stock" USING btree ("active","deleted_at");--> statement-breakpoint
CREATE INDEX "stock_display_name_idx" ON "stock" USING btree ("display_name");