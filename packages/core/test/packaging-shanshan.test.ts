import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  AutoPackagingSelectionSchema,
  PackagingBriefSchema,
  TitlePatternResearchPackSchema,
  TitleCandidatePoolSchema,
  type PackagingChannel,
} from "@risen/content-contracts";

import {
  assertPackagingOverrideSafe,
  normalizeTags,
  validateCandidatePool,
  validateSelection,
} from "../src/packaging-shanshan.js";

const hash = "a".repeat(64);
const channels: PackagingChannel[] = ["wechat", "short_video", "xiaohongshu", "x", "linkedin", "youtube", "podcast"];

function brief() {
  return PackagingBriefSchema.parse({
    packagingRequestId: "packaging-request-001",
    missionId: "mission-packaging-001",
    organizationId: "organization-001",
    sourceContentVersionId: "content-version-001",
    sourceContentHash: hash,
    sourceReviewId: "review-001",
    variantArtifactRefs: channels.map((channel) => `variant-${channel}`),
    channels,
    targetAudience: ["企业决策者"],
    accountProfile: "JOVAAI_OFFICIAL",
    contentPromise: "解释企业AI从演示到业务的落地难题",
    coreConflict: "演示惊艳与业务失灵",
    readerBenefit: "判断AI落地的关键条件",
    claimBindingSnapshot: [{ claimId: "claim-001", evidenceIds: ["evidence-001"], statementHash: hash }],
    brandRules: ["JovaAI拼写准确"],
    forbiddenExpressions: ["260万亿"],
    titleCorpusSnapshot: "title-corpus-v1",
    titlePatternPackSnapshot: "title-pattern-pack-v1",
    applicablePreferenceSet: [],
    candidateCount: 50,
    researchMode: "LOCAL_CORPUS",
    traceId: "trace-packaging-001",
    titlePolicyVersion: "channel-packaging-policy-v1",
    createdAt: "2026-08-24T00:00:00.000Z",
  });
}

function pool() {
  const mechanisms = ["question", "contrast", "curiosity", "benefit", "number", "scenario", "person_or_product", "historical_to_current", "stage_transition", "enterprise_decision"] as const;
  return TitleCandidatePoolSchema.parse({
    poolId: "candidate-pool-001",
    packagingRequestId: "packaging-request-001",
    sourceContentHash: hash,
    status: "VALIDATING",
    candidates: Array.from({ length: 50 }, (_, index) => ({
      candidateId: `candidate-${String(index + 1).padStart(3, "0")}`,
      text: `${mechanisms[index % mechanisms.length]}企业题${index + 1}：业务场景${((index + 1) * 7919).toString(36)}的专属判断`,
      mechanism: mechanisms[index % mechanisms.length],
      suggestedChannels: channels,
      keywords: ["企业AI", "AI落地"],
      contentPromise: "解释正文中的企业AI落地问题",
      supportingClaimIds: ["claim-001"],
      supportingSectionRefs: [`section-${index + 1}`],
      hardGateStatus: "PASS",
      riskWarnings: [],
    })),
    generationPromptVersion: "packaging-copy-agent-candidate-generation-v5.6.0",
    titleCorpusSnapshot: "title-corpus-v1",
    titlePatternPackSnapshot: "title-pattern-pack-v1",
    skillSnapshot: ["title-tag-cover-generator"],
    inputHash: hash,
    contentHash: hash,
    createdAt: "2026-08-24T00:00:00.000Z",
  });
}

