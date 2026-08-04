CREATE TABLE IF NOT EXISTS source_attachments (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL,
  checksum text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, checksum)
);

CREATE INDEX IF NOT EXISTS source_attachments_org_status_idx
  ON source_attachments (organization_id, status, updated_at DESC);
