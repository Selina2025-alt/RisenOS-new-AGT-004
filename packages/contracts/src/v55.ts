import { z } from "zod";

import { CommonFieldsSchema, IdSchema, IsoDateSchema } from "./schemas.js";

export const MissionClassSchema = z.enum([
  "PUBLIC_TOPIC",
  "ENTERPRISE_AI",
  "PRODUCT_CONTENT",
  "NOMOS_CONTENT",
  "CUSTOMER_CASE",
  "BRAND_THOUGHT_LEADERSHIP",
]);

export const PublicationScopeSchema = z.enum([
  "INTERNAL",
  "EXTERNAL_DRAFT",
  "PUBLIC",
]);

export const MissionPreflightInputSchema = z.object({
  missionClass: MissionClassSchema,
  enterpriseRelevance: z.enum(["NONE", "INDIRECT", "DIRECT"]),
  topicEntities: z.array(z.string().min(1).max(300)).default([]),
  publicationScope: PublicationScopeSchema,
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  requiresPublicResearch: z.boolean(),
  requiresEnterpriseKnowledge: z.boolean(),
  requiresNomosPolicy: z.boolean(),
  requiresCasePolicy: z.boolean(),
});

export const MissionPreflightSchema = CommonFieldsSchema.extend({
  status: z.enum(["READY", "WAITING_HUMAN", "BLOCKED"]),
  missionId: IdSchema,
  ...MissionPreflightInputSchema.shape,
  errorCode: z.string().optional(),
});

export const PerspectiveContractInputSchema = z.object({
  speaker: z.string().min(1).max(300),
  audience: z.array(z.string().min(1).max(500)).min(1),
  channel: z.string().min(1).max(100),
  voicePositioning: z.string().min(1).max(1000),
  publicationScope: PublicationScopeSchema,
  narrativeLevel: z.enum(["BUSINESS", "TECHNICAL", "PROFESSIONAL_CONFERENCE"]),
  brandNaming: z.enum(["NOMOS", "JOVAAI_NOMOS", "NOT_APPLICABLE"]),
  confirmationMode: z.enum(["DEFAULT_POLICY", "EXPLICIT_HUMAN"]),
  confirmedBy: IdSchema,
  confirmedAt: IsoDateSchema,
});

export const PerspectiveContractSchema = CommonFieldsSchema.extend({
  status: z.literal("CONFIRMED"),
  missionId: IdSchema,
  ...PerspectiveContractInputSchema.shape,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const KnowledgeSourceRecordSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  sourceId: IdSchema,
  originalFileName: z.string().min(1),
  repositoryPath: z.string().min(1),
  binaryHash: z.string().regex(/^[a-f0-9]{64}$/),
  extractedTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  structuredExtractionHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceType: z.enum([
    "user_confirmed",
    "rd_document",
    "meeting_transcript",
    "meeting_record",
    "corrected_transcript",
    "raw_transcript",
    "curated_master",
    "historical_master",
    "summary",
    "ai_summary",
    "public_research",
    "approved_knowledge",
    "provided_document",
  ]),
  sourceDate: z.string().date(),
  authorityLevel: z.number().int().min(1).max(10),
  confidentiality: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
  repositoryVisibility: z.enum(["PUBLIC", "PRIVATE"]),
  publicationDisposition: z.enum(["PUBLIC_SAFE", "INTERNAL_SOURCE", "PROHIBITED"]),
  derivedFrom: z.array(IdSchema),
  supersedes: z.array(IdSchema),
  extractionCompleteness: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
  extractionWarnings: z.array(z.string()),
  knowledgeActivation: z.enum(["NOT_ACTIVATED", "CANDIDATE", "ACTIVE", "REJECTED"]),
});

export const ClaimClassSchema = z.enum([
  "PUBLIC_CONFIRMED",
  "PRODUCT_DEMONSTRATED",
  "RD_CONFIRMED",
  "STRATEGIC_VIEW",
  "IDEAL_STATE",
  "PENDING_CONFIRMATION",
  "PENDING_EXTERNAL_VERIFICATION",
  "PROHIBITED",
]);

export const ProductStatusSchema = z.enum([
  "RESEARCH",
  "PROTOTYPE",
  "TEST",
  "POC",
  "DEMONSTRATED",
  "PRODUCTION",
  "UNKNOWN",
]);

