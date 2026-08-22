CREATE TABLE IF NOT EXISTS agent_team_runs (
  organization_id text NOT NULL,
  run_id text NOT NULL,
  mission_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, run_id),
  UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  organization_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  mission_id text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, task_id),
  UNIQUE (task_id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, run_id) REFERENCES agent_team_runs (organization_id, run_id)
);

CREATE TABLE IF NOT EXISTS agent_task_results (
  organization_id text NOT NULL,
  task_id text NOT NULL,
  payload jsonb NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, task_id),
  FOREIGN KEY (organization_id, task_id) REFERENCES agent_tasks (organization_id, task_id)
);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  organization_id text NOT NULL,
  artifact_id text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  ref_payload jsonb NOT NULL,
  content_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, artifact_id),
  UNIQUE (artifact_id)
);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  organization_id text NOT NULL,
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, checkpoint_id),
  UNIQUE (checkpoint_id),
  FOREIGN KEY (organization_id, task_id) REFERENCES agent_tasks (organization_id, task_id)
);

CREATE TABLE IF NOT EXISTS human_gate_decisions (
  organization_id text NOT NULL,
  decision_id text NOT NULL,
  run_id text NOT NULL,
  idempotency_key text NOT NULL,
  artifact_id text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, decision_id),
  UNIQUE (decision_id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, run_id) REFERENCES agent_team_runs (organization_id, run_id),
  FOREIGN KEY (organization_id, artifact_id) REFERENCES agent_artifacts (organization_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS agent_runtime_events (
  organization_id text NOT NULL,
  event_id bigserial PRIMARY KEY,
  run_id text,
  task_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_mission_locks (
  organization_id text NOT NULL,
  mission_id text NOT NULL,
  owner_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_ready
  ON agent_tasks (organization_id, status, updated_at)
  WHERE status IN ('READY', 'RUNNING', 'WAITING_INPUT', 'WAITING_HUMAN');

CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_trace
  ON agent_runtime_events (organization_id, ((payload->>'traceId')), occurred_at);

CREATE OR REPLACE FUNCTION reject_agent_immutable_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_artifacts_immutable ON agent_artifacts;
CREATE TRIGGER trg_agent_artifacts_immutable
BEFORE UPDATE OR DELETE ON agent_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_agent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_agent_results_immutable ON agent_task_results;
CREATE TRIGGER trg_agent_results_immutable
BEFORE UPDATE OR DELETE ON agent_task_results
FOR EACH ROW EXECUTE FUNCTION reject_agent_immutable_mutation();

DROP TRIGGER IF EXISTS trg_human_gate_decisions_immutable ON human_gate_decisions;
CREATE TRIGGER trg_human_gate_decisions_immutable
BEFORE UPDATE OR DELETE ON human_gate_decisions
FOR EACH ROW EXECUTE FUNCTION reject_agent_immutable_mutation();
