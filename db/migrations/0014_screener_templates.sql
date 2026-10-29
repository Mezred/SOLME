-- Saved Screener filter sets ("templates"), private to each user.
CREATE TABLE screener_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX screener_templates_user_idx ON screener_templates (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON screener_templates TO nexalpha_app;
ALTER TABLE screener_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY screener_templates_owner ON screener_templates FOR ALL TO nexalpha_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
