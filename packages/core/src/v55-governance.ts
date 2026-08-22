import {
  CaseEvidenceCardSchema,
  KnowledgeClaimCardSchema,
  KnowledgeSnapshotSchema,
  MissionPreflightSchema,
  PerspectiveContractSchema,
  type CaseEvidenceCard,
  type KnowledgeClaimCard,
  type KnowledgeConflict,
  type KnowledgeSnapshot,
  type MissionPreflight,
  type MissionPreflightInput,
  type PerspectiveContract,
  type PerspectiveContractInput,
  type ReviewIssueV53,
} from "@risen/content-contracts";

import { ConflictError } from "./errors.js";
import { newId, nowIso, sha256 } from "./utils.js";

export const V55_CANON_VERSION = "nomos-canon-20260820-v1.0.0";
export const V55_KNOWLEDGE_POLICY_VERSION = "knowledge-policy-v5.5.0";

export const NOMOS_HARD_RED_LINES: ReadonlyArray<{
  code: string;
  pattern: RegExp;
  reason: string;
}> = [
  { code: "NOMOS_SIXTH_LAYER", pattern: /Nomos.{0,12}(?:第六层|第\s*6\s*层)|(?:第六层|第\s*6\s*层).{0,12}Nomos/i, reason: "Nomos is inside JovaAI OS and is not a sixth layer" },
  { code: "NONEXISTENT_PRODUCT", pattern: /Wtree\s*Ultra/i, reason: "Wtree Ultra is not an approved product name" },
  { code: "AGI_ACHIEVEMENT", pattern: /Nomos.{0,30}(?:已实现|实现了|已经实现).{0,20}分布式\s*AGI/i, reason: "Distributed AGI is a strategic view, not an achieved product capability" },
  { code: "SOCIAL_CREDIT_MATURE", pattern: /(?:社会级|全社会).{0,12}信用体系.{0,20}(?:已上线|全面上线|已实现|成熟)/i, reason: "Social-scale credit is a research direction" },
  { code: "WORKFLOW_REPLACEMENT", pattern: /Nomos.{0,24}(?:替代|取代).{0,12}(?:所有|全部)?\s*(?:工作流|workflow)/i, reason: "Nomos must not be described as replacing every workflow" },
  { code: "DIGITIZE_INSTITUTIONS", pattern: /(?:把|将).{0,12}(?:企业)?制度(?:与规则)?数字化/i, reason: "Digitalization positioning is forbidden" },
  { code: "HUMAN_ABDICATION", pattern: /(?:客户|企业|你).{0,10}只(?:需要|负责).{0,12}(?:定目标|看结果)/i, reason: "Human authorization and final responsibility must remain explicit" },
  { code: "UNVERIFIED_260T", pattern: /260\s*万亿/i, reason: "The 260 trillion figure is not verified" },
];

const STRATEGIC_TERMS = ["Human API", "Institutional Intelligence Layer", "分布式AGI", "分布式 AGI"];
const STRATEGIC_ATTRIBUTION = /(?:我们认为|我们提出|战略判断|愿景|研究方向|可以理解为|试图探索|正在探索)/i;

export interface GovernanceIssue {
  code: string;
  severity: "P0" | "P1" | "P2";
  message: string;
  blocks: boolean;
}

export function createMissionPreflight(input: {
  missionId: string;
  organizationId: string;
  createdBy: string;
  traceId: string;
  value: MissionPreflightInput;
}): MissionPreflight {
  const now = nowIso();
  const value = input.value;
  const errors: string[] = [];
  if (value.enterpriseRelevance === "DIRECT" && !value.requiresEnterpriseKnowledge) {
    errors.push("DIRECT_ENTERPRISE_CONTENT_REQUIRES_KNOWLEDGE");
  }
  if (value.missionClass === "NOMOS_CONTENT" && (!value.requiresEnterpriseKnowledge || !value.requiresNomosPolicy)) {
    errors.push("NOMOS_CONTENT_REQUIRES_KNOWLEDGE_AND_POLICY");
  }
  if (value.missionClass === "CUSTOMER_CASE" && !value.requiresCasePolicy) {
    errors.push("CUSTOMER_CASE_REQUIRES_CASE_POLICY");
  }
  return MissionPreflightSchema.parse({
    id: newId("preflight"),
    missionId: input.missionId,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    traceId: input.traceId,
    createdAt: now,
    updatedAt: now,
    status: errors.length ? "BLOCKED" : "READY",
    ...value,
    ...(errors.length ? { errorCode: errors.join(",") } : {}),
  });
}

