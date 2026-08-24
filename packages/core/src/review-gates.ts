export type ReviewGateStatus = "PASS" | "INFO" | "WARN" | "REVISION_REQUIRED" | "BLOCKED";

export interface ReviewGateIssue {
  code: string;
  module: "ai_style" | "repetition" | "narrative_quality" | "logic" | "enterprise_fusion";
  location: string;
  problem: string;
  suggestion: string;
  blocking: boolean;
}

export interface AiStyleReview {
  status: ReviewGateStatus;
  signalFamilies: string[];
  issues: ReviewGateIssue[];
  excludedTypes: string[];
  humanizationGoal: "specificity_readability_and_human_voice";
}

export interface LogicReview {
  status: ReviewGateStatus;
  path: string[];
  issues: ReviewGateIssue[];
  enterpriseInsertion: { level: "L0" | "L1" | "L2" | "L3" | "L4"; deletionTest: string };
}

export interface RepetitionReview {
  status: ReviewGateStatus;
  repeatedMotifs: Array<{ motif: string; paragraphIndexes: number[] }>;
  similarParagraphPairs: Array<{ first: number; second: number; similarity: number }>;
  issues: ReviewGateIssue[];
  rule: "keep_first_earned_point_remove_paraphrase_without_new_value";
}

export interface NarrativeQualityReview {
  status: ReviewGateStatus;
  sceneParagraphIndexes: number[];
  longestSceneGap: number;
  issues: ReviewGateIssue[];
  fabricatedExperienceAllowed: false;
}

const connectorPattern = /\b(因此|所以|同时|此外|进一步|换句话说|总的来说|显然|这意味着|in addition|therefore|more importantly)\b/gi;
const abstractPattern = /(赋能|重塑|引领|全面升级|构建新范式|实现闭环|生态协同|strategic transformation)/gi;
const boundaryPattern = /(边界|条件|风险|责任|确认|取决于|不能|不应|需要|建议|先问|如果|何时|撤销|阻断|复盘|还原)/;
const enterpriseBridgePattern = /(企业|组织|业务|管理者|治理|运行|落地|这也是|这对|因此|所以|意味着|对应|场景)/;

const repetitionMotifs: Array<{ motif: string; pattern: RegExp }> = [
  { motif: "authority_boundary_responsibility", pattern: /(权限|边界|责任|谁负责|谁有权|最终决定权)/g },
  { motif: "traceability", pattern: /(追溯|复盘|完整记录|留下.{0,6}证据|找到原因)/g },
  { motif: "capability_to_business", pattern: /(能力片段|业务可用|生产能力|真实业务|持续.{0,4}(运行|做成))/g },
  { motif: "human_handoff", pattern: /(交还给人|人工.{0,6}(判断|确认)|必须停下来|升级确认)/g },
];

const scenePattern = /(一次|一场|同一个|比如|业务现场|任务中|那一刻)/;

