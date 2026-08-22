import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("V5.5 governance migration", () => {
  it("creates organization-scoped governance storage and an immutable snapshot trigger", async () => {
    const migration = await readFile(new URL("../migrations/009_v55_governance.sql", import.meta.url), "utf8");
    expect(migration).toContain("v55_governance_objects");
    expect(migration).toContain("organization_id text NOT NULL");
    expect(migration).toContain("reject_v55_snapshot_mutation");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });

  it("adds organization-scoped team runtime tables and immutable artifacts and decisions", async () => {
    const migration = await readFile(new URL("../migrations/010_agent_team_runtime.sql", import.meta.url), "utf8");
    for (const table of [
      "agent_team_runs", "agent_tasks", "agent_task_results", "agent_artifacts",
      "agent_checkpoints", "human_gate_decisions", "agent_runtime_events",
    ]) expect(migration).toContain(table);
    expect(migration).toContain("organization_id text NOT NULL");
    expect(migration).toContain("reject_agent_immutable_mutation");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });
});
