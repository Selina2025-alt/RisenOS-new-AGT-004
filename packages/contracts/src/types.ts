import type { z } from "zod";
import type {
  AgentRunSchema,
  AgentRunStepSchema,
  BatchMissionInputSchema,
  ContentBatchSchema,
  AssetBriefSchema,
  AssetRightsSchema,
  ChannelVariantSchema,
  ClaimInputSchema,
  ContentAssetSchema,
  ContentBriefSchema,
  ContentMissionInputSchema,
  ContentMissionSchema,
  ContentPackageSchema,
  ContentResearchSchema,
  ContentStatusSchema,
  ContentValidationResultSchema,
  ContentVersionSchema,
  HostGenerationMetadataSchema,
  CreateContentPackageInputSchema,
  CreateLocalizationInputSchema,
  GenerateAssetBriefInputSchema,
  CreateVariantInputSchema,
  CreateVersionInputSchema,
  CreateContentTemplateInputSchema,
  ContentTemplateSchema,
  AuditQuerySchema,
  AuditEventSchema,
  CreateSourceAttachmentInputSchema,
  SourceAttachmentSchema,
  PreparedSourceAttachmentSchema,
  EvidenceInputSchema,
  EvidenceRequestSchema,
  EvidenceFulfillmentInputSchema,
  OutboxMessageSchema,
  AgentMessageEnvelopeSchema,
  GeneratedAssetSchema,
  GeneratedContentBundleSchema,
  OutlineSchema,
  ReviewDecisionInputSchema,
  ReviewDecisionSchema,
  ReviewRequestInputSchema,
  ReviewRequestSchema,
  RunStatusSchema,
  SkillImportInputSchema,
  SkillPackageSchema,
  SkillRegressionInputSchema,
  SkillVersionSchema,
  AiStyleReviewSchema,
  LogicReviewSchema,
  VariantBriefSchema,
  BalalaVariantPackageSchema,
} from "./schemas.js";

export type ContentStatus = z.infer<typeof ContentStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type AssetRights = z.infer<typeof AssetRightsSchema>;
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export type ClaimInput = z.infer<typeof ClaimInputSchema>;
export type ContentMissionInput = z.infer<typeof ContentMissionInputSchema>;
export type ContentMission = z.infer<typeof ContentMissionSchema>;
export type ContentBrief = z.infer<typeof ContentBriefSchema>;
export type ContentResearch = z.infer<typeof ContentResearchSchema>;
export type Outline = z.infer<typeof OutlineSchema>;
export type ChannelVariant = z.infer<typeof ChannelVariantSchema>;
export type AssetBrief = z.infer<typeof AssetBriefSchema>;
export type GeneratedContentBundle = z.infer<typeof GeneratedContentBundleSchema>;
export type ContentVersion = z.infer<typeof ContentVersionSchema>;
export type HostGenerationMetadata = z.infer<typeof HostGenerationMetadataSchema>;
export type ContentAsset = z.infer<typeof ContentAssetSchema>;
export type ContentValidationResult = z.infer<typeof ContentValidationResultSchema>;
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;
export type EvidenceFulfillmentInput = z.infer<typeof EvidenceFulfillmentInputSchema>;
export type OutboxMessage = z.infer<typeof OutboxMessageSchema>;
export type AgentMessageEnvelope = z.infer<typeof AgentMessageEnvelopeSchema>;
export type ReviewRequestInput = z.infer<typeof ReviewRequestInputSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInputSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
export type GeneratedAsset = z.infer<typeof GeneratedAssetSchema>;
export type ContentPackage = z.infer<typeof ContentPackageSchema>;
export type AgentRunStep = z.infer<typeof AgentRunStepSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type BatchMissionInput = z.infer<typeof BatchMissionInputSchema>;
export type ContentBatch = z.infer<typeof ContentBatchSchema>;
export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>;
export type CreateVariantInput = z.infer<typeof CreateVariantInputSchema>;
export type CreateLocalizationInput = z.infer<typeof CreateLocalizationInputSchema>;
export type GenerateAssetBriefInput = z.infer<typeof GenerateAssetBriefInputSchema>;
export type CreateContentPackageInput = z.infer<typeof CreateContentPackageInputSchema>;
export type CreateContentTemplateInput = z.infer<typeof CreateContentTemplateInputSchema>;
export type ContentTemplate = z.infer<typeof ContentTemplateSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type CreateSourceAttachmentInput = z.infer<typeof CreateSourceAttachmentInputSchema>;
export type SourceAttachment = z.infer<typeof SourceAttachmentSchema>;
export type PreparedSourceAttachment = z.infer<typeof PreparedSourceAttachmentSchema>;
export type SkillImportInput = z.infer<typeof SkillImportInputSchema>;
export type SkillPackage = z.infer<typeof SkillPackageSchema>;
export type SkillRegressionInput = z.infer<typeof SkillRegressionInputSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export type AiStyleReview = z.infer<typeof AiStyleReviewSchema>;
export type LogicReview = z.infer<typeof LogicReviewSchema>;
export type VariantBrief = z.infer<typeof VariantBriefSchema>;
export type BalalaVariantPackage = z.infer<typeof BalalaVariantPackageSchema>;

export interface RequestIdentity {
  organizationId: string;
  userId: string;
  role: "ADMIN" | "CREATOR" | "REVIEWER" | "VIEWER";
}

export interface Page<T> {
  items: T[];
  total: number;
  cursor?: string;
}
