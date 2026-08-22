import { describe, expect, it } from "vitest";
import type { ArtifactRef } from "@risen/content-contracts";
import { planV55PostDraftReviewWorkflow, planV55SourceDraftWorkflow, planV55VariantTasks } from "../src/index.js";

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
      channels: ["wechat", "short_video", "xiaohongshu", "x", "linkedin"],
    });
    expect(tasks).toHaveLength(10);
    expect(tasks.filter((task) => task.recipientAgentId === "balala")).toHaveLength(5);
    expect(tasks.filter((task) => task.recipientAgentId === "lilith")).toHaveLength(5);
    for (let index = 0; index < tasks.length; index += 2) {
      expect(tasks[index + 1]!.dependencyTaskIds).toEqual([tasks[index]!.taskId]);
    }
  });
});
