import { describe, expect, it } from "vitest";
import type { HostModelPort } from "../src/index.js";
import {
  HostBackedBalalaVariantAgent,
  HostBackedLilithReviewAgent,
  HostBackedXiaodiandianAgent,
  HostBackedMakabakaAgent,
  HostBackedPublicResearchAgent,
  HostBackedContentOrchestratorAgent,
} from "../src/index.js";
import type { GeoSeoRequest, ReviewRequest, ContentVersion } from "@risen/content-contracts";

const now = new Date().toISOString();
const base = { id: "review_0001", organizationId: "org_test001", createdBy: "user_test001", traceId: "trace_test001", createdAt: now, updatedAt: now };

function host(output: unknown, names: string[]): HostModelPort {
  return {
    async generateObject(request) {
      names.push(request.schemaName);
      return {
        output,
        metadata: {
          hostId: "codex",
          modelId: "host-model",
          modelVersion: "1",
          promptVersion: request.promptVersion,
          durationMs: 1,
          safetyStatus: "PASSED",
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
        },
      };
    },
  };
}

const review: ReviewRequest = {
  ...base,
  status: "PENDING",
  assetId: "asset_0001",
  versionId: "version_0001",
  reviewerType: "HUMAN",
  reviewerId: "reviewer_001",
  notes: "review",
};

const content: ContentVersion = {
  ...base,
  id: "version_0001",
  status: "DRAFT",
  assetId: "asset_0001",
  versionNumber: 1,
  title: "Test",
  body: "Test body",
  bodyFormat: "plain_text",
  contentHash: "a".repeat(64),
  changeReason: "test",
  changedBy: "user_test001",
  generationContextSnapshot: {},
  generationMetadataSnapshot: { hostId: "host", modelId: "model", modelVersion: "1", promptVersion: "test", durationMs: 1, safetyStatus: "PASSED", requestId: "request_001", idempotencyKey: "idempotency_001" },
  claimBindingSnapshot: [],
};

const geoRequest: GeoSeoRequest = {
  ...base,
  id: "geo_req001",
  requestId: "geo_req001",
  createdBy: "lilith00",
  status: "PENDING",
  sourceContentVersionId: "version_0001",
  sourceReviewId: "review_0001",
  contentBriefId: "brief_0001",
  researchPackId: "research_001",
  contentText: "Test",
  seoCorpusSnapshot: "seo",
  geoCorpusSnapshot: "geo",
  claimBindingSnapshot: "claims",
  applicablePreferenceSet: "preferences",
  requestedChecks: ["geo"],
  allowedResearchScope: "LOCAL_KNOWLEDGE_ONLY",
};

describe("host-backed child agents", () => {
  it("routes research, knowledge matching and drafting through proposal-only schemas", async () => {
    const schemaNames: string[] = [];
    await new HostBackedPublicResearchAgent(host({}, schemaNames)).research({ query: { topic: "AI" }, traceId: "trace_test001", idempotencyKey: "research_key_001" });
    await new HostBackedMakabakaAgent(host({}, schemaNames)).match({ context: { missionId: "mission_test001" }, traceId: "trace_test001", idempotencyKey: "knowledge_key_001" });
    await new HostBackedContentOrchestratorAgent(host({}, schemaNames)).draft({ context: { perspectiveContractId: "perspective_001" }, traceId: "trace_test001", idempotencyKey: "draft_key_001" });
    expect(schemaNames).toEqual(["research_pack", "knowledge_match", "draft_proposal"]);
  });
  it("routes Lilith and Xiaodiandian through host-owned schemas", async () => {
    const schemaNames: string[] = [];
    const lilithOutput = {
      ...base,
      reviewId: "review_0001",
      reviewStatus: "PASS",
      detectedType: "article",
      overallConclusion: "pass",
      contentAdequacy: {}, enterpriseFusion: {}, seoCoverage: {}, geoCoverage: {}, evidenceCheck: {}, complianceCheck: {}, aiStyleCheck: {}, logicCheck: {}, informationDensityCheck: {}, skillCrossCheck: {},
      mustFixIssues: [], stronglyRecommendedIssues: [], optionalIssues: [], preservedSections: [], humanConfirmationItems: [], ruleCandidates: [],
    };
    const geoOutput = {
      ...base,
      proposalId: "proposal_0001",
      status: "PROPOSED",
      sourceContentVersionId: "version_0001",
      issueIds: [], primaryIntent: "企业AI", secondaryIntents: [], geoQuestionCoverage: [], entityMap: [], answerBlocks: [], seoEdits: [], geoEdits: [], evidenceGaps: [], technicalRecommendations: [], newClaims: [], riskWarnings: [], requiresEvidenceRequest: false, proposalHash: "b".repeat(64),
    };
    const model = host(lilithOutput, schemaNames);
    await new HostBackedLilithReviewAgent(model).review({ reviewRequest: review, content, traceId: "trace_test001" });
    await new HostBackedXiaodiandianAgent(host(geoOutput, schemaNames)).optimize(geoRequest);
    expect(schemaNames).toEqual(["review_report", "geo_seo_proposal"]);
  });

  it("keeps Balala as a host-model adapter without platform fields", async () => {
    const schemaNames: string[] = [];
    const output = { variantId: "variant_0001", channel: "wechat", copy: { body: "text" } };
    const result = await new HostBackedBalalaVariantAgent(host(output, schemaNames)).generate({ variantBrief: { channel: "wechat" }, traceId: "trace_test001" });
    expect(schemaNames).toEqual(["variant_package"]);
    expect(result).not.toHaveProperty("publishTask");
    expect(result).not.toHaveProperty("platformContentId");
  });
});
