import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentTask, ArtifactRef, AutoPackagingSelection, TeamRun } from "@risen/content-contracts";

import {
  LocalAgentStore,
  TeamWorkflowCoordinator,
  sha256,
  type AgentRegistry,
  type InternalAgentRuntime,
} from "../src/index.js";

const organizationId = "organization-packaging-001";
const sourceHash = "a".repeat(64);
const now = "2026-08-24T00:00:00.000Z";

function selection(): AutoPackagingSelection {
  return {
    selectionId: "selection-packaging-001",
    packagingRequestId: "packaging-request-001",
    sourceContentHash: sourceHash,
    candidatePoolHash: "b".repeat(64),
    selectionStatus: "AUTO_SELECTED",
    shortlistedCandidates: [1, 2, 3, 4, 5].map((value) => `candidate-${value}`),
    channelSelections: [{
      channel: "wechat",
      primaryTitle: "企业AI为什么一进业务就失灵？",
      alternativeTitles: ["备选一", "备选二", "备选三"],
      coverMainText: "从Demo到业务",
      coverSubText: "企业AI落地卡在哪",
      videoTopLines: [],
      tags: ["#JovaAI"],
      notApplicableFields: ["videoTopLines"],
      selectedCandidateId: "candidate-1",
      selectionRationale: "正文可兑现",
      scoreBreakdown: {
        contentFidelity: 20,
        audienceRelevance: 15,
        curiosityOrConflict: 15,
        readerBenefit: 15,
        specificityAndImagery: 10,
        brandProductFit: 10,
        channelFit: 5,
        titleCoverComplementarity: 5,
        humanPreferenceFit: 5,
        total: 100,
      },
      scoreConfidence: 0.9,
      supportingClaimIds: ["claim-packaging-001"],
      supportingSectionRefs: ["opening"],
      riskWarnings: [],
    }],
    overallRationale: "渠道独立选择",
    scoreConfidence: 0.9,
    preferenceCoverage: 0.5,
    sourceCoverage: 1,
    riskWarnings: [],
    selectionPromptVersion: "packaging-copy-agent-auto-selection-v5.6.0",
    titlePolicyVersion: "channel-packaging-policy-v1",
    contentHash: "c".repeat(64),
    createdAt: now,
  };
}

async function save(store: LocalAgentStore, artifactType: string, id: string, payload: unknown): Promise<ArtifactRef> {
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  const ref: ArtifactRef = {
    artifactId: id,
    artifactType,
    schemaVersion: "1.0.0",
    contentHash: sha256(canonical),
    uri: `local://artifacts/${id}.json`,
    mimeType: "application/json",
    rights: "internal",
    createdByAgent: "agt-004",
    sourceRefs: [],
    parentArtifactIds: [],
    status: "READY",
  };
  await store.saveArtifact({ ref, payload, organizationId });
  return ref;
}

function run(sourceArtifactIds: string[]): TeamRun {
  return {
    runId: "team-run-packaging-001",
    missionId: "mission-packaging-001",
    organizationId,
    traceId: "trace-packaging-001",
    createdBy: "user-enterprise-001",
    status: "WAITING_HUMAN",
    taskIds: [],
    sourceArtifactIds,
    requestedChannels: ["wechat"],
    createdAt: now,
    updatedAt: now,
  };
}

describe("team coordinator packaging feedback and override", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function setup() {
    const root = await mkdtemp(join(tmpdir(), "agt004-packaging-coordinator-"));
    roots.push(root);
    const store = new LocalAgentStore(root);
    const dispatched: AgentTask[] = [];
    const runtime = {
      async restore() {},
      dispatch(task: AgentTask) { dispatched.push(task); return { taskId: task.taskId }; },
      async flushPersistence() {},
    } as unknown as InternalAgentRuntime;
    const coordinator = new TeamWorkflowCoordinator(runtime, store, {} as AgentRegistry);
    return { store, coordinator, dispatched };
  }

  it("stores human feedback as an unapproved preference candidate", async () => {
    const { store, coordinator } = await setup();
    const selectionRef = await save(store, "auto_packaging_selection", "artifact-selection-001", selection());
    await store.saveTeamRun(run([selectionRef.artifactId]));

    await coordinator.submitPackagingFeedback({
      runId: "team-run-packaging-001",
      selectionId: "selection-packaging-001",
      selectedCandidateIds: ["candidate-1"],
      rejectedCandidateIds: ["candidate-2"],
      preferredCandidateIds: ["candidate-3"],
      manualFinalTexts: { wechat: "人工标题" },
      reasons: ["更像真人表达"],
      scope: "wechat enterprise AI",
      channel: "wechat",
      generalizable: false,
    }, { organizationId, userId: "user-enterprise-001" });

    const refs = await store.listArtifactRefs();
    const candidateRef = refs.find((ref) => ref.artifactType === "preference_candidate");
    expect(candidateRef).toBeDefined();
    const candidate = await store.getArtifact(candidateRef!.artifactId);
    expect(candidate?.payload).toMatchObject({ status: "CANDIDATE", approvedByHuman: false, confidence: 0.25 });
    expect(refs.some((ref) => ref.artifactType === "preference_rule_active")).toBe(false);
  });

  it("keeps an override pending and routes it to Lilith instead of self-approving", async () => {
    const { store, coordinator, dispatched } = await setup();
    const refs = await Promise.all([
      save(store, "auto_packaging_selection", "artifact-selection-001", selection()),
      save(store, "packaging_brief", "artifact-brief-001", { packagingRequestId: "packaging-request-001" }),
      save(store, "title_candidate_pool", "artifact-pool-001", { poolId: "pool-001" }),
      save(store, "content_version", "artifact-version-001", { contentHash: sourceHash }),
      save(store, "variant_proposal", "artifact-variant-001", { variantId: "variant-001" }),
    ]);
    await store.saveTeamRun(run(refs.map((ref) => ref.artifactId)));

    const result = await coordinator.submitPackagingOverride({
      runId: "team-run-packaging-001",
      selectionId: "selection-packaging-001",
      sourceContentHash: sourceHash,
      channelOverrides: { wechat: { primaryTitle: "演示很好，为什么业务用不了？" } },
      reason: "人工更偏好直接问题",
    }, { organizationId, userId: "user-enterprise-001" });

    expect(result.override.validationStatus).toBe("PENDING_REVIEW");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ recipientAgentId: "lilith", taskType: "PACKAGING_OVERRIDE_REVIEW" });
    expect(result.run.status).toBe("RUNNING");
    expect(result.run.currentGate).toBeUndefined();
  });

  it("rejects a stale joint packaging manifest before persisting any human approval", async () => {
    const { store, coordinator } = await setup();
    const oldManifest = await save(store, "variant_approval_manifest", "artifact-manifest-old", { revision: 1 });
    const latestManifest = await save(store, "variant_approval_manifest", "artifact-manifest-latest", { revision: 2 });
    await store.saveTeamRun({
      ...run([oldManifest.artifactId, latestManifest.artifactId]),
      currentGate: "FINAL_VARIANTS_APPROVED",
    });

    await expect(coordinator.decide({
      runId: "team-run-packaging-001",
      gate: "FINAL_VARIANTS_APPROVED",
      artifactId: oldManifest.artifactId,
      artifactHash: oldManifest.contentHash,
      decision: "APPROVED",
      idempotencyKey: "stale-manifest-decision-001",
    }, { organizationId, userId: "user-enterprise-001" })).rejects.toMatchObject({ code: "VARIANT_APPROVAL_MANIFEST_STALE" });
    expect(await store.listHumanGateDecisions("team-run-packaging-001")).toEqual([]);
  });
});
