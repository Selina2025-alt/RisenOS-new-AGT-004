import { z } from "zod";

export const IdSchema = z.string().min(8).max(128);
export const IsoDateSchema = z.string().datetime();

export const ContentStatusSchema = z.enum([
  "DRAFT",
  "GENERATING",
  "VALIDATING",
  "EVIDENCE_REQUIRED",
  "REVIEW_REQUIRED",
  "REVISION_REQUIRED",
  "APPROVED",
  "PACKAGED",
  "DELIVERED",
  "ARCHIVED",
  "FAILED",
]);

export const RunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_EVIDENCE",
  "WAITING_REVIEW",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const ContentChannelSchema = z.enum([
  "generic",
  "web",
  "wechat",
  "xiaohongshu",
  "x",
  "video",
]);

export const ContentOutputKindSchema = z.enum([
  "content_brief",
  "content_research",
  "outline",
  "content",
  "content_version",
  "content_variant",
  "localization",
  "asset_brief",
  "media_pitch",
  "answer_block",
  "public_statement",
  "content_reuse_plan",
]);

export const CommonFieldsSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  createdBy: IdSchema,
  traceId: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const AssetRightsSchema = z.object({
  status: z.enum(["UNKNOWN", "PENDING", "CLEARED", "RESTRICTED", "EXPIRED"]),
  owner: z.string().max(300).optional(),
  license: z.string().max(300).optional(),
  attribution: z.string().max(1000).optional(),
  restrictions: z.array(z.string().max(500)).default([]),
  expiresAt: IsoDateSchema.optional(),
});

export const EvidenceInputSchema = z.object({
  id: IdSchema.optional(),
  title: z.string().min(1).max(500),
  sourceType: z.enum(["agt003", "provided_document", "approved_knowledge"]),
  sourceRef: z.string().min(1).max(2048),
  excerpt: z.string().min(1).max(20_000),
  verified: z.boolean(),
  verifiedBy: z.string().max(128).optional(),
  verifiedAt: IsoDateSchema.optional(),
  validUntil: IsoDateSchema.optional(),
  rights: AssetRightsSchema,
});

export const ClaimInputSchema = z.object({
  id: IdSchema.optional(),
  statement: z.string().min(1).max(4000),
  factual: z.boolean(),
  evidenceIds: z.array(IdSchema).default([]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("LOW"),
});

export const ContentMissionInputSchema = z.object({
  organizationId: IdSchema.optional(),
  createdBy: IdSchema.optional(),
  title: z.string().min(1).max(300),
  objective: z.string().min(1).max(4000),
  strategy: z.string().min(1).max(12_000),
  audience: z.array(z.string().min(1).max(500)).min(1),
  message: z.string().min(1).max(8000),
  contentPlan: z.string().min(1).max(12_000),
  claims: z.array(ClaimInputSchema).default([]),
  evidence: z.array(EvidenceInputSchema).default([]),
  brandRules: z.array(z.string().min(1).max(2000)).default([]),
  policies: z.array(z.string().min(1).max(2000)).default([]),
  requestedOutputs: z
    .array(ContentOutputKindSchema)
    .min(1)
    .default(["content_brief", "outline", "content", "content_version"]),
  channels: z.array(ContentChannelSchema).min(1).default(["generic"]),
  locales: z.array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)).default(["zh-CN"]),
  highRisk: z.boolean().default(false),
  templateId: IdSchema.optional(),
  templateVariables: z.record(z.string(), z.string().max(8000)).optional(),
  attachmentIds: z.array(IdSchema).max(50).optional(),
});

export const ContentMissionSchema = CommonFieldsSchema.extend({
  status: ContentStatusSchema,
  title: z.string(),
  objective: z.string(),
  strategy: z.string(),
  audience: z.array(z.string()),
  message: z.string(),
  contentPlan: z.string(),
  claims: z.array(
    ClaimInputSchema.extend({
      id: IdSchema,
    }),
  ),
  evidence: z.array(
    EvidenceInputSchema.extend({
      id: IdSchema,
    }),
  ),
  brandRules: z.array(z.string()),
  policies: z.array(z.string()),
  requestedOutputs: z.array(ContentOutputKindSchema),
  channels: z.array(ContentChannelSchema),
  locales: z.array(z.string()),
  highRisk: z.boolean(),
  templateSnapshot: z.object({
    templateId: IdSchema,
    revision: z.number().int().positive(),
    name: z.string(),
    renderedInstructions: z.string(),
    variables: z.record(z.string(), z.string()),
  }).optional(),
  attachmentSnapshots: z.array(
    z.object({
      attachmentId: IdSchema,
      fileName: z.string(),
      mimeType: z.string(),
      checksum: z.string(),
      sourceUse: z.enum([
        "RESEARCH_INPUT",
        "BRAND_REFERENCE",
        "EVIDENCE_DOCUMENT",
      ]),
      extractedText: z.string().max(2_000_000),
    }),
  ).default([]),
  currentAssetId: IdSchema.optional(),
  failureReason: z.string().optional(),
});

