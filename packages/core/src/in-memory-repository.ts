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
import type { ContentRepository } from "./ports.js";
import { clone } from "./utils.js";

export class InMemoryContentRepository implements ContentRepository {
  private readonly missions = new Map<string, ContentMission>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly batches = new Map<string, ContentBatch>();
  private readonly assets = new Map<string, ContentAsset>();
  private readonly versions = new Map<string, ContentVersion>();
  private readonly validations = new Map<string, ContentValidationResult>();
  private readonly evidenceRequests = new Map<string, EvidenceRequest>();
  private readonly reviews = new Map<string, ReviewRequest>();
  private readonly reviewDecisions = new Map<string, ReviewDecision>();
  private readonly generatedAssets = new Map<string, GeneratedAsset>();
  private readonly packages = new Map<string, ContentPackage>();
  private readonly skills = new Map<string, SkillPackage>();
  private readonly skillVersions = new Map<string, SkillVersion>();
  private readonly templates = new Map<string, ContentTemplate>();
  private readonly attachments = new Map<string, SourceAttachment>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly outbox = new Map<string, OutboxMessage>();
  private readonly inboundMessages = new Map<
    string,
    { idempotencyKey: string; status: "PROCESSING" | "COMPLETED" }
  >();

  async healthCheck(): Promise<void> {}

  async saveMission(value: ContentMission): Promise<void> {
    this.store(this.missions, value);
    this.audit("ContentMission", value);
  }

  async getMission(id: string, organizationId: string): Promise<ContentMission | undefined> {
    return this.forOrganization(this.missions.get(id), organizationId);
  }

  async listMissions(identity: RequestIdentity): Promise<Page<ContentMission>> {
    return this.page(this.missions, identity.organizationId);
  }

  async saveRun(value: AgentRun): Promise<void> {
    this.store(this.runs, value);
    this.audit("AgentRun", value);
  }

