import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  KnowledgeClaimCardSchema,
  KnowledgeSourceRecordSchema,
  type CaseEvidenceCard,
  type KnowledgeClaimCard,
  type MissionPreflightInput,
  type PerspectiveContractInput,
} from "@risen/content-contracts";
import {
  LoopBudgetGuard,
  assertDraftGate,
  assertKnowledgeSnapshotFresh,
  createKnowledgeSnapshot,
  createMissionPreflight,
  createPerspectiveContract,
  routeReviewIssue,
  validateCaseEvidence,
  validateNomosContent,
} from "../src/index.js";

const common = {
  missionId: "mission_v55001",
  organizationId: "org_jovaai",
  createdBy: "user_enterprise",
  traceId: "trace_v55001",
};

const preflightValue: MissionPreflightInput = {
  missionClass: "NOMOS_CONTENT",
  enterpriseRelevance: "DIRECT",
  topicEntities: ["Nomos"],
  publicationScope: "EXTERNAL_DRAFT",
  riskLevel: "HIGH",
  requiresPublicResearch: false,
  requiresEnterpriseKnowledge: true,
  requiresNomosPolicy: true,
  requiresCasePolicy: false,
};

const perspectiveValue: PerspectiveContractInput = {
  speaker: "艾氪智能",
  audience: ["企业负责人"],
  channel: "wechat",
  voicePositioning: "第一方真诚分享",
  publicationScope: "EXTERNAL_DRAFT",
  narrativeLevel: "BUSINESS",
  brandNaming: "NOMOS",
  confirmationMode: "EXPLICIT_HUMAN",
  confirmedBy: "user_enterprise",
  confirmedAt: new Date().toISOString(),
};

function claim(): KnowledgeClaimCard {
  const now = new Date().toISOString();
  return {
    id: "kc_test_nomos01",
    claimId: "kc_test_nomos01",
    organizationId: common.organizationId,
    createdBy: common.createdBy,
    traceId: common.traceId,
    createdAt: now,
    updatedAt: now,
    status: "ACTIVE",
    statement: "Nomos位于JovaAI OS内部。",
    claimClass: "RD_CONFIRMED",
    productStatus: "DEMONSTRATED",
    evidenceRefs: ["SRC-NOMOS-202608-01"],
    allowedAudiences: ["BUSINESS"],
    publicationDisposition: "PUBLIC_SAFE",
    publicSafeWording: "Nomos的制度协同机制位于JovaAI OS内部。",
    forbiddenWording: ["Nomos是第六层"],
    riskLevel: "HIGH",
    validFrom: now,
    approvedBy: common.createdBy,
  };
}

describe("V5.5 executable governance gates", () => {
  it("parses all nine immutable Nomos sources and the classified claim cards", async () => {
    const sourceManifest = JSON.parse(await readFile(new URL("../../../knowledge/sources/ingested/nomos-canon-20260820-v1.0.0/source_manifest.json", import.meta.url), "utf8"));
    const claimCards = JSON.parse(await readFile(new URL("../../../knowledge/canon/nomos-canon-20260820-v1.0.0/claim-cards.json", import.meta.url), "utf8"));
    expect(sourceManifest.sources).toHaveLength(9);
    expect(sourceManifest.sources.every((item: unknown) => KnowledgeSourceRecordSchema.safeParse(item).success)).toBe(true);
    expect(claimCards.every((item: unknown) => KnowledgeClaimCardSchema.safeParse(item).success)).toBe(true);
  });
  it("blocks enterprise drafting without perspective or knowledge snapshot", () => {
    const preflight = createMissionPreflight({ ...common, value: preflightValue });
    expect(() => assertDraftGate({ preflight })).toThrow("PerspectiveContract");
    const perspective = createPerspectiveContract({ ...common, value: perspectiveValue });
    expect(() => assertDraftGate({ preflight, perspective })).toThrow("KnowledgeSnapshot");
  });

  it("allows drafting only with the matching immutable gate objects", () => {
    const preflight = createMissionPreflight({ ...common, value: preflightValue });
    const perspective = createPerspectiveContract({ ...common, value: perspectiveValue });
    const snapshot = createKnowledgeSnapshot({
      ...common,
      sourceHashes: ["a".repeat(64)],
      claimCards: [claim()],
      conflicts: [],
      audienceLayer: "BUSINESS",
      publicationScope: "EXTERNAL_DRAFT",
    });
    expect(() => assertDraftGate({ preflight, perspective, knowledgeSnapshot: snapshot })).not.toThrow();
    expect(() => assertKnowledgeSnapshotFresh(snapshot, ["b".repeat(64)])).toThrow("blocked");
  });

  it("blocks known Nomos red lines and requires attribution for strategic views", () => {
    expect(validateNomosContent("Nomos是JovaAI第六层").map((item) => item.code)).toContain("NOMOS_SIXTH_LAYER");
    expect(validateNomosContent("产品叫Wtree Ultra，已经实现分布式AGI").map((item) => item.code)).toContain("NONEXISTENT_PRODUCT");
    expect(validateNomosContent("Human API将改变企业").map((item) => item.code)).toContain("STRATEGIC_VIEW_UNATTRIBUTED");
    expect(validateNomosContent("我们认为Human API值得长期探索")).toHaveLength(0);
  });

  it("requires approved, low-risk, evidenced and measurable anonymous cases", () => {
    const now = new Date().toISOString();
    const base: CaseEvidenceCard = {
      id: "case_test001",
      organizationId: common.organizationId,
      createdBy: common.createdBy,
      traceId: common.traceId,
      createdAt: now,
      updatedAt: now,
      status: "APPROVED",
      caseAlias: "某马来西亚五金企业",
      countryOrRegion: "马来西亚",
      industry: "五金",
      anonymizationLevel: "APPROVED_ALIAS",
      metrics: [{ name: "处理时长", value: "20", unit: "%", evidenceRef: "evidence_case001" }],
      measurementPeriod: "2026-Q2",
      baseline: "上线前四周",
      measurementMethod: "同口径工单中位数比较",
      sourceRef: "SRC-NOMOS-202608-04",
      publicUseStatus: "APPROVED",
      reidentificationRisk: "LOW",
      approvedBy: common.createdBy,
    };
    expect(validateCaseEvidence(base)).toHaveLength(0);
    expect(validateCaseEvidence({ ...base, reidentificationRisk: "HIGH" }).map((item) => item.code)).toContain("CASE_REIDENTIFICATION_RISK");
  });

  it("routes issues to specialized agents and stops duplicate or over-budget loops", () => {
    const issue = {
      issueId: "issue_geo001",
      severity: "P1" as const,
      module: "geo" as const,
      routeTo: "agt-004" as const,
      location: "section-1",
      originalText: "",
      problem: "GEO gap",
      evidence: [],
      suggestion: "add answer block",
      autoFixable: false,
      blocksVariantGeneration: true,
    };
    expect(routeReviewIssue(issue)).toBe("xiaodiandian");
    const guard = new LoopBudgetGuard();
    const run = { loop: "geo_seo" as const, issueFingerprint: "a".repeat(64), contentHash: "b".repeat(64) };
    guard.assertMayExecute(run);
    expect(() => guard.assertMayExecute(run)).toThrow("Identical issueFingerprint");
    guard.assertMayExecute({ ...run, issueFingerprint: "c".repeat(64) });
    expect(() => guard.assertMayExecute({ ...run, issueFingerprint: "d".repeat(64) })).toThrow("budget exhausted");
  });
});
