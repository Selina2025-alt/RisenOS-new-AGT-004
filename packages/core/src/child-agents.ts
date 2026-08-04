import {
  GeoSeoOptimizationProposalSchema,
  GeoSeoRequestSchema,
  LilithReviewReportSchema,
  type ContentVersion,
  type GeoSeoOptimizationProposal,
  type GeoSeoRequest,
  type LilithReviewReport,
  type ReviewRequest,
} from "@risen/content-contracts";

import type { GeoSeoPort, HostModelPort } from "./ports.js";
import { newId, nowIso } from "./utils.js";

const objectSchema = (name: string): Record<string, unknown> => ({
  type: "object",
  additionalProperties: true,
  title: name,
});

export class HostBackedLilithReviewAgent {
  public constructor(private readonly hostModel: HostModelPort) {}

  async review(input: {
    reviewRequest: ReviewRequest;
    content: ContentVersion;
    traceId: string;
  }): Promise<LilithReviewReport> {
    const requestId = newId("lilith-review");
    const result = await this.hostModel.generateObject({
      schemaName: "review_report",
      systemPrompt: "You are Lilith, the AGT-RSN-004 content reviewer. Review content only; do not approve yourself, publish, monitor platforms, or invent evidence.",
      input: {
        reviewRequest: input.reviewRequest,
        content: input.content,
        requiredRouting: "GEO/SEO issues route to xiaodiandian; 004 creates new versions",
      },
      jsonSchema: objectSchema("LilithReviewReport"),
      traceId: input.traceId,
      requestId,
      idempotencyKey: `${input.reviewRequest.id}:${input.content.contentHash}`,
      promptVersion: "lilith-review-v5.3",
      maxOutputTokens: 12_000,
      timeoutMs: 120_000,
    });
    return LilithReviewReportSchema.parse(result.output);
  }
}

export class HostBackedXiaodiandianAgent implements GeoSeoPort {
  public constructor(private readonly hostModel: HostModelPort) {}

  async optimize(input: GeoSeoRequest): Promise<GeoSeoOptimizationProposal> {
    const request = GeoSeoRequestSchema.parse(input);
    const result = await this.hostModel.generateObject({
      schemaName: "geo_seo_proposal",
      systemPrompt: "You are Xiaodiandian, the AGT-RSN-004 content-only GEO/SEO optimizer. Return a proposal, never mutate ContentVersion, never add an unsupported claim, never query platform effects, and mark technical website changes as advisory-only.",
      input: request,
      jsonSchema: objectSchema("GeoSeoOptimizationProposal"),
      traceId: request.traceId,
      requestId: newId("xiaodiandian").toString(),
      idempotencyKey: `${request.requestId}:${request.sourceContentVersionId}`,
      promptVersion: "xiaodiandian-geo-seo-v5.3",
      maxOutputTokens: 10_000,
      timeoutMs: 120_000,
    });
    return GeoSeoOptimizationProposalSchema.parse({
      ...result.output as Record<string, unknown>,
      updatedAt: nowIso(),
    });
  }
}

export class HostBackedBalalaVariantAgent {
  public constructor(private readonly hostModel: HostModelPort) {}

  async generate(input: {
    variantBrief: Record<string, unknown>;
    traceId: string;
  }): Promise<Record<string, unknown>> {
    const result = await this.hostModel.generateObject({
      schemaName: "variant_package",
      systemPrompt: "You are Balala, the AGT-RSN-004 channel variant agent. Adapt format and tone without changing approved claims, evidence, enterprise/product boundaries, or platform state.",
      input: input.variantBrief,
      jsonSchema: objectSchema("BalalaVariantPackage"),
      traceId: input.traceId,
      requestId: newId("balala-variant"),
      idempotencyKey: `${input.traceId}:balala:${JSON.stringify(input.variantBrief).length}`,
      promptVersion: "balala-variant-v5.3",
      maxOutputTokens: 12_000,
      timeoutMs: 120_000,
    });
    return result.output as Record<string, unknown>;
  }
}
