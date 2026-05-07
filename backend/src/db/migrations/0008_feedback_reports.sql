CREATE TABLE IF NOT EXISTS feedback_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_issue_number INTEGER NOT NULL,
  reporter_role       TEXT NOT NULL,
  reporter_name       TEXT NOT NULL,
  telegram_chat_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_reports_issue_number_idx ON feedback_reports (github_issue_number);
