import {
  AutoPackagingSelectionSchema,
  PackagingBriefSchema,
  PackagingOverrideInputSchema,
  TitleCandidatePoolSchema,
  type AutoPackagingSelection,
  type PackagingBrief,
  type PackagingChannel,
  type PackagingOverrideInput,
  type PackagingReviewReport,
  type TitleCandidate,
  type TitleCandidatePool,
} from "@risen/content-contracts";

import { ConflictError } from "./errors.js";
import { sha256 } from "./utils.js";

export const PACKAGING_CHANNELS: PackagingChannel[] = [
  "wechat",
  "short_video",
  "xiaohongshu",
  "x",
  "linkedin",
  "youtube",
  "podcast",
];

export const XHS_HOWTO_TAGS = new Set([
  "#AI搞学习howto",
  "#AI搞事业howto",
  "#AI反常识howto",
  "#AI进化升华howto",
  "#howto用好AI",
]);

const forbiddenBrandSpellings = ["JovaIAI", "JOVAIAI", "Jova Ai Nomos"];
const unsupportedAbsolutePatterns = [
  /(?:全网|全球|行业)第[一1]/u,
  /(?:保证|必然|一定能|百分之百|100%)(?:实现|提升|降低|解决)?/u,
  /(?:提升|降低|增长|减少)\s*\d+(?:\.\d+)?%/u,
  /\d+(?:\.\d+)?\s*倍/u,
];

export interface PackagingValidationIssue {
  code: string;
  severity: "P0" | "P1" | "P2" | "P3";
  message: string;
  candidateId?: string;
  channel?: PackagingChannel;
}

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

