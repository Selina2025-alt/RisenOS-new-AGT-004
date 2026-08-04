CREATE TABLE IF NOT EXISTS content_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS content_templates_org_status_idx
  ON content_templates (organization_id, status, updated_at DESC);