export const ContentBriefSchema = z.object({
  objective: z.string().min(1),
  audience: z.array(z.string()).min(1),
  coreMessage: z.string().min(1),
  tone: z.array(z.string()).min(1),
  deliverables: z.array(ContentOutputKindSchema),
  channels: z.array(ContentChannelSchema),
  locales: z.array(z.string()),
  mustIncludeClaimIds: z.array(IdSchema),
  constraints: z.array(z.string()),
  callToAction: z.string().optional(),
});

export const ContentResearchSchema = z.object({
  summary: z.string().min(1),
  evidenceDigest: z.array(
    z.object({
      evidenceId: IdSchema,
      title: z.string(),
      supportedClaimIds: z.array(IdSchema),
      usableExcerpt: z.string(),
    }),
  ),
  researchGaps: z.array(
    z.object({
      claimId: IdSchema.optional(),
      question: z.string(),
      reason: z.string(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    }),
  ),
});

export const OutlineSchema = z.object({
  title: z.string().min(1),
  sections: z.array(
    z.object({
      heading: z.string().min(1),
      purpose: z.string().min(1),
      claimIds: z.array(IdSchema),
      evidenceIds: z.array(IdSchema),
    }),
  ).min(1),
});

export const ClaimAuditSchema = z.object({
  assertions: z.array(
    z.object({
      statement: z.string().min(1),
      path: z.string().min(1),
      factual: z.boolean(),
      matchedClaimId: IdSchema.optional(),
      evidenceIds: z.array(IdSchema),
      entailedByEvidence: z.boolean(),
    }),
  ),
});

export const ChannelVariantSchema = z.object({
  channel: ContentChannelSchema,
  locale: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string()),
  claimIdsUsed: z.array(IdSchema),
  formatMetadata: z.record(z.string(), z.unknown()).default({}),
  derivedFromVersionId: IdSchema.optional(),
});

export const AssetBriefSchema = z.object({
  assetType: z.enum(["cover", "illustration", "xiaohongshu_card", "video_visual"]),
  purpose: z.string().min(1),
  prompt: z.string().min(1),
  aspectRatio: z.string().min(1),
  visualDirection: z.string().min(1),
  textOverlay: z.string().optional(),
  rightsRequired: z.boolean().default(true),
  derivedFromVersionId: IdSchema.optional(),
});

export const GeneratedContentBundleSchema = z.object({
  brief: ContentBriefSchema,
  research: ContentResearchSchema,
  outline: OutlineSchema,
  primary: ChannelVariantSchema,
  variants: z.array(ChannelVariantSchema),
  localizations: z.array(ChannelVariantSchema),
  assetBriefs: z.array(AssetBriefSchema),
  mediaPitchDraft: z.string(),
  answerBlocks: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      claimIdsUsed: z.array(IdSchema),
    }),
  ),
  publicStatementDraft: z.string(),
  reusePlan: z.array(
    z.object({
      sourceSection: z.string(),
      targetFormat: z.string(),
      channel: ContentChannelSchema,
      instruction: z.string(),
    }),
  ),
});

export const ClaimBindingSnapshotSchema = z.array(
  z.object({
    claimId: IdSchema,
    evidenceIds: z.array(IdSchema),
    statementHash: z.string().min(16),
  }),
);

