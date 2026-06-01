-- chat_id is nullable: the Owner may set a Driver's language before the Driver
-- has registered a chat. lang defaults to Russian (the launch language).
CREATE TABLE IF NOT EXISTS driver_telegram_chats (
  driver_name   text PRIMARY KEY,
  chat_id       text,
  lang          text NOT NULL DEFAULT 'ru',
  registered_at timestamptz NOT NULL DEFAULT now()
);