  async claimRun(
    id: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    const run = this.runs.get(id);
    if (!run || run.organizationId !== organizationId) return undefined;
    const stale =
      run.status === "RUNNING" &&
      Date.parse(run.updatedAt) <= Date.now() - 30_000;
    if (!["QUEUED", "FAILED"].includes(run.status) && !stale) return undefined;
    const claimed: AgentRun = {
      ...run,
      status: "RUNNING",
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(id, clone(claimed));
    return clone(claimed);
  }

  async cancelQueuedRun(
    id: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    const run = this.runs.get(id);
    if (
      !run ||
      run.organizationId !== organizationId ||
      run.status !== "QUEUED"
    ) {
      return undefined;
    }
    const cancelled: AgentRun = {
      ...run,
      status: "CANCELLED",
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(id, clone(cancelled));
    return clone(cancelled);
  }

  async getRun(id: string, organizationId: string): Promise<AgentRun | undefined> {
    return this.forOrganization(this.runs.get(id), organizationId);
  }

  async getRunByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<AgentRun | undefined> {
    return [...this.runs.values()].find(
      (item) =>
        item.organizationId === organizationId && item.missionId === missionId,
    );
  }

  async saveBatch(value: ContentBatch): Promise<void> {
    this.store(this.batches, value);
    this.audit("ContentBatch", value);
  }

  async getBatch(
    id: string,
    organizationId: string,
  ): Promise<ContentBatch | undefined> {
    return this.forOrganization(this.batches.get(id), organizationId);
  }

  async listBatches(identity: RequestIdentity): Promise<Page<ContentBatch>> {
    return this.page(this.batches, identity.organizationId);
  }

  async saveAsset(value: ContentAsset): Promise<void> {
    this.store(this.assets, value);
    this.audit("ContentAsset", value);
  }

  async getAsset(id: string, organizationId: string): Promise<ContentAsset | undefined> {
    return this.forOrganization(this.assets.get(id), organizationId);
  }

  async getAssetByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<ContentAsset | undefined> {
    return [...this.assets.values()].find(
      (item) =>
        item.organizationId === organizationId && item.missionId === missionId,
    );
  }

  async listAssets(identity: RequestIdentity): Promise<Page<ContentAsset>> {
    return this.page(this.assets, identity.organizationId);
  }

  async saveVersion(value: ContentVersion): Promise<void> {
    if (this.versions.has(value.id)) {
      throw new Error(`Immutable content version ${value.id} already exists`);
    }
    this.store(this.versions, value);
    this.audit("ContentVersion", value);
  }

  async getVersion(id: string, organizationId: string): Promise<ContentVersion | undefined> {
    return this.forOrganization(this.versions.get(id), organizationId);
  }

  async listVersions(assetId: string, organizationId: string): Promise<ContentVersion[]> {
    return [...this.versions.values()]
      .filter((item) => item.organizationId === organizationId && item.assetId === assetId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map(clone);
  }

  async saveValidation(value: ContentValidationResult): Promise<void> {
    this.store(this.validations, value);
  }

  async getValidation(
    id: string,
    organizationId: string,
  ): Promise<ContentValidationResult | undefined> {
    return this.forOrganization(this.validations.get(id), organizationId);
  }

  async saveEvidenceRequest(
    value: EvidenceRequest,
    outbox?: OutboxMessage,
  ): Promise<void> {
    this.store(this.evidenceRequests, value);
    if (outbox) this.store(this.outbox, outbox);
  }

  async getEvidenceRequest(
    id: string,
    organizationId: string,
  ): Promise<EvidenceRequest | undefined> {
    return this.forOrganization(this.evidenceRequests.get(id), organizationId);
  }

  async listEvidenceRequests(
    missionId: string,
    organizationId: string,
  ): Promise<EvidenceRequest[]> {
    return [...this.evidenceRequests.values()]
      .filter(
        (item) => item.organizationId === organizationId && item.missionId === missionId,
      )
      .map(clone);
  }

  async saveReview(value: ReviewRequest, outbox?: OutboxMessage): Promise<void> {
    this.store(this.reviews, value);
    this.audit("ReviewRequest", value);
    if (outbox) this.store(this.outbox, outbox);
  }

  async getReview(id: string, organizationId: string): Promise<ReviewRequest | undefined> {
    return this.forOrganization(this.reviews.get(id), organizationId);
  }

  async saveReviewDecision(value: ReviewDecision): Promise<void> {
    this.store(this.reviewDecisions, value);
  }

  async saveGeneratedAsset(value: GeneratedAsset): Promise<void> {
    this.store(this.generatedAssets, value);
  }

  async getGeneratedAsset(
    id: string,
    organizationId: string,
  ): Promise<GeneratedAsset | undefined> {
    return this.forOrganization(this.generatedAssets.get(id), organizationId);
  }

  async savePackage(value: ContentPackage): Promise<void> {
    this.store(this.packages, value);
    this.audit("ContentPackage", value);
  }

  async getPackage(id: string, organizationId: string): Promise<ContentPackage | undefined> {
    return this.forOrganization(this.packages.get(id), organizationId);
  }

  async saveSkill(value: SkillPackage): Promise<void> {
    this.store(this.skills, value);
  }

  async getSkill(id: string, organizationId: string): Promise<SkillPackage | undefined> {
    return this.forOrganization(this.skills.get(id), organizationId);
  }

  async saveSkillVersion(value: SkillVersion): Promise<void> {
    this.store(this.skillVersions, value);
  }

  async getSkillVersion(
    id: string,
    organizationId: string,
  ): Promise<SkillVersion | undefined> {
    return this.forOrganization(this.skillVersions.get(id), organizationId);
  }

  async saveTemplate(value: ContentTemplate): Promise<void> {
    this.store(this.templates, value);
    this.audit("ContentTemplate", value);
  }

  async getTemplate(
    id: string,
    organizationId: string,
  ): Promise<ContentTemplate | undefined> {
    return this.forOrganization(this.templates.get(id), organizationId);
  }

  async listTemplates(identity: RequestIdentity): Promise<Page<ContentTemplate>> {
    return this.page(this.templates, identity.organizationId);
  }

  async listAuditEvents(
    query: AuditQuery,
    identity: RequestIdentity,
  ): Promise<AuditEvent[]> {
    return this.auditEvents
      .filter(
        (event) =>
          event.organizationId === identity.organizationId &&
          (!query.traceId || event.traceId === query.traceId) &&
          (!query.entityType || event.entityType === query.entityType) &&
          (!query.entityId || event.entityId === query.entityId),
      )
      .slice(-query.limit)
      .reverse()
      .map(clone);
  }

  async saveAttachment(value: SourceAttachment): Promise<void> {
    this.store(this.attachments, value);
    this.audit("SourceAttachment", value);
  }

  async getAttachment(
    id: string,
    organizationId: string,
  ): Promise<SourceAttachment | undefined> {
    return this.forOrganization(this.attachments.get(id), organizationId);
  }

  async listAttachments(identity: RequestIdentity): Promise<Page<SourceAttachment>> {
    return this.page(this.attachments, identity.organizationId);
  }

  async claimOutboxMessages(limit: number): Promise<OutboxMessage[]> {
    const now = Date.now();
    const values = [...this.outbox.values()]
      .filter(
        (item) =>
          ((item.status === "PENDING" || item.status === "FAILED") &&
            Date.parse(item.nextAttemptAt) <= now) ||
          (item.status === "PROCESSING" &&
            Date.parse(item.updatedAt) <= now - 5 * 60_000),
      )
      .slice(0, limit)
      .map((item) => ({
        ...item,
        status: "PROCESSING" as const,
        updatedAt: new Date(now).toISOString(),
      }));
    values.forEach((item) => this.outbox.set(item.id, clone(item)));
    return values.map(clone);
  }

  async saveOutboxMessage(value: OutboxMessage): Promise<void> {
    this.store(this.outbox, value);
  }

  async claimInboundMessage(
    messageId: string,
    idempotencyKey: string,
    organizationId: string,
  ): Promise<boolean> {
    const messageKey = `${organizationId}:message:${messageId}`;
    const idempotencyExists = [...this.inboundMessages.entries()].some(
      ([key, value]) =>
        key.startsWith(`${organizationId}:message:`) &&
        value.idempotencyKey === idempotencyKey,
    );
    if (this.inboundMessages.has(messageKey) || idempotencyExists) {
      return false;
    }
    this.inboundMessages.set(messageKey, {
      idempotencyKey,
      status: "PROCESSING",
    });
    return true;
  }

  async completeInboundMessage(
    messageId: string,
    organizationId: string,
  ): Promise<void> {
    const key = `${organizationId}:message:${messageId}`;
    const value = this.inboundMessages.get(key);
    if (value) this.inboundMessages.set(key, { ...value, status: "COMPLETED" });
  }

  async releaseInboundMessage(
    messageId: string,
    organizationId: string,
  ): Promise<void> {
    this.inboundMessages.delete(`${organizationId}:message:${messageId}`);
  }

  private audit(
    entityType: string,
    value: {
      id: string;
      organizationId: string;
      traceId: string;
      createdBy: string;
      updatedAt: string;
    },
  ): void {
    this.auditEvents.push({
      id: `audit_${this.auditEvents.length + 1}`,
      organizationId: value.organizationId,
      traceId: value.traceId,
      entityType,
      entityId: value.id,
      action: "UPSERTED",
      actorId: value.createdBy,
      snapshot: clone(value) as Record<string, unknown>,
      occurredAt: value.updatedAt,
    });
  }

  private store<T extends { id: string; organizationId: string }>(
    values: Map<string, T>,
    value: T,
  ): void {
    const existing = values.get(value.id);
    if (existing && existing.organizationId !== value.organizationId) {
      throw new Error(
        `Cross-organization identifier collision rejected for ${value.id}`,
      );
    }
    values.set(value.id, clone(value));
  }

  private forOrganization<T extends { organizationId: string }>(
    value: T | undefined,
    organizationId: string,
  ): T | undefined {
    return value?.organizationId === organizationId ? clone(value) : undefined;
  }

  private page<T extends { organizationId: string }>(
    values: Map<string, T>,
    organizationId: string,
  ): Page<T> {
    const items = [...values.values()]
      .filter((item) => item.organizationId === organizationId)
      .map(clone);
    return { items, total: items.length };
  }
}
