import { describe, expect, it } from "vitest";
import {
  assertGeoProposalCanBeApplied,
  composeGeoSeoProposal,
} from "../src/index.js";
import type { GeoSeoRequest } from "@risen/content-contracts";

const request: GeoSeoRequest = {
  id: "geo_request001",
  requestId: "geo_request001",
  organizationId: "org_test001",
  createdBy: "lilith00",
  traceId: "trace_geo001",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sourceContentVersionId: "version_test001",
  sourceReviewId: "review_test001",
  contentBriefId: "brief_test001",
  researchPackId: "research_test001",
  contentText: "企业需要理解智能体如何进入真实业务场景。",
  seoCorpusSnapshot: "seo-v1",
  geoCorpusSnapshot: "geo-v1",
  claimBindingSnapshot: "claims-v1",
  applicablePreferenceSet: "preferences-v1",
  requestedChecks: ["seo", "geo"],
  allowedResearchScope: "LOCAL_KNOWLEDGE_ONLY",
  status: "PENDING",
};

describe("Xiaodiandian GEO/SEO proposal", () => {
  it("creates a proposal without mutating a content version", () => {
    const proposal = composeGeoSeoProposal({
      request,
      primaryIntent: "企业智能体落地",
      secondaryIntents: ["Agentic OS", "企业AI转型"],
      geoQuestions: [{ geoId: "geo_q001", question: "什么是企业智能体？", coveredBy: ["section-1"] }],
      technicalRecommendations: [{
        type: "FAQ",
        recommendation: "增加一个直接回答主问题的 FAQ 区块",
        implementationOwner: "CONTENT_TEAM",
        executedByAgt004: false,
      }],
    });
    expect(proposal.proposalHash).toHaveLength(64);
    expect(proposal.requiresEvidenceRequest).toBe(false);
    expect(() => assertGeoProposalCanBeApplied(proposal)).not.toThrow();
  });

  it("forces an evidence request for new claims", () => {
    const proposal = composeGeoSeoProposal({
      request,
      primaryIntent: "企业智能体落地",
      newClaims: [{ statement: "某客户已经实现确定性增长", reason: "需要案例证明", requiresEvidence: true }],
    });
    expect(proposal.requiresEvidenceRequest).toBe(true);
    expect(() => assertGeoProposalCanBeApplied(proposal)).not.toThrow();
  });
});
