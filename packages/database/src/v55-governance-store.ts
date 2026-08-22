import postgres, { type Sql } from "postgres";

import {
  ClaimDecisionInputSchema,
  KnowledgeClaimCardSchema,
  KnowledgeConflictSchema,
  KnowledgeSnapshotSchema,
  MissionPreflightSchema,
  PerspectiveContractSchema,
  type ClaimDecisionInput,
  type KnowledgeClaimCard,
  type KnowledgeConflict,
  type KnowledgeSnapshot,
  type MissionPreflight,
  type PerspectiveContract,
} from "@risen/content-contracts";
import type { V55GovernanceRepository } from "@risen/content-core";
import { ConflictError, NotFoundError, nowIso } from "@risen/content-core";

type GovernanceObjectType = "preflight" | "perspective" | "snapshot" | "claim_card" | "conflict";

export class PostgresV55GovernanceStore implements V55GovernanceRepository {
  private readonly sql: Sql;

  public constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 5 });
  }

  async load(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  async seedKnowledge(claimCards: unknown[], conflicts: unknown[]): Promise<void> {
    const cards = claimCards.map((item) => KnowledgeClaimCardSchema.parse(item));
    const parsedConflicts = conflicts.map((item) => KnowledgeConflictSchema.parse(item));
    await this.sql.begin(async (transaction) => {
      for (const card of cards) {
        await transaction`
          INSERT INTO v55_governance_objects
            (organization_id, object_type, object_key, status, payload, created_at, updated_at)
          VALUES
            (${card.organizationId}, 'claim_card', ${card.claimId}, ${card.status}, ${transaction.json(card)}, ${card.createdAt}, ${card.updatedAt})
          ON CONFLICT (organization_id, object_type, object_key) DO NOTHING
        `;
      }
      for (const conflict of parsedConflicts) {
        await transaction`
          INSERT INTO v55_governance_objects
            (organization_id, object_type, object_key, status, payload, created_at, updated_at)
          VALUES
            (${conflict.organizationId}, 'conflict', ${conflict.conflictId}, ${conflict.status}, ${transaction.json(conflict)}, ${conflict.createdAt}, ${conflict.updatedAt})
          ON CONFLICT (organization_id, object_type, object_key) DO NOTHING
        `;
      }
    });
  }

  async saveMissionGate(preflight: MissionPreflight, perspective: PerspectiveContract, snapshot?: KnowledgeSnapshot): Promise<void> {
    if (preflight.organizationId !== perspective.organizationId || (snapshot && snapshot.organizationId !== preflight.organizationId)) {
      throw new ConflictError("ORGANIZATION_MISMATCH", "Governance objects must belong to the same organization");
    }
    await this.sql.begin(async (transaction) => {
      await this.upsertMutable(transaction, "preflight", preflight.missionId, preflight);
      await this.upsertMutable(transaction, "perspective", perspective.missionId, perspective);
      if (snapshot) {
        const existing = await transaction`
          SELECT object_key FROM v55_governance_objects
          WHERE organization_id = ${snapshot.organizationId}
            AND object_type = 'snapshot'
            AND object_key = ${snapshot.snapshotId}
          LIMIT 1
        `;
        if (existing.length) throw new ConflictError("IMMUTABLE_KNOWLEDGE_SNAPSHOT", "KnowledgeSnapshot cannot be overwritten");
        await transaction`
          INSERT INTO v55_governance_objects
            (organization_id, object_type, object_key, status, payload, created_at, updated_at)
          VALUES
            (${snapshot.organizationId}, 'snapshot', ${snapshot.snapshotId}, ${snapshot.status}, ${transaction.json(snapshot)}, ${snapshot.createdAt}, ${snapshot.updatedAt})
        `;
      }
    });
  }

  async getPreflight(missionId: string, organizationId: string): Promise<MissionPreflight | undefined> {
    return this.getByMission("preflight", missionId, organizationId, MissionPreflightSchema.parse);
  }

  async getPerspective(missionId: string, organizationId: string): Promise<PerspectiveContract | undefined> {
    return this.getByMission("perspective", missionId, organizationId, PerspectiveContractSchema.parse);
  }

  async getSnapshot(missionId: string, organizationId: string): Promise<KnowledgeSnapshot | undefined> {
    return this.getByMission("snapshot", missionId, organizationId, KnowledgeSnapshotSchema.parse, "ACTIVE");
  }

  async getClaimCards(ids: string[], organizationId: string): Promise<KnowledgeClaimCard[]> {
    if (!ids.length) return [];
    const rows = await this.sql`
      SELECT payload FROM v55_governance_objects
      WHERE organization_id = ${organizationId}
        AND object_type = 'claim_card'
        AND object_key IN ${this.sql(ids)}
    `;
    const cards = rows.map((row) => KnowledgeClaimCardSchema.parse(row.payload));
    const found = new Set(cards.map((card) => card.claimId));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new NotFoundError("KnowledgeClaimCard", missing.join(","));
    const byId = new Map(cards.map((card) => [card.claimId, card]));
    return ids.map((id) => byId.get(id)!);
  }

  async listConflicts(organizationId: string): Promise<KnowledgeConflict[]> {
    const rows = await this.sql`
      SELECT payload FROM v55_governance_objects
      WHERE organization_id = ${organizationId} AND object_type = 'conflict'
      ORDER BY created_at ASC
    `;
    return rows.map((row) => KnowledgeConflictSchema.parse(row.payload));
  }

  async decideClaim(input: ClaimDecisionInput, organizationId: string): Promise<KnowledgeClaimCard> {
    const decision = ClaimDecisionInputSchema.parse(input);
    const rows = await this.sql`
      SELECT payload FROM v55_governance_objects
      WHERE organization_id = ${organizationId}
        AND object_type = 'claim_card'
        AND object_key = ${decision.claimId}
      LIMIT 1
    `;
    if (!rows.length) throw new NotFoundError("KnowledgeClaimCard", decision.claimId);
    const current = KnowledgeClaimCardSchema.parse(rows[0]!.payload);
    const status: KnowledgeClaimCard["status"] =
      decision.decision === "APPROVE" ? "ACTIVE" :
      decision.decision === "REJECT" ? "REJECTED" :
      decision.decision === "SUPERSEDE" ? "SUPERSEDED" : "CONFLICTING";
    const updated = KnowledgeClaimCardSchema.parse({
      ...current,
      status,
      approvedBy: decision.decision === "APPROVE" ? decision.decidedBy : current.approvedBy,
      updatedAt: nowIso(),
    });
    await this.sql`
      UPDATE v55_governance_objects
      SET status = ${updated.status}, payload = ${this.sql.json(updated)}, updated_at = ${updated.updatedAt}
      WHERE organization_id = ${organizationId}
        AND object_type = 'claim_card'
        AND object_key = ${decision.claimId}
    `;
    return updated;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private async upsertMutable(
    sql: postgres.TransactionSql,
    objectType: Exclude<GovernanceObjectType, "snapshot" | "claim_card" | "conflict">,
    objectKey: string,
    value: MissionPreflight | PerspectiveContract,
  ): Promise<void> {
    await sql`
      INSERT INTO v55_governance_objects
        (organization_id, object_type, object_key, status, payload, created_at, updated_at)
      VALUES
        (${value.organizationId}, ${objectType}, ${objectKey}, ${value.status}, ${sql.json(value)}, ${value.createdAt}, ${value.updatedAt})
      ON CONFLICT (organization_id, object_type, object_key)
      DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
    `;
  }

  private async getByMission<T>(
    objectType: "preflight" | "perspective" | "snapshot",
    missionId: string,
    organizationId: string,
    parse: (value: unknown) => T,
    status?: string,
  ): Promise<T | undefined> {
    const rows = status
      ? await this.sql`
          SELECT payload FROM v55_governance_objects
          WHERE organization_id = ${organizationId} AND object_type = ${objectType}
            AND payload->>'missionId' = ${missionId} AND status = ${status}
          ORDER BY created_at DESC LIMIT 1
        `
      : await this.sql`
          SELECT payload FROM v55_governance_objects
          WHERE organization_id = ${organizationId} AND object_type = ${objectType}
            AND payload->>'missionId' = ${missionId}
          ORDER BY created_at DESC LIMIT 1
        `;
    return rows.length ? parse(rows[0]!.payload) : undefined;
  }
}
