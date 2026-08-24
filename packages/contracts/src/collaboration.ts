import { z } from "zod";

import { CommonFieldsSchema, IdSchema, IsoDateSchema } from "./schemas.js";

export const AgentIdSchema = z.enum([
  "agt-004",
  "topic-radar",
  "public-researcher",
  "makabaka",
  "content-orchestrator",
  "lilith",
  "xiaodiandian",
  "balala",
  "packaging-copy-agent",
]);
export const AgentRolloutModeSchema = z.enum(["OFF", "SHADOW", "ENFORCING"]);
export const AgentTaskStatusSchema = z.enum([
  "QUEUED",
  "READY",
  "RUNNING",
  "WAITING_INPUT",
  "WAITING_EVIDENCE",
  "WAITING_REVIEW",
  "WAITING_HUMAN",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "EXPIRED",
]);

export const ArtifactStatusSchema = z.enum(["READY", "RESTRICTED", "EXPIRED"]);

export const AgentDefinitionSchema = z.object({
  agentId: AgentIdSchema,
  version: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  inputSchemas: z.array(z.string()),
  outputSchemas: z.array(z.string()),
  skills: z.array(z.string()),
  allowedTools: z.array(z.string()),
  forbiddenTools: z.array(z.string()),
  canWriteContentVersion: z.boolean(),
  canWriteKnowledge: z.boolean(),
  canWriteSkill: z.boolean(),
  canApprove: z.boolean(),
  maxConcurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  supportsPauseResume: z.boolean(),
  requiresHumanGate: z.boolean(),
  manifestHash: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED", "RETIRED"]),
  rolloutMode: AgentRolloutModeSchema.default("OFF"),
});

export const ArtifactRefSchema = z.object({
  artifactId: IdSchema,
  artifactType: z.string().min(1),
  schemaVersion: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  uri: z.string().min(1),
  mimeType: z.string().min(1),
  rights: z.string().min(1),
  createdByAgent: AgentIdSchema,
  sourceRefs: z.array(IdSchema),
  parentArtifactIds: z.array(IdSchema),
  status: ArtifactStatusSchema,
});

export const AgentLeaseSchema = z.object({
  owner: z.string().min(1),
  acquiredAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  heartbeatAt: IsoDateSchema,
});

export const AgentCheckpointSchema = CommonFieldsSchema.extend({
  taskId: IdSchema,
  stepId: z.string().min(1),
  inputArtifactRefs: z.array(ArtifactRefSchema),
  completedSubtasks: z.array(IdSchema),
  pendingSubtasks: z.array(IdSchema),
  outputArtifactRefs: z.array(ArtifactRefSchema),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["SAVED", "RESUMED", "EXPIRED"]),
});

export const AgentTaskSchema = CommonFieldsSchema.extend({
  taskId: IdSchema,
  rootRunId: IdSchema,
  parentTaskId: IdSchema.optional(),
  missionId: IdSchema,
  senderAgentId: AgentIdSchema,
  recipientAgentId: AgentIdSchema,
  taskType: z.string().min(1),
  agentVersion: z.string().min(1),
  skillSnapshot: z.array(z.string()),
  inputArtifactRefs: z.array(ArtifactRefSchema),
  outputSchema: z.string().min(1),
  dependencyTaskIds: z.array(IdSchema),
  status: AgentTaskStatusSchema,
  priority: z.number().int().min(0).max(100),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  deadline: IsoDateSchema,
  checkpointRef: IdSchema.optional(),
  idempotencyKey: z.string().min(8).max(256),
  approvalRequirement: z.enum(["NONE", "HUMAN", "EXTERNAL_REVIEW"]),
  lease: AgentLeaseSchema.optional(),
  error: z.string().optional(),
});

