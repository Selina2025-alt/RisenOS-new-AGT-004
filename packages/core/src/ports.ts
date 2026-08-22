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
  GeneratedContentBundle,
  HostGenerationMetadata,
  OutboxMessage,
  Page,
  RequestIdentity,
  ReviewDecision,
  ReviewRequest,
  SkillPackage,
  SkillVersion,
  SourceAttachment,
  CreateSourceAttachmentInput,
  GeoSeoOptimizationProposal,
  GeoSeoRequest,
} from "@risen/content-contracts";

export interface GenerateObjectRequest {
  schemaName:
    | "content_bundle"
    | "channel_variant"
    | "localization"
    | "asset_brief"
    | "claim_audit"
    | "review_report"
    | "revision_proposal"
    | "variant_package"
    | "content_coverage"
    | "geo_seo_proposal"
    | "research_pack"
    | "knowledge_match"
    | "draft_proposal";
  systemPrompt: string;
  input: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
  traceId: string;
  requestId: string;
  idempotencyKey: string;
  promptVersion: string;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HostGenerationResult {
  output: unknown;
  metadata: HostGenerationMetadata;
}

/**
 * The deployment host owns model selection, credentials, safety policy and
 * invocation. AGT-RSN-004 only depends on this capability contract.
 */
export interface HostModelPort {
  generateObject(request: GenerateObjectRequest): Promise<HostGenerationResult>;
}

export interface ContextPort {
  resolveMissionContext(mission: ContentMission): Promise<Record<string, unknown>>;
}

export interface GovernanceGatePort {
  assertMissionReady(mission: ContentMission): Promise<void>;
  assertGeneratedContent(mission: ContentMission, content: string): Promise<void>;
}

export interface PolicyCheckResult {
  passed: boolean;
  issues: Array<{
    code: "BRAND_RULE" | "POLICY_RULE" | "MISSING_DISCLOSURE";
    message: string;
    path?: string;
  }>;
}

export interface PolicyPort {
  check(
    mission: ContentMission,
    version: ContentVersion,
  ): Promise<PolicyCheckResult>;
}

export interface ReviewPort {
  submit(review: ReviewRequest, content: ContentVersion): Promise<void>;
}

/** Internal child-agent ports. They never publish or mutate formal content. */
export interface LilithReviewPort {
  review(request: ReviewRequest, content: ContentVersion): Promise<ReviewRequest>;
}

export interface GeoSeoPort {
  optimize(request: GeoSeoRequest): Promise<GeoSeoOptimizationProposal>;
}

export interface BalalaVariantPort {
  generate(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface HandoffPort {
  deliver(
    contentPackage: ContentPackage,
    target: string,
  ): Promise<NonNullable<ContentPackage["handoffReceipt"]>>;
}

export interface SecretPort {
  get(name: string): Promise<string | undefined>;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: string;
  traceId: string;
}

/**
 * Optional image capability exposed by the deployment host. No third-party
 * image provider credentials are accepted by the content service.
 */
export interface HostImagePort {
  generate(request: ImageGenerationRequest): Promise<{
    uri: string;
    mimeType: string;
    checksum: string;
  }>;
}

export interface AttachmentPort {
  prepareUpload(request: {
    attachmentId: string;
    organizationId: string;
    input: CreateSourceAttachmentInput;
    traceId: string;
  }): Promise<{
    objectKey: string;
    uploadUrl: string;
    uploadExpiresAt: string;
    requiredHeaders: Record<string, string>;
  }>;
  scanAndExtract(request: {
    attachmentId: string;
    organizationId: string;
    objectKey: string;
    expectedChecksum: string;
    expectedByteSize: number;
    mimeType: string;
    traceId: string;
  }): Promise<{
    clean: boolean;
    engine: string;
    signatureVersion: string;
    observedChecksum: string;
    observedByteSize: number;
    extractedText?: string;
    rejectionReason?: string;
  }>;
}

export interface ContentRepository {
  healthCheck(): Promise<void>;
  saveMission(value: ContentMission): Promise<void>;
  getMission(id: string, organizationId: string): Promise<ContentMission | undefined>;
  listMissions(identity: RequestIdentity): Promise<Page<ContentMission>>;

  saveRun(value: AgentRun): Promise<void>;
  claimRun(id: string, organizationId: string): Promise<AgentRun | undefined>;
  cancelQueuedRun(id: string, organizationId: string): Promise<AgentRun | undefined>;
  getRun(id: string, organizationId: string): Promise<AgentRun | undefined>;
  getRunByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<AgentRun | undefined>;
  saveBatch(value: ContentBatch): Promise<void>;
  getBatch(id: string, organizationId: string): Promise<ContentBatch | undefined>;
  listBatches(identity: RequestIdentity): Promise<Page<ContentBatch>>;

  saveAsset(value: ContentAsset): Promise<void>;
  getAsset(id: string, organizationId: string): Promise<ContentAsset | undefined>;
  getAssetByMissionId(
    missionId: string,
    organizationId: string,
  ): Promise<ContentAsset | undefined>;
  listAssets(identity: RequestIdentity): Promise<Page<ContentAsset>>;

  saveVersion(value: ContentVersion): Promise<void>;
  getVersion(id: string, organizationId: string): Promise<ContentVersion | undefined>;
  listVersions(assetId: string, organizationId: string): Promise<ContentVersion[]>;

  saveValidation(value: ContentValidationResult): Promise<void>;
  getValidation(
    id: string,
    organizationId: string,
  ): Promise<ContentValidationResult | undefined>;

  saveEvidenceRequest(
    value: EvidenceRequest,
    outbox?: OutboxMessage,
  ): Promise<void>;
  getEvidenceRequest(
    id: string,
    organizationId: string,
  ): Promise<EvidenceRequest | undefined>;
  listEvidenceRequests(
    missionId: string,
    organizationId: string,
  ): Promise<EvidenceRequest[]>;

  saveReview(value: ReviewRequest, outbox?: OutboxMessage): Promise<void>;
  getReview(id: string, organizationId: string): Promise<ReviewRequest | undefined>;
  saveReviewDecision(value: ReviewDecision): Promise<void>;

  saveGeneratedAsset(value: GeneratedAsset): Promise<void>;
  getGeneratedAsset(
    id: string,
    organizationId: string,
  ): Promise<GeneratedAsset | undefined>;

  savePackage(value: ContentPackage): Promise<void>;
  getPackage(id: string, organizationId: string): Promise<ContentPackage | undefined>;

  saveSkill(value: SkillPackage): Promise<void>;
  getSkill(id: string, organizationId: string): Promise<SkillPackage | undefined>;
  saveSkillVersion(value: SkillVersion): Promise<void>;
  getSkillVersion(
    id: string,
    organizationId: string,
  ): Promise<SkillVersion | undefined>;

  saveTemplate(value: ContentTemplate): Promise<void>;
  getTemplate(id: string, organizationId: string): Promise<ContentTemplate | undefined>;
  listTemplates(identity: RequestIdentity): Promise<Page<ContentTemplate>>;
  listAuditEvents(
    query: AuditQuery,
    identity: RequestIdentity,
  ): Promise<AuditEvent[]>;
  saveAttachment(value: SourceAttachment): Promise<void>;
  getAttachment(
    id: string,
    organizationId: string,
  ): Promise<SourceAttachment | undefined>;
  listAttachments(identity: RequestIdentity): Promise<Page<SourceAttachment>>;

  claimOutboxMessages(limit: number): Promise<OutboxMessage[]>;
  saveOutboxMessage(value: OutboxMessage): Promise<void>;
  claimInboundMessage(
    messageId: string,
    idempotencyKey: string,
    organizationId: string,
  ): Promise<boolean>;
  completeInboundMessage(messageId: string, organizationId: string): Promise<void>;
  releaseInboundMessage(messageId: string, organizationId: string): Promise<void>;
}

export interface RuntimePort {
  enqueue(run: AgentRun): Promise<void>;
}

export interface GeneratedBundleParser {
  parse(value: unknown): GeneratedContentBundle;
}

export class LocalTestContext implements ContextPort {
  async resolveMissionContext(
    mission: ContentMission,
  ): Promise<Record<string, unknown>> {
    return {
      strategy: mission.strategy,
      audience: mission.audience,
      evidence: mission.evidence,
    };
  }
}
