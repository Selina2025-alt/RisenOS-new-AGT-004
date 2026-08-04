CREATE TABLE IF NOT EXISTS legacy_import_records (
  organization_id text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, source_type, source_id)
);
