import { createHash, randomUUID } from "node:crypto";

import {
  AgentCheckpointSchema,
  AgentTaskResultSchema,
  AgentTaskSchema,
  ArtifactRefSchema,
  HumanGateDecisionSchema,
  TeamRunSchema,
  type AgentCheckpoint,
  type AgentTask,
  type AgentTaskResult,
  type ArtifactRef,
  type HumanGateDecision,
  type TeamRun,
} from "@risen/content-contracts";
import type { AgentTaskStore, MissionLock, StoredArtifact } from "@risen/content-core";
import postgres, { type Sql } from "postgres";

export class PostgresAgentTaskStore implements AgentTaskStore {
  private readonly sql: Sql;

  public constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 8 });
  }

  async saveTask(task: AgentTask): Promise<void> {
    const value = AgentTaskSchema.parse(task);
    await this.sql`
      INSERT INTO agent_tasks
        (organization_id, task_id, run_id, mission_id, status, idempotency_key, payload, lease_expires_at, created_at, updated_at)
      VALUES
        (${value.organizationId}, ${value.taskId}, ${value.rootRunId}, ${value.missionId}, ${value.status}, ${value.idempotencyKey},
         ${this.sql.json(value)}, ${value.lease?.expiresAt ?? null}, ${value.createdAt}, ${value.updatedAt})
      ON CONFLICT (organization_id, task_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        payload = EXCLUDED.payload,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = EXCLUDED.updated_at,
        version = agent_tasks.version + 1
      WHERE agent_tasks.updated_at <= EXCLUDED.updated_at
    `;
  }

  async getTask(taskId: string): Promise<AgentTask | undefined> {
    const rows = await this.sql`SELECT payload FROM agent_tasks WHERE task_id = ${taskId} LIMIT 1`;
    return rows.length ? AgentTaskSchema.parse(rows[0]!.payload) : undefined;
  }

  async listTasks(): Promise<AgentTask[]> {
    const rows = await this.sql`SELECT payload FROM agent_tasks ORDER BY created_at ASC`;
    return rows.map((row) => AgentTaskSchema.parse(row.payload));
  }

  async saveTaskResult(result: AgentTaskResult): Promise<void> {
    const value = AgentTaskResultSchema.parse(result);
    const tasks = await this.sql`SELECT organization_id FROM agent_tasks WHERE task_id = ${value.taskId} LIMIT 1`;
    if (!tasks.length) throw new Error(`Task ${value.taskId} does not exist`);
    const organizationId = String(tasks[0]!.organization_id);
    const inserted = await this.sql`
      INSERT INTO agent_task_results (organization_id, task_id, payload, completed_at)
      VALUES (${organizationId}, ${value.taskId}, ${this.sql.json(value)}, ${value.completedAt})
      ON CONFLICT (organization_id, task_id) DO NOTHING
      RETURNING task_id
    `;
    if (!inserted.length) {
      const existing = await this.getTaskResult(value.taskId);
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(`TaskResult is immutable for ${value.taskId}`);
    }
  }

  async getTaskResult(taskId: string): Promise<AgentTaskResult | undefined> {
    const rows = await this.sql`SELECT payload FROM agent_task_results WHERE task_id = ${taskId} LIMIT 1`;
    return rows.length ? AgentTaskResultSchema.parse(rows[0]!.payload) : undefined;
  }

  async listTaskResults(): Promise<AgentTaskResult[]> {
    const rows = await this.sql`SELECT payload FROM agent_task_results ORDER BY completed_at ASC`;
    return rows.map((row) => AgentTaskResultSchema.parse(row.payload));
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    const value = AgentCheckpointSchema.parse(checkpoint);
    await this.sql`
      INSERT INTO agent_checkpoints (organization_id, checkpoint_id, task_id, payload, created_at)
      VALUES (${value.organizationId}, ${value.id}, ${value.taskId}, ${this.sql.json(value)}, ${value.createdAt})
      ON CONFLICT (organization_id, checkpoint_id) DO NOTHING
    `;
  }

  async listCheckpoints(): Promise<AgentCheckpoint[]> {
    const rows = await this.sql`SELECT payload FROM agent_checkpoints ORDER BY created_at ASC`;
    return rows.map((row) => AgentCheckpointSchema.parse(row.payload));
  }

  async saveArtifact(artifact: StoredArtifact): Promise<ArtifactRef> {
    if (!artifact.organizationId) throw new Error("PostgreSQL artifacts require organizationId");
    const ref = ArtifactRefSchema.parse(artifact.ref);
    const canonical = JSON.stringify(artifact.payload, null, 2) + "\n";
    const actualHash = createHash("sha256").update(canonical, "utf8").digest("hex");
    if (actualHash !== ref.contentHash) throw new Error(`Artifact hash mismatch for ${ref.artifactId}`);
    const inserted = await this.sql`
      INSERT INTO agent_artifacts (organization_id, artifact_id, content_hash, ref_payload, content_payload)
      VALUES (${artifact.organizationId}, ${ref.artifactId}, ${ref.contentHash}, ${this.sql.json(ref)}, ${this.sql.json(JSON.parse(JSON.stringify(artifact.payload)))})
      ON CONFLICT (organization_id, artifact_id) DO NOTHING
      RETURNING artifact_id
    `;
    if (!inserted.length) {
      const existing = await this.getArtifact(ref.artifactId);
      if (!existing || existing.ref.contentHash !== ref.contentHash) throw new Error(`Artifact is immutable for ${ref.artifactId}`);
    }
    return ref;
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | undefined> {
    const rows = await this.sql`
      SELECT organization_id, ref_payload, content_payload FROM agent_artifacts
      WHERE artifact_id = ${artifactId} LIMIT 1
    `;
    if (!rows.length) return undefined;
    return {
      organizationId: String(rows[0]!.organization_id),
      ref: ArtifactRefSchema.parse(rows[0]!.ref_payload),
      payload: rows[0]!.content_payload,
    };
  }

  async listArtifactRefs(): Promise<ArtifactRef[]> {
    const rows = await this.sql`SELECT ref_payload FROM agent_artifacts ORDER BY created_at ASC`;
    return rows.map((row) => ArtifactRefSchema.parse(row.ref_payload));
  }

  async saveHumanGateDecision(decision: HumanGateDecision): Promise<void> {
    const value = HumanGateDecisionSchema.parse(decision);
    const inserted = await this.sql`
      INSERT INTO human_gate_decisions
        (organization_id, decision_id, run_id, idempotency_key, artifact_id, artifact_hash, payload, decided_at)
      VALUES
        (${value.organizationId}, ${value.decisionId}, ${value.runId}, ${value.idempotencyKey},
         ${value.artifactId}, ${value.artifactHash}, ${this.sql.json(value)}, ${value.decidedAt})
      ON CONFLICT (organization_id, decision_id) DO NOTHING
      RETURNING decision_id
    `;
    if (!inserted.length) throw new Error(`HumanGateDecision is immutable for ${value.decisionId}`);
  }

  async listHumanGateDecisions(runId?: string): Promise<HumanGateDecision[]> {
    const rows = runId
      ? await this.sql`SELECT payload FROM human_gate_decisions WHERE run_id = ${runId} ORDER BY decided_at ASC`
      : await this.sql`SELECT payload FROM human_gate_decisions ORDER BY decided_at ASC`;
    return rows.map((row) => HumanGateDecisionSchema.parse(row.payload));
  }

  async saveTeamRun(run: TeamRun): Promise<void> {
    const value = TeamRunSchema.parse(run);
    await this.sql`
      INSERT INTO agent_team_runs
        (organization_id, run_id, mission_id, status, payload, created_at, updated_at)
      VALUES
        (${value.organizationId}, ${value.runId}, ${value.missionId}, ${value.status}, ${this.sql.json(value)}, ${value.createdAt}, ${value.updatedAt})
      ON CONFLICT (organization_id, run_id)
      DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at, version = agent_team_runs.version + 1
      WHERE agent_team_runs.updated_at <= EXCLUDED.updated_at
    `;
  }

  async getTeamRun(runId: string): Promise<TeamRun | undefined> {
    const rows = await this.sql`SELECT payload FROM agent_team_runs WHERE run_id = ${runId} LIMIT 1`;
    return rows.length ? TeamRunSchema.parse(rows[0]!.payload) : undefined;
  }

  async listTeamRuns(): Promise<TeamRun[]> {
    const rows = await this.sql`SELECT payload FROM agent_team_runs ORDER BY created_at ASC`;
    return rows.map((row) => TeamRunSchema.parse(row.payload));
  }

  async acquireMissionLock(missionId: string, organizationId: string): Promise<MissionLock> {
    const owner = randomUUID();
    const rows = await this.sql`
      INSERT INTO agent_mission_locks (organization_id, mission_id, owner_token, expires_at)
      VALUES (${organizationId}, ${missionId}, ${owner}, now() + interval '5 minutes')
      ON CONFLICT (organization_id, mission_id)
      DO UPDATE SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
      WHERE agent_mission_locks.expires_at <= now()
      RETURNING owner_token
    `;
    if (!rows.length || rows[0]!.owner_token !== owner) throw new Error(`Mission ${missionId} is already locked`);
    let released = false;
    return {
      renew: async () => {
        if (released) throw new Error("Mission lock is already released");
        const renewed = await this.sql`
          UPDATE agent_mission_locks SET expires_at = now() + interval '5 minutes'
          WHERE organization_id = ${organizationId} AND mission_id = ${missionId} AND owner_token = ${owner}
          RETURNING owner_token
        `;
        if (!renewed.length) throw new Error(`Mission ${missionId} lock ownership was lost`);
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.sql`
          DELETE FROM agent_mission_locks
          WHERE organization_id = ${organizationId} AND mission_id = ${missionId} AND owner_token = ${owner}
        `;
      },
    };
  }

  async appendEvent(event: Record<string, unknown>): Promise<void> {
    const organizationId = String(event.organizationId ?? "");
    if (!organizationId) throw new Error("Runtime events require organizationId");
    await this.sql`
      INSERT INTO agent_runtime_events (organization_id, run_id, task_id, event_type, payload, occurred_at)
      VALUES (${organizationId}, ${event.runId ? String(event.runId) : null},
        ${event.taskId ? String(event.taskId) : null}, ${String(event.event ?? "RUNTIME_EVENT")},
        ${this.sql.json(JSON.parse(JSON.stringify(event)))}, ${event.at ? String(event.at) : new Date().toISOString()})
    `;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