function normalizeForSimilarity(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

function bigrams(value: string): Set<string> {
  const normalized = normalizeForSimilarity(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function paragraphs(text: string): string[] {
  return text.split(/(?:\r?\n[\t ]*){2,}/).map((part) => part.trim()).filter(Boolean);
}

function issue(code: string, module: ReviewGateIssue["module"], problem: string, suggestion: string, location: string, blocking = false): ReviewGateIssue {
  return { code, module, problem, suggestion, location, blocking };
}

export function reviewAiStyle(text: string, contentType?: string): AiStyleReview {
  const excluded = ["public_statement", "policy", "quote"];
  if (contentType && excluded.includes(contentType)) {
    return { status: "INFO", signalFamilies: [], issues: [], excludedTypes: [contentType], humanizationGoal: "specificity_readability_and_human_voice" };
  }
  const prose = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[C-[A-Z0-9-]+\]/g, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
  const parts = paragraphs(prose);
  const narrativeParts = parts.filter((part) => !part.includes("\n") && !/^[\p{L}\p{N} ]{1,16}[：:]/u.test(part));
  const connectors = (prose.match(connectorPattern) ?? []).length;
  const dashes = (prose.match(/[—–]/g) ?? []).length;
  const contrast = (prose.match(/不是[^。！？]{0,30}而是/g) ?? []).length;
  const tricolons = narrativeParts.filter((part) => part.length >= 60 && (part.match(/[，、,]/g) ?? []).length >= 4 && /(、|，).+(、|，).+[。！？]/.test(part)).length;
  const abstractCount = (prose.match(abstractPattern) ?? []).length;
  const lengths = parts.map((part) => part.length);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length : 0;
  const families: string[] = [];
  if (connectors >= Math.max(4, parts.length)) families.push("connector_density");
  if (dashes >= 5) families.push("dash_density");
  if (contrast >= 2) families.push("contrast_template");
  if (tricolons >= 2) families.push("parallelism");
  if (abstractCount >= 3) families.push("abstract_markers");
  if (mean > 0 && Math.sqrt(variance) / mean < 0.18 && parts.length >= 4) families.push("uniform_sentence_rhythm");
  const issues = families.length >= 2
    ? [issue("AI_STYLE_CLUSTER", "ai_style", `检测到 ${families.join(", ")}，表达节奏可能过度模板化。`, "补充具体场景和作者判断，拆分过整齐的句子，删去重复连接词。", "全文", families.length >= 3)]
    : [];
  return {
    status: families.length >= 3 ? "REVISION_REQUIRED" : families.length >= 2 ? "WARN" : "PASS",
    signalFamilies: families,
    issues,
    excludedTypes: [],
    humanizationGoal: "specificity_readability_and_human_voice",
  };
}

export function reviewLogic(text: string, enterpriseTerms: string[] = []): LogicReview {
  const parts = paragraphs(text);
  const issues: ReviewGateIssue[] = [];
  const path = ["event", "fact", "explanation", "enterprise_problem", "method_or_product", "boundary"];
  const hasEnterprise = enterpriseTerms.some((term) => text.includes(term));
  const firstEnterpriseParagraph = parts.findIndex((part) => enterpriseTerms.some((term) => part.includes(term)));
  if (hasEnterprise && firstEnterpriseParagraph >= 0 && firstEnterpriseParagraph > 0) {
    const previousContext = parts.slice(Math.max(0, firstEnterpriseParagraph - 2), firstEnterpriseParagraph).join("\n");
    if (previousContext.length < 40 || !enterpriseBridgePattern.test(previousContext)) {
      issues.push(issue("FORCED_ENTERPRISE_INSERTION", "enterprise_fusion", "企业或产品信息出现前缺少问题承接。", "先说明外部事件对企业的具体影响，再引出对应能力或产品。", `paragraph-${firstEnterpriseParagraph + 1}`));
    }
  }
  const closingContext = parts.slice(-3).join("\n");
  if (parts.length >= 3 && !boundaryPattern.test(closingContext)) {
    issues.push(issue("LOGIC_BOUNDARY_MISSING", "logic", "结尾没有明确适用边界或行动判断。", "补充适用条件、风险边界或读者下一步判断。", "结尾"));
  }
  return {
    status: issues.some((item) => item.blocking) ? "BLOCKED" : issues.length ? "REVISION_REQUIRED" : "PASS",
    path,
    issues,
    enterpriseInsertion: { level: hasEnterprise ? "L2" : "L0", deletionTest: hasEnterprise ? "保留后仍需服务主题，否则降低植入级别" : "不适用" },
  };
}

export function reviewRepetition(text: string): RepetitionReview {
  const parts = paragraphs(text).filter((part) => !/^#{1,6}\s/.test(part) && !/^\s*[-*]\s+/.test(part));
  const repeatedMotifs = repetitionMotifs
    .map(({ motif, pattern }) => ({
      motif,
      paragraphIndexes: parts
        .map((part, index) => ({ index: index + 1, count: (part.match(pattern) ?? []).length }))
        .filter((item) => item.count > 0)
        .map((item) => item.index),
    }))
    .filter((item) => item.paragraphIndexes.length >= 4);
  const similarParagraphPairs: Array<{ first: number; second: number; similarity: number }> = [];
  const grams = parts.map(bigrams);
  for (let first = 0; first < parts.length; first += 1) {
    if (normalizeForSimilarity(parts[first] ?? "").length < 45) continue;
    for (let second = first + 2; second < parts.length; second += 1) {
      if (normalizeForSimilarity(parts[second] ?? "").length < 45) continue;
      const similarity = jaccard(grams[first] ?? new Set(), grams[second] ?? new Set());
      if (similarity >= 0.46) similarParagraphPairs.push({ first: first + 1, second: second + 1, similarity: Number(similarity.toFixed(3)) });
    }
  }
  const issues: ReviewGateIssue[] = [];
  for (const item of repeatedMotifs) {
    issues.push(issue(
      `REPEATED_MOTIF_${item.motif.toUpperCase()}`,
      "repetition",
      `“${item.motif}”在第 ${item.paragraphIndexes.join("、")} 段反复出现，需检查后文是否只是换词复述。`,
      "保留第一次把观点讲透的段落；后文只有在新增事实、机制、场景、决策或边界时才保留，否则删除或并入首次出现处。",
      `paragraphs-${item.paragraphIndexes.join("-")}`,
    ));
  }
  for (const pair of similarParagraphPairs) {
    issues.push(issue(
      "PARAPHRASE_PAIR",
      "repetition",
      `第 ${pair.first} 与第 ${pair.second} 段语义词组高度重合（${pair.similarity}）。`,
      `以第 ${pair.first} 段为主，检查第 ${pair.second} 段是否提供新信息；无新增价值则删除。`,
      `paragraph-${pair.first},paragraph-${pair.second}`,
      pair.similarity >= 0.62,
    ));
  }
  const blocking = issues.some((item) => item.blocking);
  return {
    status: blocking ? "REVISION_REQUIRED" : issues.length ? "WARN" : "PASS",
    repeatedMotifs,
    similarParagraphPairs,
    issues,
    rule: "keep_first_earned_point_remove_paraphrase_without_new_value",
  };
}

export function reviewNarrativeQuality(text: string, contentType = "long_article"): NarrativeQualityReview {
  const parts = paragraphs(text).filter((part) => !/^#{1,6}\s/.test(part) && !/^\s*[-*]\s+/.test(part));
  const sceneParagraphIndexes = parts
    .map((part, index) => ({ part, index: index + 1 }))
    .filter(({ part }) => scenePattern.test(part) && /(企业|业务|任务|智能体|AI|客户|系统|现场)/i.test(part))
    .map(({ index }) => index);
  const anchors = [0, ...sceneParagraphIndexes, parts.length + 1];
  const longestSceneGap = anchors.slice(1).reduce((max, value, index) => Math.max(max, value - (anchors[index] ?? 0) - 1), 0);
  const issues: ReviewGateIssue[] = [];
  const isLongForm = ["long_article", "wechat_article", "article"].includes(contentType);
  if (isLongForm && parts.length >= 10 && sceneParagraphIndexes.length < 2) {
    issues.push(issue(
      "NARRATIVE_SCENE_THIN",
      "narrative_quality",
      "长文只有开头判断，缺少能推动论证的具体业务场景。",
      "在关键机制转折处补一个可验证或明确标注为假设的业务片段，用人物动作、冲突和选择承载观点；不得伪造第一人称经历。",
      "全文",
      true,
    ));
  } else if (isLongForm && longestSceneGap >= 10) {
    issues.push(issue(
      "NARRATIVE_SCENE_GAP",
      "narrative_quality",
      `连续 ${longestSceneGap} 个正文段落没有具体场景推进，容易形成报告说明腔。`,
      "把其中一组抽象解释压缩为一段，并用前文同一任务继续推进：发生了什么、谁需要决定、结果为什么卡住、制度如何介入。",
      "中段",
    ));
  }
  return {
    status: issues.some((item) => item.blocking) ? "REVISION_REQUIRED" : issues.length ? "WARN" : "PASS",
    sceneParagraphIndexes,
    longestSceneGap,
    issues,
    fabricatedExperienceAllowed: false,
  };
}

