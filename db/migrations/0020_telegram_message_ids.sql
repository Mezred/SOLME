-- The sent Telegram message, so an alert can be edited in place later (e.g. when the coin's scam check finishes).
ALTER TABLE notifications ADD COLUMN tg_chat_id text;
ALTER TABLE notifications ADD COLUMN tg_message_id bigint;
CREATE INDEX notifications_tg_coin_idx ON notifications ((meta->>'address'), created_at DESC) WHERE tg_message_id IS NOT NULL;
