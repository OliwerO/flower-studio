CREATE TABLE IF NOT EXISTS feedback_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_role        TEXT NOT NULL,
  reporter_name        TEXT NOT NULL,
  app_area             TEXT,
  messages             JSONB NOT NULL DEFAULT '[]',
  last_question        TEXT,
  done                 BOOLEAN NOT NULL DEFAULT FALSE,
  title                TEXT,
  english_description  TEXT,
  acceptance_criteria  JSONB,
  original_quote       TEXT,
  summary              TEXT,
  type                 TEXT,
  telegram_chat_id     TEXT,
  published            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_sessions_expires_idx ON feedback_sessions (expires_at) WHERE NOT published;