export const HostGenerationMetadataSchema = z.object({
  hostId: z.string().min(1),
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative(),
  safetyStatus: z.enum(["PASSED", "BLOCKED", "UNKNOWN"]),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const ContentVersionSchema = CommonFieldsSchema.extend({
  status: ContentStatusSchema,
  assetId: IdSchema,
  versionNumber: z.number().int().positive(),
  parentVersionId: IdSchema.optional(),
  title: z.string(),
  body: z.string(),
  contentHash: z.string().min(16),
  changeReason: z.string(),
  changedBy: IdSchema,
  generationContextSnapshot: z.record(z.string(), z.unknown()),
  generationMetadataSnapshot: HostGenerationMetadataSchema.optional(),
  bodyFormat: z.enum(["plain_text", "tiptap_html"]).default("plain_text"),
  richBody: z.string().max(2_000_000).optional(),
  claimBindingSnapshot: ClaimBindingSnapshotSchema,
});

export const ContentAssetSchema = CommonFieldsSchema.extend({
  status: ContentStatusSchema,
  missionId: IdSchema,
  title: z.string(),
  currentVersionId: IdSchema,
  bundle: GeneratedContentBundleSchema,
  versionIds: z.array(IdSchema),
  validationId: IdSchema.optional(),
  activeReviewId: IdSchema.optional(),
});

export const ValidationIssueSchema = z.object({
  code: z.enum([
    "UNSUPPORTED_CLAIM",
    "EXPIRED_EVIDENCE",
    "RIGHTS_NOT_CLEARED",
    "BRAND_RULE",
    "POLICY_RULE",
    "FORBIDDEN_PLATFORM_FIELD",
    "MISSING_DISCLOSURE",
    "UNKNOWN_FACTUAL_CLAIM",
    "CLAIM_EVIDENCE_MISMATCH",
    "SENSITIVE_DATA",
    "STALE_DERIVED_CONTENT",
  ]),
  severity: z.enum(["WARNING", "ERROR", "BLOCKING"]),
  message: z.string(),
  claimId: IdSchema.optional(),
  evidenceId: IdSchema.optional(),
  path: z.string().optional(),
});

export const ContentValidationResultSchema = CommonFieldsSchema.extend({
  status: z.enum(["PASSED", "FAILED"]),
  assetId: IdSchema,
  versionId: IdSchema,
  issues: z.array(ValidationIssueSchema),
  checks: z.object({
    claims: z.boolean(),
    claimSemantics: z.boolean(),
    evidence: z.boolean(),
    brand: z.boolean(),
    policy: z.boolean(),
    rights: z.boolean(),
    platformBoundary: z.boolean(),
    dataProtection: z.boolean(),
  }),
  semanticClaimAudit: ClaimAuditSchema.optional(),
  semanticAuditMetadata: HostGenerationMetadataSchema.optional(),
});

export const EvidenceRequestSchema = CommonFieldsSchema.extend({
  status: z.enum(["OPEN", "FULFILLED", "CANCELLED"]),
  missionId: IdSchema,
  claimIds: z.array(IdSchema),
  questions: z.array(z.string()).min(1),
  requestedFrom: z.literal("AGT-RSN-003"),
  fulfilledAt: IsoDateSchema.optional(),
  fulfilledBy: z.string().optional(),
  fulfillmentIdempotencyKey: z.string().optional(),
});

export const EvidenceFulfillmentInputSchema = z.object({
  protocolVersion: z.literal("1.0"),
  idempotencyKey: z.string().min(8).max(300),
  fulfilledBy: z.string().min(1).max(300),
  evidence: z.array(EvidenceInputSchema.extend({ id: IdSchema })).min(1),
  claimBindings: z.array(
    z.object({
      claimId: IdSchema,
      evidenceIds: z.array(IdSchema).min(1),
    }),
  ).min(1),
});

export const OutboxMessageSchema = CommonFieldsSchema.extend({
  status: z.enum(["PENDING", "PROCESSING", "SENT", "FAILED", "DEAD"]),
  protocolVersion: z.literal("1.0"),
  messageType: z.enum(["EVIDENCE_REQUEST", "REVIEW_REQUEST"]),
  sender: z.literal("AGT-RSN-004"),
  recipient: z.enum(["AGT-RSN-003", "AGT-RSN-006"]),
  idempotencyKey: z.string().min(8),
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: IsoDateSchema,
  sentAt: IsoDateSchema.optional(),
  lastError: z.string().optional(),
});

export const AgentMessageEnvelopeSchema = z.object({
  protocolVersion: z.literal("1.0"),
  messageId: IdSchema,
  messageType: z.enum([
    "EVIDENCE_REQUEST",
    "EVIDENCE_FULFILLMENT",
    "REVIEW_REQUEST",
    "REVIEW_DECISION",
    "CONTENT_PACKAGE",
    "HANDOFF_RECEIPT",
  ]),
  sender: z.enum([
    "AGT-RSN-003",
    "AGT-RSN-004",
    "AGT-RSN-005",
    "AGT-RSN-006",
  ]),
  recipient: z.enum([
    "AGT-RSN-003",
    "AGT-RSN-004",
    "AGT-RSN-005",
    "AGT-RSN-006",
  ]),
  organizationId: IdSchema,
  traceId: IdSchema,
  idempotencyKey: z.string().min(8),
  sentAt: IsoDateSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const ReviewRequestInputSchema = z.object({
  assetId: IdSchema,
  versionId: IdSchema,
  reviewerType: z.enum(["AGT-RSN-006", "HUMAN"]),
  reviewerId: IdSchema.optional(),
  notes: z.string().max(4000).optional(),
  reviewAgent: z.enum(["Lilith", "AGT-RSN-006", "HUMAN"]).optional(),
  requestedChecks: z.array(z.string()).optional(),
  generationSkillTrace: z.array(z.record(z.string(), z.unknown())).optional(),
  applicablePreferenceSet: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const ReviewRequestSchema = CommonFieldsSchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  assetId: IdSchema,
  versionId: IdSchema,
  reviewerType: z.enum(["AGT-RSN-006", "HUMAN"]),
  reviewerId: IdSchema.optional(),
  notes: z.string().optional(),
  decisionId: IdSchema.optional(),
  reviewAgent: z.enum(["Lilith", "AGT-RSN-006", "HUMAN"]).optional(),
  requestedChecks: z.array(z.string()).optional(),
  generationSkillTrace: z.array(z.record(z.string(), z.unknown())).optional(),
  applicablePreferenceSet: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const AiStyleReviewSchema = z.object({
  status: z.enum(["PASS", "INFO", "WARN", "REVISION_REQUIRED", "BLOCKED"]),
  signalFamilies: z.array(z.string()),
  issues: z.array(z.record(z.string(), z.unknown())),
  excludedTypes: z.array(z.string()).default([]),
  humanizationGoal: z.literal("specificity_readability_and_human_voice"),
});

export const LogicReviewSchema = z.object({
  status: z.enum(["PASS", "WARN", "REVISION_REQUIRED", "BLOCKED"]),
  path: z.array(z.string()),
  issues: z.array(z.record(z.string(), z.unknown())),
  enterpriseInsertion: z.record(z.string(), z.unknown()),
});

export const VariantBriefSchema = z.object({
  schemaVersion: z.string().default("2.0"),
  agent: z.literal("balala").default("balala"),
  sourceContentVersionId: IdSchema,
  sourceReviewId: IdSchema,
  missionId: IdSchema,
  researchPackId: IdSchema.nullable().optional(),
  contentBriefId: IdSchema.nullable().optional(),
  targetChannels: z.array(z.string()).min(1),
  targetAudience: z.string().min(1),
  targetLanguage: z.string().min(1),
  linkedinLanguagePolicy: z.string().optional(),
  ctaPolicy: z.literal("soft"),
  assetDelivery: z.literal("copy-plus-asset-brief"),
  contentCoverageMap: z.record(z.string(), z.unknown()),
  claimBindingSnapshot: z.array(z.record(z.string(), z.unknown())),
  generationSkillTrace: z.array(z.record(z.string(), z.unknown())),
  applicablePreferenceSet: z.array(z.record(z.string(), z.unknown())).default([]),
  platformPolicyVersion: z.string().min(1),
  requestedVariantPurpose: z.string().optional(),
  variantMode: z.string().nullable().optional(),
  humanFeedbackMemorySnapshot: z.record(z.string(), z.unknown()),
  traceId: IdSchema,
});

export const BalalaVariantPackageSchema = z.object({
  agent: z.literal("balala"),
  variantId: IdSchema,
  sourceContentVersionId: IdSchema,
  sourceReviewId: IdSchema,
  channel: z.string(),
  language: z.string(),
  variantType: z.string().nullable().optional(),
  variantMode: z.string().nullable().optional(),
  copy: z.record(z.string(), z.unknown()),
  assetBrief: z.record(z.string(), z.unknown()),
  inheritedClaimBindings: z.array(z.record(z.string(), z.unknown())),
  inheritedCoverageMap: z.record(z.string(), z.unknown()),
  skillTrace: z.array(z.record(z.string(), z.unknown())),
  variantValidation: z.record(z.string(), z.unknown()),
  reviewStatus: z.enum(["PASS", "RE_REVIEW_REQUIRED", "BLOCKED"]),
  contentHash: z.string(),
  createdAt: IsoDateSchema,
  traceId: IdSchema,
});

export const ReviewDecisionInputSchema = z.object({
  reviewId: IdSchema,
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  reviewerId: IdSchema,
  summary: z.string().min(1).max(8000),
  comments: z.array(
    z.object({
      path: z.string(),
      message: z.string(),
      claimId: IdSchema.optional(),
      severity: z.enum(["INFO", "WARNING", "ERROR"]),
    }),
  ).default([]),
});

export const ReviewDecisionSchema = CommonFieldsSchema.extend({
  reviewId: IdSchema,
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  reviewerId: IdSchema,
  summary: z.string(),
  comments: z.array(
    z.object({
      path: z.string(),
      message: z.string(),
      claimId: IdSchema.optional(),
      severity: z.enum(["INFO", "WARNING", "ERROR"]),
    }),
  ),
});

export const GeneratedAssetSchema = CommonFieldsSchema.extend({
  status: z.enum(["PENDING", "GENERATED", "FAILED", "READY"]),
  contentAssetId: IdSchema,
  derivedFromVersionId: IdSchema.optional(),
  assetBrief: AssetBriefSchema,
  uri: z.string().optional(),
  mimeType: z.string().optional(),
  checksum: z.string().optional(),
  rights: AssetRightsSchema,
});

export const ContentPackageSchema = CommonFieldsSchema.extend({
  status: z.enum(["PACKAGED", "DELIVERED"]),
  contentAssetId: IdSchema,
  contentVersion: ContentVersionSchema,
  variants: z.array(ChannelVariantSchema),
  localizations: z.array(ChannelVariantSchema),
  assets: z.array(GeneratedAssetSchema),
  assetBriefs: z.array(AssetBriefSchema),
  claimEvidenceBindings: ClaimBindingSnapshotSchema,
  validation: ContentValidationResultSchema,
  rightsRestrictions: z.array(z.string()),
  recommendedTitle: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  formatGuidance: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  versionNumber: z.number().int().positive(),
  deliveredAt: IsoDateSchema.optional(),
  deliveredTo: z.string().optional(),
  handoffReceipt: z.object({
    receiptId: IdSchema,
    packageId: IdSchema,
    contentHash: z.string().min(16),
    acceptedAt: IsoDateSchema,
    receiver: z.string().min(1),
  }).optional(),
});

export const AgentRunStepSchema = z.object({
  id: IdSchema,
  name: z.enum(["context", "research", "matching", "writing", "post_write", "quality"]),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"]),
  startedAt: IsoDateSchema.optional(),
  completedAt: IsoDateSchema.optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const AgentRunSchema = CommonFieldsSchema.extend({
  status: RunStatusSchema,
  missionId: IdSchema,
  batchId: IdSchema.optional(),
  steps: z.array(AgentRunStepSchema),
  failureReason: z.string().optional(),
});

export const BatchMissionInputSchema = z.object({
  missions: z.array(ContentMissionInputSchema).min(1).max(50),
});

export const ContentBatchSchema = CommonFieldsSchema.extend({
  status: z.enum([
    "QUEUED",
    "RUNNING",
    "PARTIAL",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]),
  missionIds: z.array(IdSchema),
  runIds: z.array(IdSchema),
  total: z.number().int().positive(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const CreateVersionInputSchema = z.object({
  body: z.string().min(1),
  bodyFormat: z.enum(["plain_text", "tiptap_html"]).default("plain_text"),
  richBody: z.string().max(2_000_000).optional(),
  title: z.string().min(1).max(500),
  changeReason: z.string().min(1).max(2000),
}).superRefine((value, context) => {
  if (value.bodyFormat === "tiptap_html" && !value.richBody) {
    context.addIssue({
      code: "custom",
      path: ["richBody"],
      message: "richBody is required for tiptap_html",
    });
  }
});

export const CreateVariantInputSchema = z.object({
  versionId: IdSchema,
  channel: ContentChannelSchema,
  locale: z.string().default("zh-CN"),
  audienceAdjustment: z.string().max(2000).optional(),
});

export const CreateLocalizationInputSchema = z.object({
  versionId: IdSchema,
  locale: z.string().min(2).max(20),
  culturalNotes: z.string().max(4000).optional(),
});

export const GenerateAssetBriefInputSchema = z.object({
  versionId: IdSchema,
  assetType: z.enum([
    "cover",
    "illustration",
    "xiaohongshu_card",
    "video_visual",
  ]),
  purpose: z.string().min(1).max(2000),
  aspectRatio: z.string().min(1).max(50),
});

export const CreateContentPackageInputSchema = z.object({
  contentAssetId: IdSchema,
  versionId: IdSchema,
  generatedAssetIds: z.array(IdSchema).default([]),
});

export const CreateContentTemplateInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  instructions: z.string().min(1).max(30_000),
  variables: z.array(
    z.object({
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
      description: z.string().min(1).max(1000),
      required: z.boolean().default(true),
      defaultValue: z.string().max(8000).optional(),
    }),
  ).max(50).default([]),
  supportedOutputs: z.array(ContentOutputKindSchema).min(1),
  supportedChannels: z.array(ContentChannelSchema).min(1),
  supportedLocales: z.array(z.string().min(2).max(20)).min(1),
  parentTemplateId: IdSchema.optional(),
});

export const ContentTemplateSchema = CommonFieldsSchema.extend({
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  variables: CreateContentTemplateInputSchema.shape.variables,
  supportedOutputs: z.array(ContentOutputKindSchema),
  supportedChannels: z.array(ContentChannelSchema),
  supportedLocales: z.array(z.string()),
  revision: z.number().int().positive(),
  parentTemplateId: IdSchema.optional(),
  activatedAt: IsoDateSchema.optional(),
  activatedBy: IdSchema.optional(),
});

export const AuditQuerySchema = z.object({
  traceId: IdSchema.optional(),
  entityType: z.string().min(1).max(100).optional(),
  entityId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const AuditEventSchema = z.object({
  id: z.string(),
  organizationId: IdSchema,
  traceId: IdSchema,
  entityType: z.string(),
  entityId: IdSchema,
  action: z.string(),
  actorId: IdSchema,
  snapshot: z.record(z.string(), z.unknown()),
  occurredAt: IsoDateSchema,
});

export const CreateSourceAttachmentInputSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ]),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceUse: z.enum([
    "RESEARCH_INPUT",
    "BRAND_REFERENCE",
    "EVIDENCE_DOCUMENT",
  ]),
});

export const SourceAttachmentSchema = CommonFieldsSchema.extend({
  status: z.enum(["UPLOAD_PENDING", "QUARANTINED", "READY", "REJECTED"]),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().positive(),
  checksum: z.string(),
  sourceUse: z.enum([
    "RESEARCH_INPUT",
    "BRAND_REFERENCE",
    "EVIDENCE_DOCUMENT",
  ]),
  objectKey: z.string(),
  uploadExpiresAt: IsoDateSchema,
  extractedText: z.string().max(2_000_000).optional(),
  scan: z.object({
    engine: z.string(),
    signatureVersion: z.string(),
    scannedAt: IsoDateSchema,
    clean: z.boolean(),
    observedChecksum: z.string(),
    observedByteSize: z.number().int().nonnegative(),
  }).optional(),
  rejectionReason: z.string().optional(),
});

export const PreparedSourceAttachmentSchema = z.object({
  attachment: SourceAttachmentSchema,
  uploadUrl: z.string().url(),
  requiredHeaders: z.record(z.string(), z.string()).default({}),
});

export const SkillImportInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  manifest: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    supportedOutputs: z.array(ContentOutputKindSchema).min(1),
    systemPrompt: z.string().min(1).max(30_000),
    requiredContext: z.array(
      z.enum(["strategy", "audience", "message", "claims", "evidence", "brandRules", "policies"]),
    ),
  }),
});

export const SkillPackageSchema = CommonFieldsSchema.extend({
  status: z.enum(["IMPORTED", "TESTING", "READY", "ACTIVE", "REJECTED", "RETIRED"]),
  name: z.string(),
  description: z.string(),
  activeVersionId: IdSchema.optional(),
  versionIds: z.array(IdSchema),
});

export const SkillRegressionInputSchema = z.object({
  versionId: IdSchema,
  cases: z.array(
    z.object({
      name: z.string().min(1).max(200),
      input: z.string().min(1).max(8000),
      expectedMustInclude: z.array(z.string().min(1)).default([]),
      forbiddenTerms: z.array(z.string().min(1)).default([]),
      channel: ContentChannelSchema.default("generic"),
      locale: z.string().default("zh-CN"),
    }),
  ).min(1).max(20),
});

export const SkillVersionSchema = CommonFieldsSchema.extend({
  status: z.enum(["IMPORTED", "TESTING", "READY", "ACTIVE", "REJECTED", "RETIRED"]),
  skillId: IdSchema,
  semanticVersion: z.string(),
  manifest: SkillImportInputSchema.shape.manifest,
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  securityPassed: z.boolean(),
  regressionPassed: z.boolean(),
  approvedBy: IdSchema.optional(),
});
