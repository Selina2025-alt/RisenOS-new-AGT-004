import type {
  AgentRun,
  AuditEvent,
  AuditQuery,
  ContentAsset,
  ContentBatch,
  ContentMission,
  ContentPackage,
  ContentTemplate,
  ContentValidationResult,
  ContentVersion,
  EvidenceRequest,
  GeneratedAsset,
  OutboxMessage,
  Page,
  RequestIdentity,
  ReviewDecision,
  ReviewRequest,
  SkillPackage,
  SkillVersion,
  SourceAttachment,
} from "@risen/content-contracts";
import type { ContentRepository } from "@risen/content-core";
import postgres, { type Sql } from "postgres";

type QueryClient = Sql | postgres.TransactionSql;

type JsonEntity = {
  id: string;
  organizationId: string;
  traceId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export class PostgresContentRepository implements ContentRepository {
  readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 10,
      transform: { undefined: null },
    });
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async healthCheck(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  async saveMission(value: ContentMission): Promise<void> {
    await this.upsert(
      "content_missions",
      value,
      { trace_id: value.traceId, status: value.status },
    );
  }

  async getMission(id: string, organizationId: string): Promise<ContentMission | undefined> {
    return this.get<ContentMission>("content_missions", id, organizationId);
  }

  async listMissions(identity: RequestIdentity): Promise<Page<ContentMission>> {
    return this.list<ContentMission>("content_missions", identity.organizationId);
  }

  async saveRun(value: AgentRun): Promise<void> {
    await this.upsert(
      "agent_runs",
      value,
      { mission_id: value.missionId, trace_id: value.traceId, status: value.status },
    );
  }

  async claimRun(
    id: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    const timestamp = new Date().toISOString();
    const rows = await this.sql<{ payload: AgentRun }[]>`
      UPDATE agent_runs
      SET
        status = 'RUNNING',
        updated_at = ${timestamp},
        payload = jsonb_set(
          jsonb_set(payload, '{status}', '"RUNNING"'),
          '{updatedAt}',
          ${JSON.stringify(timestamp)}::jsonb
        )
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND (
          status IN ('QUEUED', 'FAILED')
          OR (status = 'RUNNING' AND updated_at <= now() - interval '30 seconds')
        )
      RETURNING payload
    `;
    return rows[0]?.payload;
  }

  async cancelQueuedRun(
    id: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    const timestamp = new Date().toISOString();
    const rows = await this.sql<{ payload: AgentRun }[]>`
      UPDATE agent_runs
      SET
        status = 'CANCELLED',
        updated_at = ${timestamp},
        payload = jsonb_set(
          jsonb_set(payload, '{status}', '"CANCELLED"'),
          '{updatedAt}',
          ${JSON.stringify(timestamp)}::jsonb
        )
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND status = 'QUEUED'
      RETURNING payload
    `;
    return rows[0]?.payload;
  }

  async getRun(id: string, organizationId: string): Promise<AgentRun | undefined> {
    return this.get<AgentRun>("agent_runs", id, organizationId);
  }

  async getRunByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    const rows = await this.sql<{ payload: AgentRun }[]>`
      SELECT payload FROM agent_runs
      WHERE organization_id = ${organizationId} AND mission_id = ${missionId}
      LIMIT 1
    `;
    return rows[0]?.payload;
  }

  async saveBatch(value: ContentBatch): Promise<void> {
    await this.upsert("content_batches", value, { status: value.status });
  }

  async getBatch(
    id: string,
    organizationId: string,
  ): Promise<ContentBatch | undefined> {
    return this.get<ContentBatch>("content_batches", id, organizationId);
  }

  async listBatches(identity: RequestIdentity): Promise<Page<ContentBatch>> {
    return this.list<ContentBatch>("content_batches", identity.organizationId);
  }

  async saveAsset(value: ContentAsset): Promise<void> {
    await this.upsert(
      "content_assets",
      value,
      { mission_id: value.missionId, trace_id: value.traceId, status: value.status },
    );
  }

  async getAsset(id: string, organizationId: string): Promise<ContentAsset | undefined> {
    return this.get<ContentAsset>("content_assets", id, organizationId);
  }

  async getAssetByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<ContentAsset | undefined> {
    const rows = await this.sql<{ payload: ContentAsset }[]>`
      SELECT payload
      FROM content_assets
      WHERE organization_id = ${organizationId} AND mission_id = ${missionId}
      ORDER BY created_at ASC
      LIMIT 1
    `;
    return rows[0]?.payload;
  }

  async listAssets(identity: RequestIdentity): Promise<Page<ContentAsset>> {
    return this.list<ContentAsset>("content_assets", identity.organizationId);
  }

  async saveVersion(value: ContentVersion): Promise<void> {
    await this.sql`
      INSERT INTO content_versions (
        id, organization_id, asset_id, version_number, parent_version_id,
        content_hash, payload, created_at
      ) VALUES (
        ${value.id}, ${value.organizationId}, ${value.assetId}, ${value.versionNumber},
        ${value.parentVersionId ?? null}, ${value.contentHash},
        ${this.sql.json(value as never)}, ${value.createdAt}
      )
    `;
    await this.audit("ContentVersion", value, "CREATED");
  }

  async getVersion(id: string, organizationId: string): Promise<ContentVersion | undefined> {
    return this.get<ContentVersion>("content_versions", id, organizationId);
  }

  async listVersions(assetId: string, organizationId: string): Promise<ContentVersion[]> {
    const rows = await this.sql<{ payload: ContentVersion }[]>`
      SELECT payload
      FROM content_versions
      WHERE organization_id = ${organizationId} AND asset_id = ${assetId}
      ORDER BY version_number ASC
    `;
    return rows.map((row) => row.payload);
  }

  async saveValidation(value: ContentValidationResult): Promise<void> {
    await this.upsert(
      "content_validations",
      value,
      { asset_id: value.assetId, version_id: value.versionId, status: value.status },
    );
  }

  async getValidation(
    id: string,
    organizationId: string,
  ): Promise<ContentValidationResult | undefined> {
    return this.get<ContentValidationResult>("content_validations", id, organizationId);
  }

  async saveEvidenceRequest(
    value: EvidenceRequest,
    outbox?: OutboxMessage,
  ): Promise<void> {
    if (!outbox) {
      await this.upsert("evidence_requests", value, {
        mission_id: value.missionId,
        status: value.status,
      });
      return;
    }
    await this.sql.begin(async (transaction) => {
      await this.upsert(
        "evidence_requests",
        value,
        { mission_id: value.missionId, status: value.status },
        transaction,
      );
      await this.upsert(
        "outbox_messages",
        outbox,
        {
          status: outbox.status,
          recipient: outbox.recipient,
          message_type: outbox.messageType,
          next_attempt_at: outbox.nextAttemptAt,
        },
        transaction,
      );
    });
  }

  async getEvidenceRequest(
    id: string,
    organizationId: string,
  ): Promise<EvidenceRequest | undefined> {
    return this.get<EvidenceRequest>("evidence_requests", id, organizationId);
  }

  async listEvidenceRequests(
    missionId: string,
    organizationId: string,
  ): Promise<EvidenceRequest[]> {
    const rows = await this.sql<{ payload: EvidenceRequest }[]>`
      SELECT payload
      FROM evidence_requests
      WHERE organization_id = ${organizationId} AND mission_id = ${missionId}
      ORDER BY created_at ASC
    `;
    return rows.map((row) => row.payload);
  }

  async saveReview(value: ReviewRequest, outbox?: OutboxMessage): Promise<void> {
    const columns = {
      asset_id: value.assetId,
      version_id: value.versionId,
      status: value.status,
    };
    if (!outbox) {
      await this.upsert("review_requests", value, columns);
      return;
    }
    await this.sql.begin(async (transaction) => {
      await this.upsert("review_requests", value, columns, transaction);
      await this.upsert(
        "outbox_messages",
        outbox,
        {
          status: outbox.status,
          recipient: outbox.recipient,
          message_type: outbox.messageType,
          next_attempt_at: outbox.nextAttemptAt,
        },
        transaction,
      );
    });
  }

  async getReview(id: string, organizationId: string): Promise<ReviewRequest | undefined> {
    return this.get<ReviewRequest>("review_requests", id, organizationId);
  }

  async saveReviewDecision(value: ReviewDecision): Promise<void> {
    await this.upsert(
      "review_decisions",
      value,
      { review_id: value.reviewId },
    );
  }

  async saveGeneratedAsset(value: GeneratedAsset): Promise<void> {
    await this.upsert(
      "generated_assets",
      value,
      { content_asset_id: value.contentAssetId, status: value.status },
    );
  }

  async getGeneratedAsset(
    id: string,
    organizationId: string,
  ): Promise<GeneratedAsset | undefined> {
    return this.get<GeneratedAsset>("generated_assets", id, organizationId);
  }

  async savePackage(value: ContentPackage): Promise<void> {
    await this.upsert(
      "content_packages",
      value,
      {
        content_asset_id: value.contentAssetId,
        status: value.status,
        content_hash: value.contentHash,
      },
    );
  }

  async getPackage(id: string, organizationId: string): Promise<ContentPackage | undefined> {
    return this.get<ContentPackage>("content_packages", id, organizationId);
  }

  async saveSkill(value: SkillPackage): Promise<void> {
    await this.upsert("skill_packages", value, { status: value.status });
  }

  async getSkill(id: string, organizationId: string): Promise<SkillPackage | undefined> {
    return this.get<SkillPackage>("skill_packages", id, organizationId);
  }

  async saveSkillVersion(value: SkillVersion): Promise<void> {
    await this.upsert(
      "skill_versions",
      value,
      { skill_id: value.skillId, status: value.status },
    );
  }

  async getSkillVersion(
    id: string,
    organizationId: string,
  ): Promise<SkillVersion | undefined> {
    return this.get<SkillVersion>("skill_versions", id, organizationId);
  }

  async saveTemplate(value: ContentTemplate): Promise<void> {
    await this.upsert("content_templates", value, {
      status: value.status,
      revision: value.revision,
    });
  }

  async getTemplate(
    id: string,
    organizationId: string,
  ): Promise<ContentTemplate | undefined> {
    return this.get<ContentTemplate>("content_templates", id, organizationId);
  }

  async listTemplates(identity: RequestIdentity): Promise<Page<ContentTemplate>> {
    return this.list<ContentTemplate>("content_templates", identity.organizationId);
  }

  async listAuditEvents(
    query: AuditQuery,
    identity: RequestIdentity,
  ): Promise<AuditEvent[]> {
    const rows = await this.sql<{
      id: string;
      organization_id: string;
      trace_id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      actor_id: string;
      snapshot: Record<string, unknown>;
      occurred_at: Date;
    }[]>`
      SELECT
        id::text, organization_id, trace_id, entity_type, entity_id,
        action, actor_id, snapshot, occurred_at
      FROM audit_events
      WHERE organization_id = ${identity.organizationId}
        AND (${query.traceId ?? null}::text IS NULL OR trace_id = ${query.traceId ?? null})
        AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
        AND (${query.entityId ?? null}::text IS NULL OR entity_id = ${query.entityId ?? null})
      ORDER BY occurred_at DESC
      LIMIT ${query.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      traceId: row.trace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      actorId: row.actor_id,
      snapshot: row.snapshot,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async saveAttachment(value: SourceAttachment): Promise<void> {
    await this.upsert("source_attachments", value, {
      status: value.status,
      checksum: value.checksum,
    });
  }

  async getAttachment(
    id: string,
    organizationId: string,
  ): Promise<SourceAttachment | undefined> {
    return this.get<SourceAttachment>("source_attachments", id, organizationId);
  }

  async listAttachments(identity: RequestIdentity): Promise<Page<SourceAttachment>> {
    return this.list<SourceAttachment>(
      "source_attachments",
      identity.organizationId,
    );
  }

  async claimOutboxMessages(limit: number): Promise<OutboxMessage[]> {
    const rows = await this.sql<{ payload: OutboxMessage }[]>`
      WITH candidates AS (
        SELECT id
        FROM outbox_messages
        WHERE (
          status IN ('PENDING', 'FAILED') AND next_attempt_at <= now()
        ) OR (
          status = 'PROCESSING' AND updated_at <= now() - interval '5 minutes'
        )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE outbox_messages AS target
      SET status = 'PROCESSING',
          payload = jsonb_set(target.payload, '{status}', '"PROCESSING"'),
          updated_at = now()
      FROM candidates
      WHERE target.id = candidates.id
      RETURNING target.payload
    `;
    return rows.map((row) => row.payload);
  }

  async saveOutboxMessage(value: OutboxMessage): Promise<void> {
    await this.upsert("outbox_messages", value, {
      status: value.status,
      recipient: value.recipient,
      message_type: value.messageType,
      next_attempt_at: value.nextAttemptAt,
    });
  }

  async claimInboundMessage(
    messageId: string,
    idempotencyKey: string,
    organizationId: string,
  ): Promise<boolean> {
    await this.sql`
      DELETE FROM inbound_messages
      WHERE organization_id = ${organizationId}
        AND status = 'PROCESSING'
        AND updated_at <= now() - interval '5 minutes'
    `;
    const rows = await this.sql<{ message_id: string }[]>`
      INSERT INTO inbound_messages (
        message_id, idempotency_key, organization_id, status, received_at, updated_at
      ) VALUES (
        ${messageId}, ${idempotencyKey}, ${organizationId}, 'PROCESSING', now(), now()
      )
      ON CONFLICT DO NOTHING
      RETURNING message_id
    `;
    return rows.length === 1;
  }

  async completeInboundMessage(
    messageId: string,
    organizationId: string,
  ): Promise<void> {
    await this.sql`
      UPDATE inbound_messages
      SET status = 'COMPLETED', updated_at = now()
      WHERE message_id = ${messageId} AND organization_id = ${organizationId}
    `;
  }

  async releaseInboundMessage(
    messageId: string,
    organizationId: string,
  ): Promise<void> {
    await this.sql`
      DELETE FROM inbound_messages
      WHERE message_id = ${messageId}
        AND organization_id = ${organizationId}
        AND status = 'PROCESSING'
    `;
  }

  private async get<T>(
    table: string,
    id: string,
    organizationId: string,
  ): Promise<T | undefined> {
    const rows = await this.sql.unsafe<{ payload: T }[]>(
      `SELECT payload FROM ${table} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId],
    );
    return rows[0]?.payload;
  }

  private async list<T>(table: string, organizationId: string): Promise<Page<T>> {
    const rows = await this.sql.unsafe<{ payload: T }[]>(
      `SELECT payload FROM ${table} WHERE organization_id = $1 ORDER BY updated_at DESC`,
      [organizationId],
    );
    return { items: rows.map((row) => row.payload), total: rows.length };
  }

  private async upsert(
    table: string,
    value: JsonEntity,
    columns: Record<string, string | number | null>,
    client: QueryClient = this.sql,
  ): Promise<void> {
    const names = Object.keys(columns);
    const allNames = [
      "id",
      "organization_id",
      ...names,
      "payload",
      "created_at",
      "updated_at",
    ];
    const values: Array<string | number | null> = [
      value.id,
      value.organizationId,
      ...Object.values(columns),
      JSON.stringify(value),
      value.createdAt,
      value.updatedAt,
    ];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const updates = [...names, "payload", "updated_at"]
      .map((name) => `${name} = EXCLUDED.${name}`)
      .join(", ");
    const inserted = await client.unsafe<{ id: string }[]>(
      `INSERT INTO ${table} (${allNames.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updates}
       WHERE ${table}.organization_id = EXCLUDED.organization_id
       RETURNING id`,
      values,
    );
    if (inserted.length !== 1) {
      throw new Error(
        `Cross-organization identifier collision rejected for ${table}:${value.id}`,
      );
    }
    await this.audit(table, value, "UPSERTED", client);
  }

  private async audit(
    entityType: string,
    value: JsonEntity,
    action: string,
    client: QueryClient = this.sql,
  ): Promise<void> {
    await client`
      INSERT INTO audit_events (
        organization_id, trace_id, entity_type, entity_id, action, actor_id, snapshot
      ) VALUES (
        ${value.organizationId}, ${value.traceId}, ${entityType}, ${value.id},
        ${action}, ${value.createdBy}, ${this.sql.json(value as never)}
      )
    `;
  }
}