function bigrams(text: string): Set<string> {
  const value = normalized(text);
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

export function titleSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function deduplicateCandidates(candidates: TitleCandidate[], threshold = 0.82): TitleCandidate[] {
  const accepted: TitleCandidate[] = [];
  for (const candidate of candidates) {
    if (!accepted.some((existing) => titleSimilarity(existing.text, candidate.text) >= threshold)) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

export function normalizeTags(tags: string[]): string[] {
  const expanded = tags.flatMap((raw) => {
    const value = raw.trim();
    if (!value) return [];
    const matches = value.match(/#[^#\s]+/gu);
    return matches?.length ? matches : [`#${value.replace(/^#+/u, "")}`];
  });
  const output = new Map<string, string>();
  for (const tag of expanded) {
    const canonical = tag.replace(/\s+/gu, "");
    const key = canonical.toLocaleLowerCase("en-US");
    if (!output.has(key)) output.set(key, canonical);
  }
  return [...output.values()];
}

function candidateIssues(candidate: TitleCandidate, brief: PackagingBrief): PackagingValidationIssue[] {
  const issues: PackagingValidationIssue[] = [];
  for (const spelling of forbiddenBrandSpellings) {
    if (candidate.text.includes(spelling)) {
      issues.push({ code: "BRAND_SPELLING_INVALID", severity: "P0", message: `${spelling} is forbidden`, candidateId: candidate.candidateId });
    }
  }
  if (brief.forbiddenExpressions.some((term) => term && candidate.text.includes(term))) {
    issues.push({ code: "FORBIDDEN_EXPRESSION", severity: "P0", message: "Title contains a forbidden expression", candidateId: candidate.candidateId });
  }
  if (unsupportedAbsolutePatterns.some((pattern) => pattern.test(candidate.text)) && !candidate.supportingClaimIds.length) {
    issues.push({ code: "UNSUPPORTED_NUMBER_OR_PROMISE", severity: "P1", message: "Numeric or absolute promise has no supporting Claim", candidateId: candidate.candidateId });
  }
  if (!candidate.supportingSectionRefs.length) {
    issues.push({ code: "OPENING_PAYOFF_UNVERIFIED", severity: "P1", message: "Title has no source section reference", candidateId: candidate.candidateId });
  }
  return issues;
}

export function validateCandidatePool(poolInput: unknown, briefInput: unknown): {
  pool: TitleCandidatePool;
  issues: PackagingValidationIssue[];
} {
  const brief = PackagingBriefSchema.parse(briefInput);
  const pool = TitleCandidatePoolSchema.parse(poolInput);
  const issues = pool.candidates.flatMap((candidate) => candidateIssues(candidate, brief));
  if (pool.packagingRequestId !== brief.packagingRequestId || pool.sourceContentHash !== brief.sourceContentHash) {
    issues.push({ code: "CANDIDATE_POOL_SOURCE_MISMATCH", severity: "P1", message: "Candidate pool does not bind the PackagingBrief source" });
  }
  if (pool.candidates.length !== brief.candidateCount) {
    issues.push({ code: "CANDIDATE_COUNT_MISMATCH", severity: "P1", message: `Expected ${brief.candidateCount}, received ${pool.candidates.length}` });
  }
  const deduplicated = deduplicateCandidates(pool.candidates);
  if (deduplicated.length !== pool.candidates.length) {
    issues.push({ code: "NEAR_DUPLICATE_CANDIDATES", severity: "P1", message: "Candidate pool contains near-duplicates" });
  }
  const mechanismCounts = new Map<string, number>();
  for (const candidate of pool.candidates) {
    mechanismCounts.set(candidate.mechanism, (mechanismCounts.get(candidate.mechanism) ?? 0) + 1);
  }
  const maxPerMechanism = Math.floor(pool.candidates.length * 0.25);
  for (const [mechanism, count] of mechanismCounts) {
    if (count > maxPerMechanism) {
      issues.push({ code: "MECHANISM_DOMINANCE", severity: "P1", message: `${mechanism} occupies ${count}/${pool.candidates.length}` });
    }
  }
  if (pool.candidates.some((candidate) => candidate.hardGateStatus !== "PASS")) {
    issues.push({ code: "REJECTED_CANDIDATE_IN_VALID_POOL", severity: "P1", message: "Rejected candidates must not remain in the valid pool" });
  }
  return { pool, issues };
}

export function validateSelection(selectionInput: unknown, briefInput: unknown, poolInput: unknown): {
  selection: AutoPackagingSelection;
  issues: PackagingValidationIssue[];
} {
  const brief = PackagingBriefSchema.parse(briefInput);
  const pool = TitleCandidatePoolSchema.parse(poolInput);
  const selection = AutoPackagingSelectionSchema.parse(selectionInput);
  const issues: PackagingValidationIssue[] = [];
  const candidates = new Map(pool.candidates.map((candidate) => [candidate.candidateId, candidate]));
  if (
    selection.packagingRequestId !== brief.packagingRequestId ||
    selection.sourceContentHash !== brief.sourceContentHash ||
    selection.candidatePoolHash !== pool.contentHash
  ) {
    issues.push({ code: "SELECTION_SOURCE_MISMATCH", severity: "P1", message: "Selection does not bind the current brief, source and candidate pool" });
  }
  const channels = new Set(selection.channelSelections.map((item) => item.channel));
  for (const channel of brief.channels) {
    if (!channels.has(channel)) issues.push({ code: "CHANNEL_SELECTION_MISSING", severity: "P1", message: `Missing ${channel}`, channel });
  }
  for (const item of selection.channelSelections) {
    const candidate = candidates.get(item.selectedCandidateId);
    if (!candidate) issues.push({ code: "CANDIDATE_REFERENCE_INVALID", severity: "P1", message: "Selected candidate is not in pool", channel: item.channel });
    if (forbiddenBrandSpellings.some((spelling) => [item.primaryTitle, item.coverMainText, item.coverSubText, ...item.videoTopLines].filter(Boolean).some((text) => text!.includes(spelling)))) {
      issues.push({ code: "BRAND_SPELLING_INVALID", severity: "P0", message: "Packaging contains an invalid JovaAI spelling", channel: item.channel });
    }
    if (item.coverMainText && normalized(item.coverMainText) === normalized(item.primaryTitle)) {
      issues.push({ code: "COVER_DUPLICATES_TITLE", severity: "P1", message: "Cover text mechanically copies the full title", channel: item.channel });
    }
    if (item.channel === "podcast" && item.videoTopLines.length) {
      issues.push({ code: "PODCAST_VIDEO_OVERLAY_FORBIDDEN", severity: "P1", message: "Podcast must not have video overlay lines", channel: item.channel });
    }
    if (["x", "linkedin", "podcast"].includes(item.channel) && !item.notApplicableFields.includes("videoTopLines")) {
      issues.push({ code: "NOT_APPLICABLE_FIELD_MISSING", severity: "P2", message: "Non-video channel should declare videoTopLines not applicable", channel: item.channel });
    }
    const tags = normalizeTags(item.tags);
    if (tags.length !== item.tags.length || tags.some((tag, index) => tag !== item.tags[index])) {
      issues.push({ code: "TAG_NORMALIZATION_REQUIRED", severity: "P1", message: "Tags contain duplicates, adhesion or non-canonical separators", channel: item.channel });
    }
    if (brief.accountProfile === "JOVAAI_OFFICIAL" && !tags.some((tag) => tag.toLowerCase() === "#jovaai")) {
      issues.push({ code: "JOVAAI_TAG_REQUIRED", severity: "P1", message: "JovaAI official account requires #JovaAI", channel: item.channel });
    }
    if (item.channel === "xiaohongshu") {
      const count = tags.filter((tag) => XHS_HOWTO_TAGS.has(tag)).length;
      if (count < 1 || count > 2) issues.push({ code: "XHS_HOWTO_TAG_COUNT", severity: "P1", message: "Xiaohongshu requires 1–2 relevant howto tags", channel: item.channel });
    }
    const calculated = Object.entries(item.scoreBreakdown)
      .filter(([key]) => key !== "total")
      .reduce((sum, [, value]) => sum + value, 0);
    if (Math.abs(calculated - item.scoreBreakdown.total) > 0.001) {
      issues.push({ code: "SCORE_TOTAL_INVALID", severity: "P1", message: "Score total does not match its breakdown", channel: item.channel });
    }
  }
  const mechanisms = selection.shortlistedCandidates
    .map((id) => candidates.get(id)?.mechanism)
    .filter((value): value is TitleCandidate["mechanism"] => Boolean(value));
  for (const mechanism of new Set(mechanisms)) {
    if (mechanisms.filter((value) => value === mechanism).length > 2) {
      issues.push({ code: "SHORTLIST_MECHANISM_DOMINANCE", severity: "P1", message: `${mechanism} appears more than twice in shortlist` });
    }
  }
  return { selection, issues };
}

export function assertPackagingOverrideSafe(input: unknown): PackagingOverrideInput {
  const value = PackagingOverrideInputSchema.parse(input);
  const strings = Object.values(value.channelOverrides).flatMap((item) => [
    item.primaryTitle,
    item.coverMainText,
    item.coverSubText,
    ...(item.videoTopLines ?? []),
  ]).filter((item): item is string => Boolean(item));
  if (strings.some((text) => forbiddenBrandSpellings.some((spelling) => text.includes(spelling)))) {
    throw new ConflictError("PACKAGING_OVERRIDE_BRAND_INVALID", "Packaging override contains an invalid brand spelling");
  }
  if (strings.some((text) => unsupportedAbsolutePatterns.some((pattern) => pattern.test(text)))) {
    throw new ConflictError("PACKAGING_OVERRIDE_CLAIM_UNSUPPORTED", "Packaging override adds an unsupported numeric or absolute promise");
  }
  return value;
}

export function hashPackagingPayload(payload: object): string {
  const copy = { ...payload } as Record<string, unknown>;
  delete copy.contentHash;
  return sha256(JSON.stringify(copy));
}

export function renderPackagingReviewBook(input: {
  pool?: TitleCandidatePool;
  selection?: AutoPackagingSelection;
  review?: PackagingReviewReport;
  effectiveOverride?: { overrideId: string; reason: string; channelOverrides: Record<string, unknown> };
}): string {
  const lines = ["# 闪闪内容包装人工审阅书", ""];
  if (input.pool) {
    lines.push(`候选池：${input.pool.poolId}（${input.pool.candidates.length} 个有效候选）`, "", "## 完整候选池", "");
    input.pool.candidates.forEach((candidate, index) => {
      lines.push(`${index + 1}. ${candidate.text}  \n   - ID：${candidate.candidateId}；机制：${candidate.mechanism}；风险：${candidate.riskWarnings.join("；") || "无"}`);
    });
    lines.push("");
  }
  if (input.selection) {
    lines.push("## 自动入围", "", input.selection.shortlistedCandidates.map((id, index) => `${index + 1}. ${id}`).join("\n"), "", "## 七渠道默认方案", "");
    for (const item of input.selection.channelSelections) {
      lines.push(
        `### ${item.channel}`,
        "",
        `- 默认：${item.primaryTitle}`,
        `- 备选：${item.alternativeTitles.join(" / ")}`,
        `- 封面：${[item.coverMainText, item.coverSubText].filter(Boolean).join("｜") || "不适用"}`,
        `- 视频上方文字：${item.videoTopLines.join("｜") || "不适用"}`,
        `- 标签：${item.tags.join(" ") || "无"}`,
        `- 选择理由：${item.selectionRationale}`,
        `- 得分：${item.scoreBreakdown.total}/100；置信度：${item.scoreConfidence}`,
        "",
      );
    }
  }
  if (input.review) {
    lines.push(
      "## 莉莉丝包装审核",
      "",
      `- 结论：${input.review.reviewStatus}`,
      `- P0/P1/P2/P3：${input.review.p0Count}/${input.review.p1Count}/${input.review.p2Count}/${input.review.p3Count}`,
      `- 总结：${input.review.overallConclusion}`,
      "",
    );
  }
  if (input.effectiveOverride) {
    lines.push("## 当前有效人工覆盖", "", `- Override：${input.effectiveOverride.overrideId}`, `- 原因：${input.effectiveOverride.reason}`, "");
  }
  lines.push(
    "## 使用说明",
    "",
    "闪闪已经自动选出默认方案，不存在独立标题人工闸门。企业方可在最终变体总闸门前覆盖或反馈；覆盖会新增不可变 Artifact，不会删除自动选择。",
    "",
  );
  return `${lines.join("\n")}\n`;
}
