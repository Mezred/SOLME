-- One-tap mutes from Telegram alert buttons: a dev, a wallet or a coin, for a while.
CREATE TABLE alert_mutes (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('dev', 'wallet', 'coin')),
  value      text NOT NULL,
  until      timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, value)
);

-- Quiet hours in the user's timezone ("HH:MM"); Telegram alerts in that window are sent as one summary afterwards.
ALTER TABLE profiles ADD COLUMN quiet_start text CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE profiles ADD COLUMN quiet_end text CHECK (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Held for a summary (quiet hours) instead of being sent on its own.
ALTER TABLE notifications ADD COLUMN digest boolean NOT NULL DEFAULT false;
