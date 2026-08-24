import { z } from "zod";

import { IdSchema, IsoDateSchema } from "./schemas.js";

const PublicHttpUrlSchema = z.string().url().superRefine((value, context) => {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const privateHost = host === "localhost" || host === "::1" || host.endsWith(".local") ||
    /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host) ||
    /^169\.254\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host) ||
    /^fc/iu.test(host) || /^fd/iu.test(host) || /^fe[89ab]/iu.test(host);
  if (!/^https?:$/u.test(parsed.protocol) || privateHost) {
    context.addIssue({ code: "custom", message: "Only public HTTP(S) sources are allowed" });
  }
});

export const PackagingChannelSchema = z.enum([
  "wechat",
  "short_video",
  "xiaohongshu",
  "x",
  "linkedin",
  "youtube",
  "podcast",
]);

export const PackagingStatusSchema = z.enum([
  "QUEUED",
  "GENERATING",
  "VALIDATING",
  "SELECTING",
  "REVIEWING",
  "AUTO_SELECTED",
  "AUTO_SELECTED_WITH_WARNING",
  "REVISION_REQUIRED",
  "BLOCKED",
  "SUPERSEDED",
  "FAILED",
]);

export const PackagingResearchModeSchema = z.enum(["LOCAL_CORPUS", "PUBLIC_PATTERN_PACK"]);

export const PackagingAccountProfileSchema = z.enum([
  "JOVAAI_OFFICIAL",
  "ECHRONOS_OFFICIAL",
  "OTHER",
]);

export const TitleMechanismSchema = z.enum([
  "question",
  "contrast",
  "curiosity",
  "benefit",
  "number",
  "scenario",
  "person_or_product",
  "historical_to_current",
  "stage_transition",
  "enterprise_decision",
]);

export const TitlePatternResearchPackSchema = z.object({
  patternPackId: IdSchema,
  researchMode: z.literal("PUBLIC_PATTERN_PACK"),
  publicSafeQueries: z.array(z.string().min(1)).min(1).max(12),
  sources: z.array(z.object({
    title: z.string().min(1),
    url: PublicHttpUrlSchema,
    publisher: z.string().min(1),
    retrievedAt: IsoDateSchema,
  })).min(1).max(30),
  patterns: z.array(z.object({
    mechanism: TitleMechanismSchema,
    observation: z.string().min(1),
    safeExample: z.string().min(1),
    sourceIndexes: z.array(z.number().int().nonnegative()).min(1),
  })).min(1).max(30),
  riskWarnings: z.array(z.string()),
  promptVersion: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateSchema,
}).superRefine((value, context) => {
  value.patterns.forEach((pattern, patternIndex) => {
    pattern.sourceIndexes.forEach((sourceIndex) => {
      if (sourceIndex >= value.sources.length) {
        context.addIssue({
          code: "custom",
          path: ["patterns", patternIndex, "sourceIndexes"],
          message: `Source index ${sourceIndex} is outside the source list`,
        });
      }
    });
  });
});

export const PackagingBriefSchema = z.object({
  packagingRequestId: IdSchema,
  missionId: IdSchema,
  organizationId: IdSchema,
  sourceContentVersionId: IdSchema,
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceReviewId: IdSchema,
  variantArtifactRefs: z.array(IdSchema).min(1),
  channels: z.array(PackagingChannelSchema).min(1),
  targetAudience: z.array(z.string().min(1)).min(1),
  accountProfile: PackagingAccountProfileSchema,
  contentPromise: z.string().min(1),
  coreConflict: z.string().min(1),
  readerBenefit: z.string().min(1),
  claimBindingSnapshot: z.array(z.record(z.string(), z.unknown())),
  brandRules: z.array(z.string()),
  forbiddenExpressions: z.array(z.string()),
  titleCorpusSnapshot: z.string().min(1),
  titlePatternPackSnapshot: z.string().min(1),
  applicablePreferenceSet: z.array(z.string()),
  candidateCount: z.number().int().min(50).max(80).default(60),
  revisionRound: z.number().int().min(0).max(1).default(0),
  previousSelectionId: IdSchema.optional(),
  researchMode: PackagingResearchModeSchema.default("LOCAL_CORPUS"),
  traceId: IdSchema,
  titlePolicyVersion: z.string().min(1),
  createdAt: IsoDateSchema,
});

