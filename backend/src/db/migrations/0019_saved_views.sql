-- Explorer: saved views (ADR-0010). Single-owner app — no per-user scoping,
-- a saved view belongs to the Owner. `spec` stores the same declarative
-- query_records spec the engine validates (validation happens at query time
-- in the route layer, not here). Soft-deleted via deleted_at so a "remove"
-- never destroys history.
CREATE TABLE IF NOT EXISTS saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  spec       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS saved_views_created_idx
  ON saved_views (created_at DESC);
