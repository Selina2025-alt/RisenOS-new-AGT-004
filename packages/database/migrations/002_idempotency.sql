CREATE UNIQUE INDEX IF NOT EXISTS content_assets_org_mission_unique
  ON content_assets (organization_id, mission_id);

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_org_mission_unique
  ON agent_runs (organization_id, mission_id);
