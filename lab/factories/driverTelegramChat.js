// lab/factories/driverTelegramChat.js
//
// Synthetic DriverTelegramChat row — matches backend/src/db/schema.js
// `driver_telegram_chats` table.
//
// Schema: driver_name (PK), chat_id (nullable), lang (NOT NULL default 'ru'),
//         registered_at

export function makeDriverTelegramChat(overrides = {}) {
  return {
    driver_name: 'Nikita',
    chat_id: '100000001',
    lang: 'ru',
    ...overrides,
  };
}