export const TitleCandidateSchema = z.object({
  candidateId: IdSchema,
  text: z.string().min(1).max(300),
  mechanism: TitleMechanismSchema,
  suggestedChannels: z.array(PackagingChannelSchema).min(1),
  keywords: z.array(z.string()),
  contentPromise: z.string().min(1),
  supportingClaimIds: z.array(IdSchema),
  supportingSectionRefs: z.array(z.string()),
  hardGateStatus: z.enum(["PASS", "REJECTED"]),
  riskWarnings: z.array(z.string()),
});

export const TitleCandidatePoolSchema = z.object({
  poolId: IdSchema,
  packagingRequestId: IdSchema,
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: PackagingStatusSchema,
  candidates: z.array(TitleCandidateSchema).min(50).max(80),
  generationPromptVersion: z.string().min(1),
  titleCorpusSnapshot: z.string().min(1),
  titlePatternPackSnapshot: z.string().min(1),
  skillSnapshot: z.array(z.string()),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateSchema,
});

export const PackagingScoreBreakdownSchema = z.object({
  contentFidelity: z.number().min(0).max(20),
  audienceRelevance: z.number().min(0).max(15),
  curiosityOrConflict: z.number().min(0).max(15),
  readerBenefit: z.number().min(0).max(15),
  specificityAndImagery: z.number().min(0).max(10),
  brandProductFit: z.number().min(0).max(10),
  channelFit: z.number().min(0).max(5),
  titleCoverComplementarity: z.number().min(0).max(5),
  humanPreferenceFit: z.number().min(0).max(5),
  total: z.number().min(0).max(100),
});

export const ChannelPackagingSelectionSchema = z.object({
  channel: PackagingChannelSchema,
  primaryTitle: z.string().min(1).max(500),
  alternativeTitles: z.array(z.string().min(1).max(500)).length(3),
  coverMainText: z.string().max(200).optional(),
  coverSubText: z.string().max(300).optional(),
  videoTopLines: z.array(z.string().min(1).max(200)).max(2),
  descriptionHook: z.string().max(500).optional(),
  tags: z.array(z.string()).max(20),
  notApplicableFields: z.array(z.enum([
    "coverMainText",
    "coverSubText",
    "videoTopLines",
    "descriptionHook",
  ])),
  selectedCandidateId: IdSchema,
  selectionRationale: z.string().min(1),
  scoreBreakdown: PackagingScoreBreakdownSchema,
  scoreConfidence: z.number().min(0).max(1),
  supportingClaimIds: z.array(IdSchema),
  supportingSectionRefs: z.array(z.string()),
  riskWarnings: z.array(z.string()),
});

export const AutoPackagingSelectionSchema = z.object({
  selectionId: IdSchema,
  packagingRequestId: IdSchema,
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  candidatePoolHash: z.string().regex(/^[a-f0-9]{64}$/),
  selectionStatus: PackagingStatusSchema,
  shortlistedCandidates: z.array(IdSchema).min(5).max(8),
  channelSelections: z.array(ChannelPackagingSelectionSchema).min(1),
  overallRationale: z.string().min(1),
  scoreConfidence: z.number().min(0).max(1),
  preferenceCoverage: z.number().min(0).max(1),
  sourceCoverage: z.number().min(0).max(1),
  riskWarnings: z.array(z.string()),
  selectionPromptVersion: z.string().min(1),
  titlePolicyVersion: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateSchema,
});

