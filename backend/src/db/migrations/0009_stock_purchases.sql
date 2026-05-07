CREATE TABLE IF NOT EXISTS stock_purchases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id         TEXT,
  purchase_date       TEXT NOT NULL,
  supplier            TEXT NOT NULL DEFAULT '',
  stock_id            UUID REFERENCES stock(id),
  stock_airtable_id   TEXT,
  quantity_purchased  INTEGER NOT NULL DEFAULT 0,
  price_per_unit      NUMERIC(10, 4),
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_purchases_airtable_id_idx
  ON stock_purchases (airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_purchases_date_idx
  ON stock_purchases (purchase_date);
CREATE INDEX IF NOT EXISTS stock_purchases_stock_id_idx
  ON stock_purchases (stock_id);
