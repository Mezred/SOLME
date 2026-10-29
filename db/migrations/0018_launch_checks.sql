-- Background scam-check results for fresh launchpad coins (proven-dev launches, curves near migration),
-- so the Early and Trenches lists can show a verdict without running the check on every page view.
CREATE TABLE launch_checks (
  mint       text PRIMARY KEY,
  chain      text NOT NULL,
  passed     boolean,          -- null: could not be checked (no DEX market yet)
  verdict    text,
  reason     text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON launch_checks TO nexalpha_app;