export const KnowledgeClaimCardSchema = CommonFieldsSchema.extend({
  status: z.enum(["ACTIVE", "SUPERSEDED", "CONFLICTING", "HISTORICAL", "REJECTED"]),
  claimId: IdSchema,
  statement: z.string().min(1).max(8000),
  claimClass: ClaimClassSchema,
  productStatus: ProductStatusSchema,
  evidenceRefs: z.array(IdSchema),
  allowedAudiences: z.array(z.string().min(1)),
  publicationDisposition: z.enum(["PUBLIC_SAFE", "INTERNAL_ONLY", "PROHIBITED"]),
  publicSafeWording: z.string().max(8000).optional(),
  forbiddenWording: z.array(z.string().min(1)),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  validFrom: IsoDateSchema,
  validUntil: IsoDateSchema.optional(),
  approvedBy: IdSchema.optional(),
});

export const KnowledgeConflictSchema = CommonFieldsSchema.extend({
  status: z.enum(["OPEN", "RESOLVED", "ACCEPTED_EXCEPTION"]),
  conflictId: IdSchema,
  claimCardIds: z.array(IdSchema).min(2),
  description: z.string().min(1),
  resolution: z.string().optional(),
  resolvedBy: IdSchema.optional(),
  resolvedAt: IsoDateSchema.optional(),
});

export const KnowledgeSnapshotSchema = CommonFieldsSchema.extend({
  status: z.enum(["ACTIVE", "SUPERSEDED", "BLOCKED"]),
  snapshotId: IdSchema,
  missionId: IdSchema,
  canonVersion: z.string().min(1),
  sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  claimCardIds: z.array(IdSchema),
  conflictIds: z.array(IdSchema),
  audienceLayer: z.enum(["BUSINESS", "TECHNICAL", "PROFESSIONAL_CONFERENCE"]),
  publicationScope: PublicationScopeSchema,
  knowledgePolicyVersion: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  errorCode: z.literal("SOURCE_SNAPSHOT_STALE").optional(),
});

export const CaseMetricSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1),
  evidenceRef: IdSchema,
});

export const CaseEvidenceCardSchema = CommonFieldsSchema.extend({
  status: z.enum(["CANDIDATE", "APPROVED", "BLOCKED", "SUPERSEDED"]),
  caseAlias: z.string().min(1),
  countryOrRegion: z.string().min(1),
  industry: z.string().min(1),
  anonymizationLevel: z.enum(["CATEGORY_ONLY", "REGION_AND_CATEGORY", "APPROVED_ALIAS"]),
  metrics: z.array(CaseMetricSchema),
  measurementPeriod: z.string().min(1),
  baseline: z.string().min(1),
  measurementMethod: z.string().min(1),
  sourceRef: IdSchema,
  publicUseStatus: z.enum(["NOT_REVIEWED", "APPROVED", "PROHIBITED"]),
  reidentificationRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  approvedBy: IdSchema.optional(),
});

export const DraftProposalSchema = CommonFieldsSchema.extend({
  status: z.enum(["PROPOSED", "ACCEPTED", "REJECTED", "EXPIRED"]),
  missionId: IdSchema,
  perspectiveContractId: IdSchema,
  knowledgeSnapshotId: IdSchema.optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  claimIds: z.array(IdSchema),
  evidenceIds: z.array(IdSchema),
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdByAgent: z.literal("content-orchestrator"),
});

export const IssueRoutingDecisionSchema = z.object({
  issueId: IdSchema,
  routeTo: z.enum(["public-researcher", "makabaka", "content-orchestrator", "xiaodiandian", "balala", "human"]),
  reason: z.string().min(1),
  issueFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  automaticAttempt: z.number().int().min(0).max(2),
});

export const NomosNarrativeProfileSchema = z.object({
  audienceLayer: z.enum(["BUSINESS", "TECHNICAL", "PROFESSIONAL_CONFERENCE"]),
  productPortfolioPosition: z.literal("AGENT_TEAM_INSTITUTIONAL_AGENT"),
  technicalArchitecturePosition: z.literal("INSIDE_JOVAAI_OS_NOT_SIXTH_LAYER"),
  preferredName: z.enum(["Nomos 制度智能体", "JovaAI Nomos"]),
  allowedThemes: z.array(z.string()),
  suppressedThemes: z.array(z.string()),
});

export const ClaimDecisionInputSchema = z.object({
  claimId: IdSchema,
  decision: z.enum(["APPROVE", "REJECT", "SUPERSEDE", "MARK_CONFLICT"]),
  decidedBy: IdSchema,
  reason: z.string().min(1).max(4000),
});

