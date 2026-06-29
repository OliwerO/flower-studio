-- Ask Blossom chat history. id IS the assistant sessionId (uuid the service
-- generates). messages holds the canonical Anthropic message array verbatim;
-- the service projects it to display turns before it reaches the UI. Owner-only
-- feature (single owner) → no owner column. updated_at drives the history
-- list order and is bumped on every persisted turn.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id         uuid PRIMARY KEY,
  title      text NOT NULL DEFAULT '',
  messages   jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_conversations_updated_idx
  ON assistant_conversations (updated_at DESC);
