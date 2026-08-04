CREATE TABLE IF NOT EXISTS content_batches (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS content_batches_org_status_idx
  ON content_batches (organization_id, status, updated_at DESC);
