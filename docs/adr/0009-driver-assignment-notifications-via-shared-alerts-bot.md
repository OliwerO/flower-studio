# Driver Assignment Notifications ride the shared alerts bot, not a dedicated driver bot

Status: accepted

Issue #336 (driver half). When a Delivery or Stock Order is assigned to a Driver, we notify that Driver via Telegram. We send these **Assignment Notifications** through the existing alerts bot (`TELEGRAM_BOT_TOKEN`) — the same bot that already sends Owner alerts — rather than provisioning a separate driver bot. Each Driver registers their chat by sending `/start <PIN>` to that bot; their `chat_id` is stored in a dedicated `driver_telegram_chats` table (keyed by driver name, resolved from `PIN_DRIVER_*`). Inbound `/start` is handled by a second `getUpdates` long-poll loop on the alerts-bot token, mirroring `feedbackTelegramBot.js` (separate offset key in `system_meta`).

## Why

A Telegram `chat_id` is bot-specific: a person only receives messages from a bot they personally started. So notifying a Driver requires (a) the Driver to have `/start`-ed a specific bot and (b) us to store the resulting `chat_id`. Reusing the alerts bot means one bot for all operational messaging and one `/start` per Driver. A dedicated driver bot would be cleaner in isolation but adds a third BotFather token to provision and a third `/start` for staff — and switching bots later forces every Driver to re-register, which is the expensive, hard-to-reverse part.

Driver `chat_id`s live in their own table, deliberately **separate** from the `TELEGRAM_CHAT_IDS` broadcast list. This guarantees Drivers receive only their own Assignment Notifications and never the Owner/Florist new-order or delivery-complete broadcasts.

## Considered alternatives

- **Dedicated driver bot** — cleanest separation of "ops alerts" from "you've been assigned," but a third token to manage and a third registration step. Rejected: the separation isn't worth the operational overhead at 2 drivers.
- **Feedback bot (`FEEDBACK_BOT_TOKEN`)** — already has a `/start <PIN>` flow and a running poll loop, so reuse is tempting. Rejected: it would mix "report a bug" and "you've got a delivery" into one bot, and its registration maps PINs to *reporter roles*, not driver identities.
- **Static `TELEGRAM_DRIVER_<NAME>_CHAT_ID` env vars** — no DB, no poll loop. Rejected: requires hand-finding each `chat_id` out-of-band and editing Railway env on every staff change.

## Consequences

- The alerts bot is now an inbound consumer. Only one `getUpdates` consumer may exist per token, so any future inbound use of `TELEGRAM_BOT_TOKEN` must route through this same loop — do not start a second poller on this token.
- Adding the deferred Florist new-order alert (the other half of #336) is now cheap: Florists register through the same `/start` handler (extend PIN resolution to florist PINs); no new bot or table.
- Driver-of-day bulk assignment sends one **digest** message, not one-per-delivery, to avoid a burst of pings.
- Each Driver has an Owner-controlled Notification Language (`ru`/`en`/`pl`, default `ru`) stored on the same `driver_telegram_chats` row. `chat_id` is nullable so the Owner can set a Driver's language before they register. Messages are composed from a language-keyed strings table in `driverNotifyService`; an unknown language falls back to `ru`.

## Florist extension (2026-06-02)

The deferred florist half of #336 reuses this same bot and `/start` loop with one structural difference: florists share a single PIN (`PIN_FLORIST`) and a single phone, so there is no per-florist row. Storage is a singleton in `system_meta` (`florist_chat_id` + `florist_notify_lang` kv keys) rather than a row in `driver_telegram_chats`. The existing `/start` handler in `driverBot.js` was extended — after driver-PIN resolution misses, it tries `resolveFloristByPin`; a match writes the chat_id via `floristTelegramRepo` and replies in the stored group language. `floristNotifyService.notifyFloristNewOrder` is called at both Order-creation seams (`orderService.createOrder` and `wix.js`) as a fire-and-forget, mirrors the never-throws contract of `driverNotifyService`, and skips silently if the phone is unregistered. The Owner sets the group language via `PUT /settings/florist-language`.