export function createPerspectiveContract(input: {
  missionId: string;
  organizationId: string;
  createdBy: string;
  traceId: string;
  value: PerspectiveContractInput;
}): PerspectiveContract {
  const now = nowIso();
  const canonical = JSON.stringify(input.value);
  return PerspectiveContractSchema.parse({
    id: newId("perspective"),
    missionId: input.missionId,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    traceId: input.traceId,
    createdAt: now,
    updatedAt: now,
    status: "CONFIRMED",
    ...input.value,
    contentHash: sha256(canonical),
  });
}

export function createKnowledgeSnapshot(input: {
  missionId: string;
  organizationId: string;
  createdBy: string;
  traceId: string;
  sourceHashes: string[];
  claimCards: KnowledgeClaimCard[];
  conflicts: KnowledgeConflict[];
  audienceLayer: KnowledgeSnapshot["audienceLayer"];
  publicationScope: KnowledgeSnapshot["publicationScope"];
  canonVersion?: string;
}): KnowledgeSnapshot {
  const cards = input.claimCards.map((card) => KnowledgeClaimCardSchema.parse(card));
  if (input.sourceHashes.length === 0) {
    throw new ConflictError("KNOWLEDGE_SOURCE_REQUIRED", "KnowledgeSnapshot requires at least one immutable source hash");
  }
  const openConflicts = input.conflicts.filter((conflict) => conflict.status === "OPEN");
  if (openConflicts.length) {
    throw new ConflictError("KNOWLEDGE_CONFLICT", `KnowledgeSnapshot has ${openConflicts.length} unresolved conflict(s)`);
  }
  const unusable = cards.filter((card) => card.status !== "ACTIVE" || ["PROHIBITED", "PENDING_CONFIRMATION", "PENDING_EXTERNAL_VERIFICATION"].includes(card.claimClass));
  if (unusable.length) {
    throw new ConflictError("KNOWLEDGE_CLAIM_NOT_ACTIVE", `KnowledgeSnapshot contains ${unusable.length} non-active/non-publishable claim(s)`);
  }
  const now = nowIso();
  const canonical = JSON.stringify({
    canonVersion: input.canonVersion ?? V55_CANON_VERSION,
    sourceHashes: [...input.sourceHashes].sort(),
    claimCardIds: cards.map((card) => card.claimId).sort(),
    audienceLayer: input.audienceLayer,
    publicationScope: input.publicationScope,
    policy: V55_KNOWLEDGE_POLICY_VERSION,
  });
  return KnowledgeSnapshotSchema.parse({
    id: newId("knowledge-snapshot"),
    snapshotId: newId("ks"),
    missionId: input.missionId,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    traceId: input.traceId,
    createdAt: now,
    updatedAt: now,
    status: "ACTIVE",
    canonVersion: input.canonVersion ?? V55_CANON_VERSION,
    sourceHashes: [...input.sourceHashes].sort(),
    claimCardIds: cards.map((card) => card.claimId),
    conflictIds: input.conflicts.map((conflict) => conflict.conflictId),
    audienceLayer: input.audienceLayer,
    publicationScope: input.publicationScope,
    knowledgePolicyVersion: V55_KNOWLEDGE_POLICY_VERSION,
    contentHash: sha256(canonical),
  });
}

export function assertDraftGate(input: {
  preflight: MissionPreflight;
  perspective?: PerspectiveContract;
  knowledgeSnapshot?: KnowledgeSnapshot;
}): void {
  if (input.preflight.status !== "READY") {
    throw new ConflictError("MISSION_PREFLIGHT_BLOCKED", input.preflight.errorCode ?? "Mission preflight is not ready");
  }
  if (!input.perspective || input.perspective.status !== "CONFIRMED") {
    throw new ConflictError("PERSPECTIVE_REQUIRED", "A confirmed PerspectiveContract is required before drafting");
  }
  if (input.perspective.missionId !== input.preflight.missionId) {
    throw new ConflictError("PERSPECTIVE_MISSION_MISMATCH", "PerspectiveContract belongs to another mission");
  }
  if (input.preflight.requiresEnterpriseKnowledge) {
    if (!input.knowledgeSnapshot || input.knowledgeSnapshot.status !== "ACTIVE") {
      throw new ConflictError("KNOWLEDGE_SNAPSHOT_REQUIRED", "Enterprise content requires an active KnowledgeSnapshot before drafting");
    }
    if (input.knowledgeSnapshot.missionId !== input.preflight.missionId) {
      throw new ConflictError("KNOWLEDGE_MISSION_MISMATCH", "KnowledgeSnapshot belongs to another mission");
    }
  }
}

