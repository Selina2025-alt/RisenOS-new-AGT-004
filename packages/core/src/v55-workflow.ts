import type { AgentId, AgentTask, ArtifactRef } from "@risen/content-contracts";

import { ConflictError } from "./errors.js";
import { createAgentTask, newTaskId } from "./agent-runtime.js";
import { sha256 } from "./utils.js";
import { AGT004_PROJECT_VERSION } from "./version.js";

export interface V55WorkflowContext {
  rootRunId: string;
  missionId: string;
  organizationId: string;
  traceId: string;
  createdBy: string;
  sourceArtifacts: ArtifactRef[];
  requiresPublicResearch: boolean;
  requiresEnterpriseKnowledge: boolean;
  deadline: string;
}

export interface V55WorkflowPlan {
  schemaVersion: "1.0.0";
  tasks: AgentTask[];
  humanGates: Array<"PERSPECTIVE_CONFIRMED" | "SOURCE_DRAFT_APPROVED" | "FINAL_VARIANTS_APPROVED">;
  maxAutomaticLoops: {
    makabakaPostDraft: 2;
    lilithRevision: 2;
    lilithXiaodiandian: 2;
    perChannelVariant: 1;
  };
}

function makeTask(input: {
  context: V55WorkflowContext;
  recipient: AgentId;
  taskType: string;
  outputSchema: string;
  dependencies: string[];
  inputArtifacts: ArtifactRef[];
  approvalRequirement?: AgentTask["approvalRequirement"];
}): AgentTask {
  const taskId = newTaskId();
  const fingerprint = sha256(JSON.stringify({
    missionId: input.context.missionId,
    recipient: input.recipient,
    taskType: input.taskType,
    inputHashes: input.inputArtifacts.map((item) => item.contentHash),
  }));
  return createAgentTask({
    taskId,
    rootRunId: input.context.rootRunId,
    missionId: input.context.missionId,
    organizationId: input.context.organizationId,
    createdBy: input.context.createdBy,
    traceId: input.context.traceId,
    senderAgentId: "agt-004",
    recipientAgentId: input.recipient,
    taskType: input.taskType,
    agentVersion: AGT004_PROJECT_VERSION,
    skillSnapshot: [],
    inputArtifactRefs: input.inputArtifacts,
    outputSchema: input.outputSchema,
    dependencyTaskIds: input.dependencies,
    priority: 50,
    maxAttempts: 2,
    deadline: input.context.deadline,
    idempotencyKey: `${input.context.missionId}:${input.taskType}:${fingerprint}`,
    approvalRequirement: input.approvalRequirement ?? "NONE",
  });
}

export function planV55SourceDraftWorkflow(context: V55WorkflowContext): V55WorkflowPlan {
  const tasks: AgentTask[] = [];
  let priorTaskIds: string[] = [];
  if (context.requiresPublicResearch) {
    const research = makeTask({
      context,
      recipient: "public-researcher",
      taskType: "PUBLIC_RESEARCH",
      outputSchema: "research_pack",
      dependencies: [],
      inputArtifacts: context.sourceArtifacts,
    });
    tasks.push(research);
    priorTaskIds = [research.taskId];
  }
  if (context.requiresEnterpriseKnowledge) {
    const knowledge = makeTask({
      context,
      recipient: "makabaka",
      taskType: "KNOWLEDGE_MATCH_PRE_DRAFT",
      outputSchema: "knowledge_snapshot_and_fusion_plan",
      dependencies: priorTaskIds,
      inputArtifacts: context.sourceArtifacts,
    });
    tasks.push(knowledge);
    priorTaskIds = [knowledge.taskId];
  }
  const drafting = makeTask({
    context,
    recipient: "content-orchestrator",
    taskType: "DRAFT_PROPOSAL",
    outputSchema: "draft_proposal",
    dependencies: priorTaskIds,
    inputArtifacts: context.sourceArtifacts,
  });
  tasks.push(drafting);

  return {
    schemaVersion: "1.0.0",
    tasks,
    humanGates: ["PERSPECTIVE_CONFIRMED", "SOURCE_DRAFT_APPROVED", "FINAL_VARIANTS_APPROVED"],
    maxAutomaticLoops: {
      makabakaPostDraft: 2,
      lilithRevision: 2,
      lilithXiaodiandian: 2,
      perChannelVariant: 1,
    },
  };
}

export function planV55PostDraftReviewWorkflow(input: {
  context: V55WorkflowContext;
  formalVersionArtifact: ArtifactRef;
  reviewEnvelopeArtifact: ArtifactRef;
}): AgentTask[] {
  if (input.formalVersionArtifact.createdByAgent !== "agt-004") {
    throw new ConflictError("FORMAL_VERSION_WRITER_INVALID", "Only 004 may supply the formal ContentVersion artifact");
  }
  const postDraft = makeTask({
    context: input.context,
    recipient: "makabaka",
    taskType: "KNOWLEDGE_MATCH_POST_DRAFT",
    outputSchema: "post_draft_check",
    dependencies: [],
    inputArtifacts: [input.formalVersionArtifact],
  });
  const review = makeTask({
    context: input.context,
    recipient: "lilith",
    taskType: "FULL_CONTENT_REVIEW",
    outputSchema: "review_report",
    dependencies: [postDraft.taskId],
    inputArtifacts: [input.reviewEnvelopeArtifact],
    approvalRequirement: "HUMAN",
  });
  return [postDraft, review];
}

