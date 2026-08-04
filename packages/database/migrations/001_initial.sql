CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'CREATOR', 'REVIEWER', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS content_missions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  trace_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  mission_id text NOT NULL,
  trace_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS content_assets (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  mission_id text NOT NULL,
  trace_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS content_versions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  parent_version_id text,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, asset_id, version_number)
);

CREATE TABLE IF NOT EXISTS content_validations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_id text NOT NULL,
  version_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  mission_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS review_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_id text NOT NULL,
  version_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  review_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_assets (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  content_asset_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS content_packages (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  content_asset_id text NOT NULL,
  status text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_packages (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  skill_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  trace_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  actor_id text NOT NULL,
  snapshot jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS missions_org_updated_idx
  ON content_missions (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS runs_org_mission_idx
  ON agent_runs (organization_id, mission_id);
CREATE INDEX IF NOT EXISTS assets_org_updated_idx
  ON content_assets (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS versions_org_asset_idx
  ON content_versions (organization_id, asset_id, version_number);
CREATE INDEX IF NOT EXISTS validations_org_version_idx
  ON content_validations (organization_id, version_id);
CREATE INDEX IF NOT EXISTS reviews_org_asset_idx
  ON review_requests (organization_id, asset_id);
CREATE INDEX IF NOT EXISTS packages_org_asset_idx
  ON content_packages (organization_id, content_asset_id);
CREATE INDEX IF NOT EXISTS audit_trace_idx
  ON audit_events (organization_id, trace_id, occurred_at);

CREATE OR REPLACE FUNCTION reject_content_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content_versions are immutable; create a new version';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_versions_no_update ON content_versions;
CREATE TRIGGER content_versions_no_update
  BEFORE UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION reject_content_version_mutation();