export function assertKnowledgeSnapshotFresh(snapshot: KnowledgeSnapshot, activeSourceHashes: string[]): void {
  const expected = [...snapshot.sourceHashes].sort();
  const actual = [...activeSourceHashes].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new ConflictError("SOURCE_SNAPSHOT_STALE", "The task must be blocked and recreated against a new KnowledgeSnapshot");
  }
}

export function assertKnowledgeSnapshotSourcesActive(snapshot: KnowledgeSnapshot, activeSourceHashes: string[]): void {
  const active = new Set(activeSourceHashes);
  if (snapshot.sourceHashes.some((hash) => !active.has(hash))) {
    throw new ConflictError("SOURCE_SNAPSHOT_STALE", "The KnowledgeSnapshot references a source hash that is no longer active");
  }
}

export function validateNomosContent(text: string): GovernanceIssue[] {
  const issues: GovernanceIssue[] = NOMOS_HARD_RED_LINES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({ code: rule.code, severity: "P0" as const, message: rule.reason, blocks: true }));
  const hasStrategicTerm = STRATEGIC_TERMS.some((term) => text.includes(term));
  if (hasStrategicTerm && !STRATEGIC_ATTRIBUTION.test(text)) {
    issues.push({
      code: "STRATEGIC_VIEW_UNATTRIBUTED",
      severity: "P1",
      message: "Strategic terms must be explicitly framed as a view, vision or research direction",
      blocks: true,
    });
  }
  if (/Nomos/i.test(text) && /古希腊|νόμος|nomos.{0,12}(?:词源|原意)/i.test(text)) {
    issues.push({
      code: "GREEK_ORIGIN_REQUIRES_EXTERNAL_EVIDENCE",
      severity: "P1",
      message: "The Greek-language origin requires independent public evidence before use",
      blocks: true,
    });
  }
  return issues;
}

export function validateCaseEvidence(input: CaseEvidenceCard): GovernanceIssue[] {
  const card = CaseEvidenceCardSchema.parse(input);
  const issues: GovernanceIssue[] = [];
  if (card.status !== "APPROVED" || card.publicUseStatus !== "APPROVED" || !card.approvedBy) {
    issues.push({ code: "CASE_NOT_APPROVED", severity: "P0", message: "Case is not approved for public use", blocks: true });
  }
  if (card.reidentificationRisk !== "LOW") {
    issues.push({ code: "CASE_REIDENTIFICATION_RISK", severity: "P0", message: "Anonymous case has unacceptable reidentification risk", blocks: true });
  }
  if (!card.measurementPeriod.trim() || !card.baseline.trim() || !card.measurementMethod.trim()) {
    issues.push({ code: "CASE_METRIC_CONTEXT_MISSING", severity: "P0", message: "Metrics require period, baseline and method", blocks: true });
  }
  if (card.metrics.some((metric) => !metric.evidenceRef)) {
    issues.push({ code: "CASE_METRIC_EVIDENCE_MISSING", severity: "P0", message: "Every metric requires evidence", blocks: true });
  }
  return issues;
}

export function routeReviewIssue(issue: ReviewIssueV53): ReviewIssueV53["routeTo"] {
  if (issue.severity === "P0" || ["confidentiality", "customer_anonymization", "metric_evidence"].includes(issue.module)) return "human";
  if (["seo", "geo", "geo_insertion", "technical_geo"].includes(issue.module)) return "xiaodiandian";
  if (["knowledge_snapshot", "nomos_canon", "product_architecture", "enterprise_fusion"].includes(issue.module)) return "makabaka";
  if (issue.module === "evidence" || issue.module === "claim_status") return "public-researcher";
  if (issue.module === "channel_structure") return "balala";
  return "content-orchestrator";
}

export class LoopBudgetGuard {
  private readonly executions = new Set<string>();
  private readonly attempts = new Map<string, number>();

  assertMayExecute(input: { loop: "makabaka" | "lilith" | "geo_seo" | "variant"; issueFingerprint: string; contentHash: string; channel?: string }): void {
    const identity = `${input.loop}:${input.channel ?? "_"}:${input.issueFingerprint}:${input.contentHash}`;
    if (this.executions.has(identity)) {
      throw new ConflictError("DUPLICATE_ISSUE_EXECUTION", "Identical issueFingerprint + contentHash cannot execute twice");
    }
    const budgetKey = `${input.loop}:${input.channel ?? "_"}`;
    const used = this.attempts.get(budgetKey) ?? 0;
    const limit = input.loop === "variant" ? 1 : 2;
    if (used >= limit) {
      throw new ConflictError("WAITING_HUMAN", `Automatic ${input.loop} loop budget exhausted`);
    }
    this.executions.add(identity);
    this.attempts.set(budgetKey, used + 1);
  }
}
