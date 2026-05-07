-- Phase 6: Config + log tables
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS florist_hours (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id    TEXT,
  name           TEXT NOT NULL,
  date           DATE NOT NULL,
  hours          NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate    NUMERIC(8,2) NOT NULL DEFAULT 0,
  rate_type      TEXT,
  bonus          NUMERIC(8,2) NOT NULL DEFAULT 0,
  deduction      NUMERIC(8,2) NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  delivery_count INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS florist_hours_airtable_id_idx ON florist_hours(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS florist_hours_date_idx ON florist_hours(date);
CREATE INDEX IF NOT EXISTS florist_hours_name_idx ON florist_hours(name);

CREATE TABLE IF NOT EXISTS marketing_spend (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT,
  month       DATE NOT NULL,
  channel     TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_spend_airtable_id_idx ON marketing_spend(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_spend_month_idx ON marketing_spend(month);

CREATE TABLE IF NOT EXISTS stock_loss_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT,
  date        DATE NOT NULL,
  stock_id    UUID REFERENCES stock(id) ON DELETE SET NULL,
  quantity    NUMERIC(8,2) NOT NULL,
  reason      TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_loss_log_airtable_id_idx ON stock_loss_log(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_loss_log_date_idx ON stock_loss_log(date);
CREATE INDEX IF NOT EXISTS stock_loss_log_stock_id_idx ON stock_loss_log(stock_id);

CREATE TABLE IF NOT EXISTS webhook_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wix_order_id TEXT NOT NULL,
  status       TEXT NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL,
  app_order_id TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_log_wix_order_id_idx ON webhook_log(wix_order_id);
CREATE INDEX IF NOT EXISTS webhook_log_timestamp_idx ON webhook_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL,
  new_products  INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  deactivated   INTEGER NOT NULL DEFAULT 0,
  price_syncs   INTEGER NOT NULL DEFAULT 0,
  stock_syncs   INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sync_log_timestamp_idx ON sync_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS product_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id    TEXT,
  wix_product_id TEXT,
  wix_variant_id TEXT,
  product_name   TEXT NOT NULL DEFAULT '',
  variant_name   TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  image_url      TEXT NOT NULL DEFAULT '',
  price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  visible_in_wix BOOLEAN NOT NULL DEFAULT TRUE,
  product_type   TEXT,
  min_stems      INTEGER NOT NULL DEFAULT 0,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT,
  key_flower     TEXT,
  quantity       INTEGER,
  available_from DATE,
  available_to   DATE,
  translations   JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS product_config_airtable_id_idx ON product_config(airtable_id) WHERE airtable_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_config_wix_pair_idx ON product_config(wix_product_id, wix_variant_id) WHERE wix_product_id IS NOT NULL AND wix_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_config_wix_product_id_idx ON product_config(wix_product_id);
CREATE INDEX IF NOT EXISTS product_config_active_idx ON product_config(active) WHERE deleted_at IS NULL;