function selection() {
  const candidatePool = pool();
  return AutoPackagingSelectionSchema.parse({
    selectionId: "selection-001",
    packagingRequestId: "packaging-request-001",
    sourceContentHash: hash,
    candidatePoolHash: candidatePool.contentHash,
    selectionStatus: "AUTO_SELECTED",
    shortlistedCandidates: candidatePool.candidates.slice(0, 7).map((item) => item.candidateId),
    channelSelections: channels.map((channel, index) => ({
      channel,
      primaryTitle: `企业AI落地：${channel}如何解释演示与业务的落差`,
      alternativeTitles: [1, 2, 3].map((value) => `${channel}备选标题${value}`),
      ...(["x", "linkedin"].includes(channel) ? {} : { coverMainText: "从Demo到业务", coverSubText: "企业AI落地卡在哪" }),
      videoTopLines: channel === "short_video" || channel === "youtube" ? ["AI演示很好", "为什么业务却用不了"] : [],
      descriptionHook: channel === "podcast" ? "从一次业务任务讲清AI落地" : undefined,
      tags: channel === "xiaohongshu" ? ["#JovaAI", "#AI落地", "#AI搞事业howto"] : ["#JovaAI", "#AI落地"],
      notApplicableFields: ["x", "linkedin", "podcast"].includes(channel) ? ["videoTopLines"] : [],
      selectedCandidateId: candidatePool.candidates[index]!.candidateId,
      selectionRationale: "正文能够兑现且符合渠道语义",
      scoreBreakdown: {
        contentFidelity: 18,
        audienceRelevance: 14,
        curiosityOrConflict: 13,
        readerBenefit: 13,
        specificityAndImagery: 8,
        brandProductFit: 9,
        channelFit: 5,
        titleCoverComplementarity: 5,
        humanPreferenceFit: 5,
        total: 90,
      },
      scoreConfidence: 0.85,
      supportingClaimIds: ["claim-001"],
      supportingSectionRefs: ["opening", "section-2"],
      riskWarnings: [],
    })),
    overallRationale: "按渠道独立选择，并保持同一内容承诺",
    scoreConfidence: 0.85,
    preferenceCoverage: 0.8,
    sourceCoverage: 1,
    riskWarnings: [],
    selectionPromptVersion: "packaging-copy-agent-auto-selection-v5.6.0",
    titlePolicyVersion: "channel-packaging-policy-v1",
    contentHash: hash,
    createdAt: "2026-08-24T00:00:00.000Z",
  });
}

describe("Shanshan packaging policy", () => {
  it("accepts a diverse 50-title pool and complete seven-channel selection", () => {
    expect(validateCandidatePool(pool(), brief()).issues).toEqual([]);
    expect(validateSelection(selection(), brief(), pool()).issues).toEqual([]);
  });

  it("normalizes adhered and duplicate tags", () => {
    expect(normalizeTags(["#AI落地#企业AI", "#JovaAI", "#jovaai"])).toEqual(["#AI落地", "#企业AI", "#JovaAI"]);
  });

  it("blocks an override with a misspelled brand or unsupported promise", () => {
    expect(() => assertPackagingOverrideSafe({
      runId: "team-run-001",
      selectionId: "selection-001",
      sourceContentHash: hash,
      channelOverrides: { wechat: { primaryTitle: "JovaIAI保证提升300%" } },
      reason: "manual",
    })).toThrow(/brand spelling/i);
  });

  it("keeps E052-E056 as intent examples and corrects the E053 brand typo", async () => {
    const golden = JSON.parse(await readFile(new URL("../../../knowledge/title-packaging/PACKAGING_GOLDEN_SET_V1.json", import.meta.url), "utf8")) as { examples: Array<Record<string, unknown>> };
    expect(golden.examples).toHaveLength(5);
    expect(JSON.stringify(golden)).toContain("E056-10");
    expect(JSON.stringify(golden)).not.toContain("JovaIAI");
  });

  it("loads 176 sanitized title records without the CSV instruction column", async () => {
    const corpus = JSON.parse(await readFile(new URL("../../../knowledge/title-packaging/TITLE_CORPUS_V1.json", import.meta.url), "utf8")) as {
      records: Array<Record<string, unknown>>;
      metricUsage: string;
    };
    expect(corpus.records).toHaveLength(176);
    expect(corpus.metricUsage).toBe("REFERENCE_ONLY_NO_CAUSAL_WEIGHT");
    expect(corpus.records.every((record) => typeof record.title === "string" && !Object.keys(record).some((key) => /instruction|prompt|analysis/iu.test(key)))).toBe(true);
  });

  it("rejects localhost and private-network sources from public title-pattern packs", () => {
    const basePack = {
      patternPackId: "pattern-pack-001",
      researchMode: "PUBLIC_PATTERN_PACK",
      publicSafeQueries: ["public YouTube enterprise AI title patterns"],
      patterns: [{ mechanism: "question", observation: "problem-led framing", safeExample: "企业AI为什么落地难？", sourceIndexes: [0] }],
      riskWarnings: [],
      promptVersion: "public-researcher-title-patterns-v5.6.0",
      contentHash: hash,
      createdAt: "2026-08-24T00:00:00.000Z",
    };
    expect(TitlePatternResearchPackSchema.safeParse({
      ...basePack,
      sources: [{ title: "bad", url: "http://127.0.0.1/admin", publisher: "local", retrievedAt: "2026-08-24T00:00:00.000Z" }],
    }).success).toBe(false);
    expect(TitlePatternResearchPackSchema.safeParse({
      ...basePack,
      sources: [{ title: "public", url: "https://www.youtube.com/creators/", publisher: "YouTube", retrievedAt: "2026-08-24T00:00:00.000Z" }],
    }).success).toBe(true);
  });
});
