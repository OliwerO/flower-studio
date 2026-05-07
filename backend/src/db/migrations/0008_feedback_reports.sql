CREATE TABLE IF NOT EXISTS feedback_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_issue_number INTEGER NOT NULL,
  reporter_role       TEXT NOT NULL,
  reporter_name       TEXT NOT NULL,
  telegram_chat_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index: only real report rows (issue_number > 0) are unique.
-- Sentinel rows (issue_number = 0) used by Telegram bot /start registration are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS feedback_reports_issue_number_idx ON feedback_reports (github_issue_number) WHERE github_issue_number > 0;