export const AgentTaskResultSchema = z.object({
  taskId: IdSchema,
  status: z.enum(["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "EXPIRED"]),
  outputArtifactRefs: z.array(ArtifactRefSchema),
  error: z.string().optional(),
  completedAt: IsoDateSchema,
});

export const InternalTaskEnvelopeSchema = z.object({
  protocolVersion: z.literal("1.0"),
  messageId: IdSchema,
  taskId: IdSchema,
  parentTaskId: IdSchema.optional(),
  senderAgentId: AgentIdSchema,
  recipientAgentId: AgentIdSchema,
  organizationId: IdSchema,
  traceId: IdSchema,
  idempotencyKey: z.string().min(8),
  sentAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  inputArtifactRefs: z.array(ArtifactRefSchema),
  requiredOutputSchema: z.string().min(1),
  capabilityToken: z.string().min(16),
});

export const GeoQuestionCoverageSchema = z.object({
  geoId: IdSchema,
  question: z.string().min(1),
  coveredBy: z.array(z.string()),
  coverage: z.enum(["FULL", "PARTIAL", "MISSING"]),
  evidenceIds: z.array(IdSchema),
});

export const ReviewIssueV53Schema = z.object({
  issueId: IdSchema,
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  module: z.enum([
    "ai_style",
    "repetition",
    "narrative_quality",
    "logic",
    "compliance",
    "evidence",
    "content_adequacy",
    "perspective_consistency",
    "enterprise_fusion",
    "knowledge_snapshot",
    "nomos_canon",
    "product_architecture",
    "claim_status",
    "customer_anonymization",
    "metric_evidence",
    "confidentiality",
    "skill_trace",
    "channel_structure",
    "seo",
    "geo",
    "geo_insertion",
    "technical_geo",
    "title_fidelity",
    "clickbait_risk",
    "unsupported_number",
    "brand_spelling",
    "title_cover_alignment",
    "video_overlay_alignment",
    "tag_policy",
    "platform_packaging",
    "opening_payoff",
    "candidate_diversity",
  ]),
  routeTo: z.enum([
    "agt-004",
    "public-researcher",
    "makabaka",
    "content-orchestrator",
    "xiaodiandian",
    "balala",
    "packaging-copy-agent",
    "human",
  ]),
  location: z.string().min(1),
  originalText: z.string(),
  problem: z.string().min(1),
  evidence: z.array(z.string()),
  suggestion: z.string().min(1),
  autoFixable: z.boolean(),
  blocksVariantGeneration: z.boolean(),
});

export const LilithReviewReportSchema = CommonFieldsSchema.extend({
  reviewId: IdSchema,
  reviewStatus: z.enum(["PASS", "REVISION_REQUIRED", "BLOCKED", "FAILED"]),
  detectedType: z.string().min(1),
  overallConclusion: z.string().min(1),
  contentAdequacy: z.record(z.string(), z.unknown()),
  enterpriseFusion: z.record(z.string(), z.unknown()),
  seoCoverage: z.record(z.string(), z.unknown()),
  geoCoverage: z.record(z.string(), z.unknown()),
  evidenceCheck: z.record(z.string(), z.unknown()),
  complianceCheck: z.record(z.string(), z.unknown()),
  aiStyleCheck: z.record(z.string(), z.unknown()),
  logicCheck: z.record(z.string(), z.unknown()),
  informationDensityCheck: z.record(z.string(), z.unknown()),
  skillCrossCheck: z.record(z.string(), z.unknown()),
  mustFixIssues: z.array(ReviewIssueV53Schema),
  stronglyRecommendedIssues: z.array(ReviewIssueV53Schema),
  optionalIssues: z.array(ReviewIssueV53Schema),
  preservedSections: z.array(z.string()),
  revisionDraft: z.string().optional(),
  humanConfirmationItems: z.array(z.string()),
  ruleCandidates: z.array(z.record(z.string(), z.unknown())),
});

export const EntityMentionSchema = z.object({
  entity: z.string().min(1),
  firstMention: z.string().min(1),
  role: z.enum(["company", "product", "agent", "industry", "person", "competitor"]),
});

export const GeoSeoRequestSchema = CommonFieldsSchema.extend({
  requestId: IdSchema,
  sourceContentVersionId: IdSchema,
  sourceReviewId: IdSchema,
  contentBriefId: IdSchema,
  researchPackId: IdSchema,
  contentText: z.string().min(1),
  seoCorpusSnapshot: z.string().min(1),
  geoCorpusSnapshot: z.string().min(1),
  claimBindingSnapshot: z.string().min(1),
  applicablePreferenceSet: z.string().min(1),
  requestedChecks: z.array(z.string()).min(1),
  allowedResearchScope: z.enum(["LOCAL_KNOWLEDGE_ONLY", "PUBLIC_READ_ONLY"]),
  status: z.enum(["PENDING", "RUNNING", "PROPOSED", "APPLIED", "BLOCKED", "FAILED"]),
});

export const TextEditSchema = z.object({
  location: z.string().min(1),
  originalText: z.string(),
  revisedText: z.string().min(1),
  reason: z.string().min(1),
  preservesClaims: z.boolean(),
});

export const TechnicalGeoRecommendationSchema = z.object({
  type: z.enum(["SCHEMA", "FAQ", "LLMS_TXT", "ROBOTS", "ENTITY_LINKING", "INTERNAL_LINKING"]),
  recommendation: z.string().min(1),
  implementationOwner: z.enum(["CONTENT_TEAM", "WEB_TEAM", "HUMAN"]),
  executedByAgt004: z.literal(false),
});

export const GeoSeoOptimizationProposalSchema = CommonFieldsSchema.extend({
  proposalId: IdSchema,
  status: z.enum(["PROPOSED", "APPLIED", "REJECTED", "EXPIRED"]),
  sourceContentVersionId: IdSchema,
  issueIds: z.array(IdSchema),
  primaryIntent: z.string().min(1),
  secondaryIntents: z.array(z.string()),
  geoQuestionCoverage: z.array(GeoQuestionCoverageSchema),
  entityMap: z.array(EntityMentionSchema),
  answerBlocks: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    evidenceIds: z.array(IdSchema),
  })),
  seoEdits: z.array(TextEditSchema),
  geoEdits: z.array(TextEditSchema),
  evidenceGaps: z.array(z.object({
    claimId: IdSchema.optional(),
    question: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  })),
  technicalRecommendations: z.array(TechnicalGeoRecommendationSchema),
  newClaims: z.array(z.object({
    statement: z.string().min(1),
    reason: z.string().min(1),
    requiresEvidence: z.literal(true),
  })),
  riskWarnings: z.array(z.string()),
  requiresEvidenceRequest: z.boolean(),
  proposedRevisionText: z.string().optional(),
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PreferenceRuleSchema = CommonFieldsSchema.extend({
  preferenceId: IdSchema,
  sourceFeedbackIds: z.array(IdSchema).min(1),
  scope: z.string().min(1),
  appliesWhen: z.array(z.string()),
  doesNotApplyWhen: z.array(z.string()),
  channel: z.array(z.string()),
  contentType: z.array(z.string()),
  audience: z.array(z.string()),
  topicType: z.array(z.string()),
  strength: z.enum(["RECOMMENDED", "STRONG", "MANDATORY"]),
  rule: z.string().min(1),
  examples: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  approvedByHuman: z.boolean(),
  version: z.string().min(1),
  status: z.enum(["CANDIDATE", "SHADOW", "ACTIVE", "ROLLED_BACK"]),
});

export type AgentId = z.infer<typeof AgentIdSchema>;
export type AgentRolloutMode = z.infer<typeof AgentRolloutModeSchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type AgentLease = z.infer<typeof AgentLeaseSchema>;
export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type AgentTaskResult = z.infer<typeof AgentTaskResultSchema>;
export type InternalTaskEnvelope = z.infer<typeof InternalTaskEnvelopeSchema>;
export type GeoQuestionCoverage = z.infer<typeof GeoQuestionCoverageSchema>;
export type ReviewIssueV53 = z.infer<typeof ReviewIssueV53Schema>;
export type LilithReviewReport = z.infer<typeof LilithReviewReportSchema>;
export type EntityMention = z.infer<typeof EntityMentionSchema>;
export type GeoSeoRequest = z.infer<typeof GeoSeoRequestSchema>;
export type GeoSeoOptimizationProposal = z.infer<typeof GeoSeoOptimizationProposalSchema>;
export type PreferenceRule = z.infer<typeof PreferenceRuleSchema>;