export const MissionPreflightRequestSchema = z.object({
  preflight: MissionPreflightInputSchema,
  perspective: PerspectiveContractInputSchema,
  knowledge: z.object({
    sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
    claimCardIds: z.array(IdSchema),
    audienceLayer: z.enum(["BUSINESS", "TECHNICAL", "PROFESSIONAL_CONFERENCE"]),
    canonVersion: z.string().min(1).default("nomos-canon-20260820-v1.0.0"),
  }).optional(),
});

export const HumanGateSchema = z.enum([
  "PERSPECTIVE_CONFIRMED",
  "SOURCE_DRAFT_APPROVED",
  "FINAL_VARIANTS_APPROVED",
  "KNOWLEDGE_CONFLICT_DECIDED",
]);

export const HumanGateDecisionSchema = z.object({
  decisionId: IdSchema,
  organizationId: IdSchema,
  runId: IdSchema,
  gate: HumanGateSchema,
  artifactId: IdSchema,
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decidedBy: IdSchema,
  decidedAt: IsoDateSchema,
  notes: z.string().max(8000).optional(),
  idempotencyKey: z.string().min(8).max(256),
});

export const HumanGateDecisionInputSchema = HumanGateDecisionSchema.omit({
  decisionId: true,
  organizationId: true,
  decidedBy: true,
  decidedAt: true,
});

export const TopicRadarRequestSchema = z.object({
  organizationId: IdSchema,
  traceId: IdSchema,
  requestedBy: IdSchema,
});

export const TopicRadarResultSchema = z.object({
  radarId: z.string().min(1).max(256),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  topicPoolArtifact: z.object({
    uri: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  topicReportArtifact: z.object({
    uri: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  sourceHealth: z.array(z.record(z.string(), z.unknown())),
  candidateCount: z.number().int().nonnegative(),
});

export const TeamRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_HUMAN",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
]);

export const TeamRunSchema = z.object({
  runId: IdSchema,
  missionId: IdSchema,
  organizationId: IdSchema,
  traceId: IdSchema,
  createdBy: IdSchema,
  status: TeamRunStatusSchema,
  taskIds: z.array(IdSchema),
  currentGate: HumanGateSchema.optional(),
  sourceArtifactIds: z.array(IdSchema),
  requestedChannels: z.array(z.enum(["wechat", "short_video", "xiaohongshu", "x", "linkedin"])),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  error: z.string().optional(),
});

export const CreateTeamRunInputSchema = z.object({
  sourceArtifactIds: z.array(IdSchema).default([]),
  requestedChannels: z.array(z.enum(["wechat", "short_video", "xiaohongshu", "x", "linkedin"]))
    .min(1)
    .default(["wechat", "short_video", "xiaohongshu", "x", "linkedin"]),
});

export type MissionClass = z.infer<typeof MissionClassSchema>;
export type MissionPreflightInput = z.infer<typeof MissionPreflightInputSchema>;
export type MissionPreflight = z.infer<typeof MissionPreflightSchema>;
export type PerspectiveContractInput = z.infer<typeof PerspectiveContractInputSchema>;
export type PerspectiveContract = z.infer<typeof PerspectiveContractSchema>;
export type KnowledgeSourceRecord = z.infer<typeof KnowledgeSourceRecordSchema>;
export type KnowledgeClaimCard = z.infer<typeof KnowledgeClaimCardSchema>;
export type KnowledgeConflict = z.infer<typeof KnowledgeConflictSchema>;
export type KnowledgeSnapshot = z.infer<typeof KnowledgeSnapshotSchema>;
export type CaseEvidenceCard = z.infer<typeof CaseEvidenceCardSchema>;
export type DraftProposal = z.infer<typeof DraftProposalSchema>;
export type IssueRoutingDecision = z.infer<typeof IssueRoutingDecisionSchema>;
export type NomosNarrativeProfile = z.infer<typeof NomosNarrativeProfileSchema>;
export type ClaimDecisionInput = z.infer<typeof ClaimDecisionInputSchema>;
export type MissionPreflightRequest = z.infer<typeof MissionPreflightRequestSchema>;
export type HumanGate = z.infer<typeof HumanGateSchema>;
export type HumanGateDecision = z.infer<typeof HumanGateDecisionSchema>;
export type HumanGateDecisionInput = z.infer<typeof HumanGateDecisionInputSchema>;
export type TopicRadarRequest = z.infer<typeof TopicRadarRequestSchema>;
export type TopicRadarResult = z.infer<typeof TopicRadarResultSchema>;
export type TeamRun = z.infer<typeof TeamRunSchema>;
export type CreateTeamRunInput = z.infer<typeof CreateTeamRunInputSchema>;