export const PackagingReviewReportSchema = z.object({
  reviewId: IdSchema,
  packagingRequestId: IdSchema,
  selectionId: IdSchema,
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewStatus: z.enum(["PASS", "REVISION_REQUIRED", "BLOCKED", "FAILED"]),
  p0Count: z.number().int().nonnegative(),
  p1Count: z.number().int().nonnegative(),
  p2Count: z.number().int().nonnegative(),
  p3Count: z.number().int().nonnegative(),
  issues: z.array(z.object({
    issueId: IdSchema,
    severity: z.enum(["P0", "P1", "P2", "P3"]),
    module: z.enum([
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
    routeTo: z.enum(["packaging-copy-agent", "content-orchestrator", "makabaka", "public-researcher", "human"]),
    channel: PackagingChannelSchema.optional(),
    location: z.string().min(1),
    problem: z.string().min(1),
    suggestion: z.string().min(1),
    blocksFinalVariantsApproval: z.boolean(),
  })),
  overallConclusion: z.string().min(1),
  nextRoute: z.enum(["READY_FOR_FINAL_VARIANTS_GATE", "PACKAGING_REVISION", "CONTENT_REVISION", "HUMAN"]),
  reviewedAt: IsoDateSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PackagingFeedbackSchema = z.object({
  feedbackId: IdSchema,
  runId: IdSchema,
  organizationId: IdSchema,
  selectionId: IdSchema,
  selectedCandidateIds: z.array(IdSchema),
  rejectedCandidateIds: z.array(IdSchema),
  preferredCandidateIds: z.array(IdSchema),
  manualFinalTexts: z.record(z.string(), z.string()),
  reasons: z.array(z.string()),
  scope: z.string().min(1),
  channel: PackagingChannelSchema.optional(),
  generalizable: z.boolean(),
  submittedBy: IdSchema,
  submittedAt: IsoDateSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PackagingFeedbackInputSchema = PackagingFeedbackSchema.omit({
  feedbackId: true,
  organizationId: true,
  submittedBy: true,
  submittedAt: true,
  contentHash: true,
});

export const PackagingRegenerateInputSchema = z.object({
  researchMode: PackagingResearchModeSchema.default("LOCAL_CORPUS"),
});

export const PackagingOverrideSchema = z.object({
  overrideId: IdSchema,
  runId: IdSchema,
  organizationId: IdSchema,
  selectionId: IdSchema,
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  channelOverrides: z.partialRecord(PackagingChannelSchema, z.object({
    primaryTitle: z.string().min(1).max(500).optional(),
    coverMainText: z.string().max(200).optional(),
    coverSubText: z.string().max(300).optional(),
    videoTopLines: z.array(z.string().min(1).max(200)).max(2).optional(),
    tags: z.array(z.string()).max(20).optional(),
  })),
  reason: z.string().min(1),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  validationStatus: z.enum(["PENDING_REVIEW", "PASS", "BLOCKED"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const PackagingOverrideInputSchema = PackagingOverrideSchema.omit({
  overrideId: true,
  organizationId: true,
  createdBy: true,
  createdAt: true,
  validationStatus: true,
  contentHash: true,
});

export type PackagingChannel = z.infer<typeof PackagingChannelSchema>;
export type TitlePatternResearchPack = z.infer<typeof TitlePatternResearchPackSchema>;
export type PackagingBrief = z.infer<typeof PackagingBriefSchema>;
export type TitleCandidate = z.infer<typeof TitleCandidateSchema>;
export type TitleCandidatePool = z.infer<typeof TitleCandidatePoolSchema>;
export type ChannelPackagingSelection = z.infer<typeof ChannelPackagingSelectionSchema>;
export type AutoPackagingSelection = z.infer<typeof AutoPackagingSelectionSchema>;
export type PackagingReviewReport = z.infer<typeof PackagingReviewReportSchema>;
export type PackagingFeedback = z.infer<typeof PackagingFeedbackSchema>;
export type PackagingFeedbackInput = z.infer<typeof PackagingFeedbackInputSchema>;
export type PackagingRegenerateInput = z.infer<typeof PackagingRegenerateInputSchema>;
export type PackagingOverride = z.infer<typeof PackagingOverrideSchema>;
export type PackagingOverrideInput = z.infer<typeof PackagingOverrideInputSchema>;
