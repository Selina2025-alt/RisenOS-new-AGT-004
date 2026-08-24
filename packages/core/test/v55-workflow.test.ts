import { describe, expect, it } from "vitest";
import type { ArtifactRef } from "@risen/content-contracts";
import { planV55PostDraftReviewWorkflow, planV55SourceDraftWorkflow, planV55VariantTasks, planV56PackagingTasks } from "../src/index.js";

const source: ArtifactRef = {
  artifactId: "artifact_source001",
  artifactType: "mission_context",
  schemaVersion: "1.0.0",
  contentHash: "a".repeat(64),
  uri: "local://mission/context",
  mimeType: "application/json",
  rights: "internal",
  createdByAgent: "agt-004",
  sourceRefs: [],
  parentArtifactIds: [],
  status: "READY",
};

const context = {
  rootRunId: "run_v55_workflow",
  missionId: "mission_v55_workflow",
  organizationId: "org_jovaai",
  traceId: "trace_v55_workflow",
  createdBy: "user_enterprise",
  sourceArtifacts: [source],
  requiresPublicResearch: true,
  requiresEnterpriseKnowledge: true,
  deadline: new Date(Date.now() + 60_000).toISOString(),
};

describe("V5.5 workflow planner", () => {
  it("builds research → knowledge → draft, then requires 004 to create the formal version before post-check", () => {
    const plan = planV55SourceDraftWorkflow(context);
    expect(plan.tasks.map((task) => task.recipientAgentId)).toEqual([
      "public-researcher",
      "makabaka",
      "content-orchestrator",
    ]);
    expect(plan.tasks[1]!.dependencyTaskIds).toEqual([plan.tasks[0]!.taskId]);
    expect(plan.tasks[2]!.dependencyTaskIds).toEqual([plan.tasks[1]!.taskId]);
    const postDraft = planV55PostDraftReviewWorkflow({
      context,
      formalVersionArtifact: { ...source, artifactId: "artifact_version001", createdByAgent: "agt-004" },
      reviewEnvelopeArtifact: { ...source, artifactId: "artifact_review001" },
    });
    expect(postDraft.map((task) => task.recipientAgentId)).toEqual(["makabaka", "lilith"]);
    expect(postDraft[1]!.dependencyTaskIds).toEqual([postDraft[0]!.taskId]);
    expect(postDraft[1]!.approvalRequirement).toBe("HUMAN");
    expect(() => planV55PostDraftReviewWorkflow({
      context,
      formalVersionArtifact: { ...source, artifactId: "artifact_bad001", createdByAgent: "content-orchestrator" },
      reviewEnvelopeArtifact: source,
    })).toThrow("Only 004");
  });

  it("blocks Balala before source approval and pairs each variant with a Lilith light review", () => {
    expect(() => planV55VariantTasks({ context, approvedSourceVersion: source, humanApproved: false, channels: ["wechat"] })).toThrow("enterprise approval");
    const tasks = planV55VariantTasks({
      context,
      approvedSourceVersion: source,
      humanApproved: true,
      channels: ["wechat", "short_video", "xiaohongshu", "x", "linkedin", "youtube", "podcast"],
    });
    expect(tasks).toHaveLength(14);
    expect(tasks.filter((task) => task.recipientAgentId === "balala")).toHaveLength(7);
    expect(tasks.filter((task) => task.recipientAgentId === "lilith")).toHaveLength(7);
    expect(tasks.every((task) => task.agentVersion === "5.6.0")).toBe(true);
    for (let index = 0; index < tasks.length; index += 2) {
      expect(tasks[index + 1]!.dependencyTaskIds).toEqual([tasks[index]!.taskId]);
    }
  });

  it("runs Shanshan generation and selection as isolated tasks before Lilith packaging review", () => {
    const packagingBrief = { ...source, artifactId: "artifact_packaging_brief", artifactType: "packaging_brief" };
    const variant = { ...source, artifactId: "artifact_variant001", artifactType: "variant_proposal", createdByAgent: "balala" as const };
    const variantReview = { ...source, artifactId: "artifact_variant_review001", artifactType: "variant_review_report", createdByAgent: "lilith" as const };
    const tasks = planV56PackagingTasks({
      context,
      packagingBriefArtifact: packagingBrief,
      approvedSourceVersion: source,
      variantArtifacts: [variant],
      variantReviewArtifacts: [variantReview],
    });
    expect(tasks.map((task) => task.taskType)).toEqual([
      "PACKAGING_CANDIDATE_GENERATION",
      "PACKAGING_AUTO_SELECTION",
      "PACKAGING_REVIEW",
    ]);
    expect(tasks.map((task) => task.recipientAgentId)).toEqual([
      "packaging-copy-agent",
      "packaging-copy-agent",
      "lilith",
    ]);
    expect(tasks[1]!.dependencyTaskIds).toEqual([tasks[0]!.taskId]);
    expect(tasks[2]!.dependencyTaskIds).toEqual([tasks[0]!.taskId, tasks[1]!.taskId]);
    expect(tasks.some((task) => task.approvalRequirement === "HUMAN")).toBe(false);
  });

  it("routes an explicitly requested public title-pattern refresh through Yigubigu before Shanshan", () => {
    const packagingBrief = { ...source, artifactId: "artifact_packaging_public", artifactType: "packaging_brief" };
    const variant = { ...source, artifactId: "artifact_variant_public", artifactType: "variant_proposal", createdByAgent: "balala" as const };
    const variantReview = { ...source, artifactId: "artifact_variant_review_public", artifactType: "variant_review_report", createdByAgent: "lilith" as const };
    const tasks = planV56PackagingTasks({
      context,
      packagingBriefArtifact: packagingBrief,
      approvedSourceVersion: source,
      variantArtifacts: [variant],
      variantReviewArtifacts: [variantReview],
      researchMode: "PUBLIC_PATTERN_PACK",
    });
    expect(tasks.map((task) => task.taskType)).toEqual([
      "PUBLIC_TITLE_PATTERN_RESEARCH",
      "PACKAGING_CANDIDATE_GENERATION",
      "PACKAGING_AUTO_SELECTION",
      "PACKAGING_REVIEW",
    ]);
    expect(tasks[0]!.recipientAgentId).toBe("public-researcher");
    expect(tasks[1]!.dependencyTaskIds).toEqual([tasks[0]!.taskId]);
    expect(tasks[1]!.recipientAgentId).toBe("packaging-copy-agent");
  });
});
