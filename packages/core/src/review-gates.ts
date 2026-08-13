export type ReviewGateStatus = "PASS" | "INFO" | "WARN" | "REVISION_REQUIRED" | "BLOCKED";

export interface ReviewGateIssue {
  code: string;
  module: "ai_style" | "logic" | "enterprise_fusion";
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

const connectorPattern = /\b(因此|所以|同时|此外|进一步|换句话说|总的来说|显然|这意味着|in addition|therefore|more importantly)\b/gi;
const abstractPattern = /(赋能|重塑|引领|全面升级|构建新范式|实现闭环|生态协同|strategic transformation)/gi;
const boundaryPattern = /(边界|条件|风险|责任|确认|取决于|不能|不应|需要|建议|先问|如果|何时|撤销|阻断|复盘|还原)/;
const enterpriseBridgePattern = /(企业|组织|业务|管理者|治理|运行|落地|这也是|这对|因此|所以|意味着|对应|场景)/;

function paragraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
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

