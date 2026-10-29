-- One-click Telegram linking: a short-lived token travels in the bot's /start deep link.
ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check CHECK (purpose IN ('verify_email', 'reset_password', 'telegram_link'));
