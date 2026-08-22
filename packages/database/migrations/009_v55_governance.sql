CREATE TABLE IF NOT EXISTS v55_governance_objects (
  organization_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('preflight', 'perspective', 'snapshot', 'claim_card', 'conflict')),
  object_key text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, object_type, object_key)
);

CREATE INDEX IF NOT EXISTS idx_v55_governance_mission
  ON v55_governance_objects (organization_id, object_type, ((payload->>'missionId')));

CREATE INDEX IF NOT EXISTS idx_v55_governance_status
  ON v55_governance_objects (organization_id, object_type, status);

CREATE OR REPLACE FUNCTION reject_v55_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.object_type = 'snapshot' THEN
    RAISE EXCEPTION 'V5.5 KnowledgeSnapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_v55_snapshot_immutable ON v55_governance_objects;
CREATE TRIGGER trg_v55_snapshot_immutable
BEFORE UPDATE OR DELETE ON v55_governance_objects
FOR EACH ROW EXECUTE FUNCTION reject_v55_snapshot_mutation();