export function planV55VariantTasks(input: {
  context: V55WorkflowContext;
  approvedSourceVersion: ArtifactRef;
  humanApproved: boolean;
  channels: Array<"wechat" | "short_video" | "xiaohongshu" | "x" | "linkedin" | "youtube" | "podcast">;
}): AgentTask[] {
  if (!input.humanApproved) {
    throw new ConflictError("SOURCE_DRAFT_APPROVAL_REQUIRED", "Balala cannot run before enterprise approval of the source version");
  }
  return input.channels.flatMap((channel) => {
    const variant = makeTask({
      context: input.context,
      recipient: "balala",
      taskType: `VARIANT_${channel.toUpperCase()}`,
      outputSchema: "variant_proposal",
      dependencies: [],
      inputArtifacts: [input.approvedSourceVersion],
    });
    const review = makeTask({
      context: input.context,
      recipient: "lilith",
      taskType: `LIGHT_VARIANT_REVIEW_${channel.toUpperCase()}`,
      outputSchema: "review_report",
      dependencies: [variant.taskId],
      inputArtifacts: [input.approvedSourceVersion],
      approvalRequirement: "HUMAN",
    });
    return [variant, review];
  });
}

export function planV56PackagingTasks(input: {
  context: V55WorkflowContext;
  packagingBriefArtifact: ArtifactRef;
  approvedSourceVersion: ArtifactRef;
  variantArtifacts: ArtifactRef[];
  variantReviewArtifacts: ArtifactRef[];
  researchMode?: "LOCAL_CORPUS" | "PUBLIC_PATTERN_PACK";
}): AgentTask[] {
  const sharedInputs = [
    input.packagingBriefArtifact,
    input.approvedSourceVersion,
    ...input.variantArtifacts,
    ...input.variantReviewArtifacts,
  ];
  const patternResearch = input.researchMode === "PUBLIC_PATTERN_PACK"
    ? makeTask({
      context: input.context,
      recipient: "public-researcher",
      taskType: "PUBLIC_TITLE_PATTERN_RESEARCH",
      outputSchema: "title_pattern_research_pack",
      dependencies: [],
      inputArtifacts: sharedInputs,
    })
    : undefined;
  const candidates = makeTask({
    context: input.context,
    recipient: "packaging-copy-agent",
    taskType: "PACKAGING_CANDIDATE_GENERATION",
    outputSchema: "title_candidate_pool",
    dependencies: patternResearch ? [patternResearch.taskId] : [],
    inputArtifacts: sharedInputs,
  });
  const selection = makeTask({
    context: input.context,
    recipient: "packaging-copy-agent",
    taskType: "PACKAGING_AUTO_SELECTION",
    outputSchema: "auto_packaging_selection",
    dependencies: [candidates.taskId],
    inputArtifacts: sharedInputs,
  });
  const review = makeTask({
    context: input.context,
    recipient: "lilith",
    taskType: "PACKAGING_REVIEW",
    outputSchema: "packaging_review_report",
    dependencies: [candidates.taskId, selection.taskId],
    inputArtifacts: sharedInputs,
  });
  return [...(patternResearch ? [patternResearch] : []), candidates, selection, review];
}

export function planV56PackagingOverrideReview(input: {
  context: V55WorkflowContext;
  packagingBriefArtifact: ArtifactRef;
  candidatePoolArtifact: ArtifactRef;
  effectiveSelectionArtifact: ArtifactRef;
  overrideArtifact: ArtifactRef;
  approvedSourceVersion: ArtifactRef;
  variantArtifacts: ArtifactRef[];
}): AgentTask {
  return makeTask({
    context: input.context,
    recipient: "lilith",
    taskType: "PACKAGING_OVERRIDE_REVIEW",
    outputSchema: "packaging_review_report",
    dependencies: [],
    inputArtifacts: [
      input.packagingBriefArtifact,
      input.candidatePoolArtifact,
      input.effectiveSelectionArtifact,
      input.overrideArtifact,
      input.approvedSourceVersion,
      ...input.variantArtifacts,
    ],
  });
}

export function planV55IssueRoutingTasks(input: {
  context: V55WorkflowContext;
  reviewArtifact: ArtifactRef;
  routes: Array<"public-researcher" | "makabaka" | "content-orchestrator" | "xiaodiandian">;
  geoSeoRequestArtifact?: ArtifactRef;
}): AgentTask[] {
  return [...new Set(input.routes)].map((route) => {
    const mapping = {
      "public-researcher": { taskType: "PUBLIC_RESEARCH_REMEDIATION", outputSchema: "research_pack" },
      "makabaka": { taskType: "KNOWLEDGE_REMEDIATION", outputSchema: "knowledge_snapshot_and_fusion_plan" },
      "content-orchestrator": { taskType: "REVISION_PROPOSAL", outputSchema: "draft_proposal" },
      "xiaodiandian": { taskType: "GEO_SEO_OPTIMIZATION", outputSchema: "geo_seo_proposal" },
    } as const;
    const definition = mapping[route];
    const inputs = route === "xiaodiandian" && input.geoSeoRequestArtifact
      ? [input.reviewArtifact, input.geoSeoRequestArtifact]
      : [input.reviewArtifact];
    return makeTask({
      context: input.context,
      recipient: route,
      taskType: definition.taskType,
      outputSchema: definition.outputSchema,
      dependencies: [],
      inputArtifacts: inputs,
    });
  });
}
