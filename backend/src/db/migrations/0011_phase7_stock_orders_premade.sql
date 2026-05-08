CREATE TABLE IF NOT EXISTS stock_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id        TEXT,
  po_number          TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'Draft',
  created_date       TEXT NOT NULL DEFAULT '',
  assigned_driver    TEXT NOT NULL DEFAULT '',
  planned_date       TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  supplier_payments  TEXT NOT NULL DEFAULT '',
  driver_payment     TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_orders_airtable_id_idx
  ON stock_orders (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_orders_po_number_idx
  ON stock_orders (po_number) WHERE po_number <> '';
CREATE INDEX IF NOT EXISTS stock_orders_status_idx        ON stock_orders (status);
CREATE INDEX IF NOT EXISTS stock_orders_created_date_idx  ON stock_orders (created_date);
CREATE INDEX IF NOT EXISTS stock_orders_driver_idx        ON stock_orders (assigned_driver) WHERE assigned_driver <> '';

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS stock_order_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id                 TEXT,
  po_id                       UUID NOT NULL REFERENCES stock_orders(id) ON DELETE CASCADE,
  stock_id                    UUID REFERENCES stock(id),
  stock_airtable_id           TEXT,
  flower_name                 TEXT NOT NULL DEFAULT '',
  quantity_needed             INTEGER NOT NULL DEFAULT 0,
  quantity_found              INTEGER NOT NULL DEFAULT 0,
  lot_size                    INTEGER NOT NULL DEFAULT 0,
  driver_status               TEXT NOT NULL DEFAULT 'Pending',
  supplier                    TEXT NOT NULL DEFAULT '',
  cost_price                  NUMERIC(10,4) NOT NULL DEFAULT 0,
  sell_price                  NUMERIC(10,4) NOT NULL DEFAULT 0,
  farmer                      TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT '',
  substitute_flower_name      TEXT NOT NULL DEFAULT '',
  substitute_status           TEXT NOT NULL DEFAULT '',
  substitute_quantity_found   INTEGER NOT NULL DEFAULT 0,
  substitute_cost             NUMERIC(10,4) NOT NULL DEFAULT 0,
  substitute_supplier         TEXT NOT NULL DEFAULT '',
  quantity_accepted           INTEGER NOT NULL DEFAULT 0,
  write_off_qty               INTEGER NOT NULL DEFAULT 0,
  eval_status                 TEXT NOT NULL DEFAULT '',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_order_lines_airtable_id_idx
  ON stock_order_lines (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_order_lines_po_id_idx    ON stock_order_lines (po_id);
CREATE INDEX IF NOT EXISTS stock_order_lines_stock_id_idx ON stock_order_lines (stock_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS premade_bouquets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     TEXT,
  name            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  price_override  NUMERIC(10,2),
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS premade_bouquets_airtable_id_idx
  ON premade_bouquets (airtable_id) WHERE airtable_id IS NOT NULL;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS premade_bouquet_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id           TEXT,
  bouquet_id            UUID NOT NULL REFERENCES premade_bouquets(id) ON DELETE CASCADE,
  stock_id              UUID REFERENCES stock(id),
  stock_airtable_id     TEXT,
  flower_name           TEXT NOT NULL DEFAULT '',
  quantity              INTEGER NOT NULL DEFAULT 0,
  cost_price_per_unit   NUMERIC(10,4) NOT NULL DEFAULT 0,
  sell_price_per_unit   NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS premade_bouquet_lines_airtable_id_idx
  ON premade_bouquet_lines (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS premade_bouquet_lines_bouquet_id_idx ON premade_bouquet_lines (bouquet_id);
CREATE INDEX IF NOT EXISTS premade_bouquet_lines_stock_id_idx   ON premade_bouquet_lines (stock_id);
