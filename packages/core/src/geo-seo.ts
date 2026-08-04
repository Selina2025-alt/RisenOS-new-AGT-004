import {
  GeoSeoOptimizationProposalSchema,
  GeoSeoRequestSchema,
  type GeoQuestionCoverage,
  type GeoSeoOptimizationProposal,
  type GeoSeoRequest,
} from "@risen/content-contracts";

import { newId, nowIso, sha256 } from "./utils.js";

export interface GeoSeoComposerInput {
  request: GeoSeoRequest;
  primaryIntent: string;
  secondaryIntents?: string[];
  geoQuestions?: Array<{ geoId: string; question: string; coveredBy?: string[]; evidenceIds?: string[] }>;
  entityMap?: GeoSeoOptimizationProposal["entityMap"];
  answerBlocks?: GeoSeoOptimizationProposal["answerBlocks"];
  seoEdits?: GeoSeoOptimizationProposal["seoEdits"];
  geoEdits?: GeoSeoOptimizationProposal["geoEdits"];
  evidenceGaps?: GeoSeoOptimizationProposal["evidenceGaps"];
  technicalRecommendations?: GeoSeoOptimizationProposal["technicalRecommendations"];
  riskWarnings?: string[];
  newClaims?: GeoSeoOptimizationProposal["newClaims"];
  proposedRevisionText?: string;
}

function coverage(items: GeoSeoComposerInput["geoQuestions"]): GeoQuestionCoverage[] {
  return (items ?? []).map((item) => ({
    geoId: item.geoId,
    question: item.question,
    coveredBy: item.coveredBy ?? [],
    coverage: item.coveredBy?.length ? "FULL" : "MISSING",
    evidenceIds: item.evidenceIds ?? [],
  }));
}

/**
 * Validates and hashes a GEO/SEO proposal before 004 is allowed to apply it.
 * This function deliberately does not mutate a ContentVersion and cannot add
 * claims without an evidence request.
 */
export function composeGeoSeoProposal(input: GeoSeoComposerInput): GeoSeoOptimizationProposal {
  const request = GeoSeoRequestSchema.parse(input.request);
  const draft = {
    id: newId("geo-proposal"),
    organizationId: request.organizationId,
    createdBy: "xiaodiandian",
    traceId: request.traceId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "PROPOSED",
    proposalId: newId("proposal"),
    sourceContentVersionId: request.sourceContentVersionId,
    issueIds: [],
    primaryIntent: input.primaryIntent,
    secondaryIntents: input.secondaryIntents ?? [],
    geoQuestionCoverage: coverage(input.geoQuestions),
    entityMap: input.entityMap ?? [],
    answerBlocks: input.answerBlocks ?? [],
    seoEdits: input.seoEdits ?? [],
    geoEdits: input.geoEdits ?? [],
    evidenceGaps: input.evidenceGaps ?? [],
    technicalRecommendations: input.technicalRecommendations ?? [],
    newClaims: input.newClaims ?? [],
    riskWarnings: input.riskWarnings ?? [],
    requiresEvidenceRequest: (input.newClaims?.length ?? 0) > 0 || (input.evidenceGaps?.length ?? 0) > 0,
    ...(input.proposedRevisionText ? { proposedRevisionText: input.proposedRevisionText } : {}),
  };
  const proposalHash = sha256(JSON.stringify(draft));
  return GeoSeoOptimizationProposalSchema.parse({
    ...draft,
    proposalHash,
  });
}

export function assertGeoProposalCanBeApplied(proposal: GeoSeoOptimizationProposal): void {
  GeoSeoOptimizationProposalSchema.parse(proposal);
  if (proposal.newClaims.length > 0 && !proposal.requiresEvidenceRequest) {
    throw new Error("GEO proposal with new claims must require an EvidenceRequest");
  }
  if (proposal.technicalRecommendations.some((item) => item.executedByAgt004 !== false)) {
    throw new Error("Technical GEO recommendations are advisory-only");
  }
}
