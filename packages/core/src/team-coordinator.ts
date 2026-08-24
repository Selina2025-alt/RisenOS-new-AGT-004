import {
  ContentVersionSchema,
  GeoSeoRequestSchema,
  HumanGateDecisionInputSchema,
  HumanGateDecisionSchema,
  ReviewRequestSchema,
  TeamRunSchema,
  type AgentId,
  type ArtifactRef,
  type ContentVersion,
  type HumanGateDecision,
  type HumanGateDecisionInput,
  type TeamRun,
} from "@risen/content-contracts";

import type { AgentRegistry, InternalAgentRuntime } from "./agent-runtime.js";
import { ConflictError } from "./errors.js";
import type { AgentTaskStore } from "./local-agent-store.js";
import { newId, nowIso, sha256 } from "./utils.js";
import {
  planV55SourceDraftWorkflow,
  planV55PostDraftReviewWorkflow,
  planV55IssueRoutingTasks,
  planV55VariantTasks,
  type V55WorkflowContext,
} from "./v55-workflow.js";

const INTERNAL_AGENTS = new Set<AgentId>([
  "agt-004",
  "topic-radar",
  "public-researcher",
  "makabaka",
  "content-orchestrator",
  "lilith",
  "xiaodiandian",
  "balala",
]);

export interface StartTeamRunInput {
  missionId: string;
  organizationId: string;
  traceId: string;
  createdBy: string;
  sourceArtifactIds: string[];
  requestedChannels: TeamRun["requestedChannels"];
  requiresPublicResearch: boolean;
  requiresEnterpriseKnowledge: boolean;
  deadline?: string;
}

export class TeamWorkflowCoordinator {
  public constructor(
    private readonly runtime: InternalAgentRuntime,
    private readonly store: AgentTaskStore,
    private readonly registry: AgentRegistry,
  ) {}

  async start(input: StartTeamRunInput): Promise<TeamRun> {
    const release = await this.store.acquireMissionLock(input.missionId, input.organizationId);
    try {
      const sourceArtifacts = await this.resolveArtifacts(input.sourceArtifactIds, input.organizationId);
      if (!sourceArtifacts.some((ref) => ref.artifactType === "perspective_contract")) {
        throw new ConflictError("PERSPECTIVE_REQUIRED", "A confirmed PerspectiveContract artifact is required");
      }
      if (input.requiresEnterpriseKnowledge && !sourceArtifacts.some((ref) => ref.artifactType === "knowledge_snapshot")) {
        throw new ConflictError("KNOWLEDGE_SNAPSHOT_REQUIRED", "Enterprise content requires a KnowledgeSnapshot artifact");
      }
      const runId = newId("teamrun");
      const context: V55WorkflowContext = {
        rootRunId: runId,
        missionId: input.missionId,
        organizationId: input.organizationId,
        traceId: input.traceId,
        createdBy: input.createdBy,
        sourceArtifacts,
        requiresPublicResearch: input.requiresPublicResearch,
        requiresEnterpriseKnowledge: input.requiresEnterpriseKnowledge,
        deadline: input.deadline ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      const plan = planV55SourceDraftWorkflow(context);
      const now = nowIso();
      const run = TeamRunSchema.parse({
        runId,
        missionId: input.missionId,
        organizationId: input.organizationId,
        traceId: input.traceId,
        createdBy: input.createdBy,
        status: "RUNNING",
        taskIds: plan.tasks.map((task) => task.taskId),
        sourceArtifactIds: input.sourceArtifactIds,
        requestedChannels: input.requestedChannels,
        createdAt: now,
        updatedAt: now,
      });
      await this.store.saveTeamRun(run);
      plan.tasks.forEach((task) => this.runtime.dispatch(task));
      await this.runtime.flushPersistence();
      return run;
    } finally {
      await release.release();
    }
  }

  async get(runId: string, organizationId: string): Promise<TeamRun> {
    await this.runtime.restore();
    const run = await this.store.getTeamRun(runId);
    if (!run || run.organizationId !== organizationId) throw new ConflictError("TEAM_RUN_NOT_FOUND", runId);
    return this.refresh(run);
  }

  async pause(runId: string, organizationId: string): Promise<TeamRun> {
    const run = await this.get(runId, organizationId);
    await Promise.all(run.taskIds.map((taskId) => this.runtime.pause(taskId)));
    return this.save({ ...run, status: "WAITING_HUMAN", updatedAt: nowIso() });
  }

  async resume(runId: string, organizationId: string): Promise<TeamRun> {
    const run = await this.get(runId, organizationId);
    await Promise.all(run.taskIds.map((taskId) => this.runtime.resume(taskId)));
    return this.save({ ...run, status: "RUNNING", error: undefined, updatedAt: nowIso() });
  }

  async cancel(runId: string, organizationId: string): Promise<TeamRun> {
    const run = await this.get(runId, organizationId);
    await Promise.all(run.taskIds.map((taskId) => this.runtime.cancel(taskId)));
    return this.save({ ...run, status: "CANCELLED", currentGate: undefined, updatedAt: nowIso() });
  }

  async decide(
    input: HumanGateDecisionInput,
    identity: { organizationId: string; userId: string },
  ): Promise<{ decision: HumanGateDecision; run: TeamRun }> {
    const parsed = HumanGateDecisionInputSchema.parse(input);
    if (INTERNAL_AGENTS.has(identity.userId as AgentId)) {
      throw new ConflictError("HUMAN_GATE_ACTOR_REQUIRED", "Internal agents cannot create human decisions");
    }
    const run = await this.get(parsed.runId, identity.organizationId);
    if (run.currentGate !== parsed.gate) {
      throw new ConflictError("HUMAN_GATE_MISMATCH", `Run is waiting for ${run.currentGate ?? "no gate"}`);
    }
    const artifact = await this.store.getArtifact(parsed.artifactId);
    if (!artifact || artifact.organizationId !== identity.organizationId || artifact.ref.contentHash !== parsed.artifactHash) {
      throw new ConflictError("HUMAN_GATE_ARTIFACT_STALE", "Approval artifact is missing or its hash changed");
    }
    const taskIds = new Set(run.taskIds);
    const runArtifactIds = new Set([
      ...run.sourceArtifactIds,
      ...(await this.store.listTaskResults())
        .filter((result) => taskIds.has(result.taskId))
        .flatMap((result) => result.outputArtifactRefs.map((ref) => ref.artifactId)),
    ]);
    if (!runArtifactIds.has(parsed.artifactId)) {
      throw new ConflictError("HUMAN_GATE_ARTIFACT_OUT_OF_SCOPE", "Approval artifact does not belong to this team run");
    }
    const existing = (await this.store.listHumanGateDecisions(run.runId))
      .find((decision) => decision.idempotencyKey === parsed.idempotencyKey);
    if (existing) {
      if (existing.artifactHash !== parsed.artifactHash || existing.decision !== parsed.decision) {
        throw new ConflictError("HUMAN_GATE_IDEMPOTENCY_CONFLICT", parsed.idempotencyKey);
      }
      return { decision: existing, run };
    }
    const decision = HumanGateDecisionSchema.parse({
      ...parsed,
      decisionId: newId("gate"),
      organizationId: identity.organizationId,
      decidedBy: identity.userId,
      decidedAt: nowIso(),
    });
    await this.store.saveHumanGateDecision(decision);
    if (decision.decision === "REJECTED") {
      return { decision, run: await this.save({ ...run, status: "BLOCKED", currentGate: undefined, updatedAt: nowIso() }) };
    }
    if (decision.gate === "SOURCE_DRAFT_APPROVED") {
      if (artifact.ref.createdByAgent !== "agt-004" || artifact.ref.artifactType !== "content_version") {
        throw new ConflictError("FORMAL_VERSION_REQUIRED", "Source approval must bind an immutable ContentVersion artifact created by 004");
      }
      const context: V55WorkflowContext = {
        rootRunId: run.runId,
        missionId: run.missionId,
        organizationId: run.organizationId,
        traceId: run.traceId,
        createdBy: run.createdBy,
        sourceArtifacts: [artifact.ref],
        requiresPublicResearch: false,
        requiresEnterpriseKnowledge: true,
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      const tasks = planV55VariantTasks({
        context,
        approvedSourceVersion: artifact.ref,
        humanApproved: true,
        channels: run.requestedChannels,
      });
      tasks.forEach((task) => this.runtime.dispatch(task));
      await this.runtime.flushPersistence();
      const updated = await this.save({
        ...run,
        status: tasks.length ? "RUNNING" : "WAITING_HUMAN",
        taskIds: [...run.taskIds, ...tasks.map((task) => task.taskId)],
        currentGate: tasks.length ? undefined : "FINAL_VARIANTS_APPROVED",
        sourceArtifactIds: [...new Set([...run.sourceArtifactIds, artifact.ref.artifactId])],
        error: undefined,
        updatedAt: nowIso(),
      });
      return { decision, run: updated };
    }
    if (decision.gate === "FINAL_VARIANTS_APPROVED") {
      if (artifact.ref.createdByAgent !== "agt-004" || artifact.ref.artifactType !== "variant_approval_manifest") {
        throw new ConflictError("VARIANT_APPROVAL_MANIFEST_REQUIRED", "Final approval must bind the 004 variant approval manifest");
      }
      return { decision, run: await this.save({ ...run, status: "SUCCEEDED", currentGate: undefined, updatedAt: nowIso() }) };
    }
    return { decision, run: await this.save({ ...run, status: "RUNNING", currentGate: undefined, updatedAt: nowIso() }) };
  }

  async artifacts(runId: string, organizationId: string): Promise<ArtifactRef[]> {
    const run = await this.get(runId, organizationId);
    const taskIds = new Set(run.taskIds);
    const outputRefs = (await this.store.listTaskResults())
      .filter((result) => taskIds.has(result.taskId))
      .flatMap((result) => result.outputArtifactRefs);
    const sourceRefs = await this.resolveArtifacts(run.sourceArtifactIds, organizationId);
    return [...new Map([...sourceRefs, ...outputRefs].map((ref) => [ref.artifactId, ref])).values()];
  }

  async submitFormalVersion(
    runId: string,
    organizationId: string,
    versionInput: ContentVersion,
  ): Promise<{ run: TeamRun; artifact: ArtifactRef }> {
    const version = ContentVersionSchema.parse(versionInput);
    if (version.organizationId !== organizationId) {
      throw new ConflictError("CONTENT_VERSION_ORGANIZATION_MISMATCH", version.id);
    }
    const run = await this.get(runId, organizationId);
    const existingTasks = run.taskIds.map((taskId) => this.runtime.getTask(taskId));
    const reviewRounds = existingTasks.filter((task) => task.taskType === "FULL_CONTENT_REVIEW").length;
    if (reviewRounds >= 2) {
      throw new ConflictError("FORMAL_VERSION_REVIEW_LIMIT", "Automatic full-review limit reached; human intervention is required");
    }
    const initialTasks = existingTasks.filter((task) => !task.taskType.startsWith("VARIANT_") && !task.taskType.startsWith("LIGHT_VARIANT_REVIEW_"));
    if (!initialTasks.length || !initialTasks.every((task) => task.status === "SUCCEEDED")) {
      throw new ConflictError("DRAFT_PROPOSAL_NOT_READY", "All source-draft proposal tasks must succeed first");
    }
    const release = await this.store.acquireMissionLock(run.missionId, run.organizationId);
    try {
      const artifact = await this.persistSupervisorArtifact({
        artifactType: "content_version",
        organizationId,
        payload: version,
        sourceRefs: run.sourceArtifactIds,
      });
      const now = nowIso();
      const reviewRequest = ReviewRequestSchema.parse({
        id: newId("review_request"),
        organizationId,
        createdBy: run.createdBy,
        traceId: run.traceId,
        createdAt: now,
        updatedAt: now,
        status: "PENDING",
        assetId: version.assetId,
        versionId: version.id,
        reviewerType: "HUMAN",
        reviewerId: run.createdBy,
        reviewAgent: "Lilith",
        requestedChecks: [
          "content_adequacy", "perspective_consistency", "logic", "ai_style",
          "repetition", "narrative_quality", "human_voice",
          "enterprise_fusion", "knowledge_snapshot", "nomos_canon",
          "product_architecture", "claim_status", "evidence", "compliance",
          "confidentiality", "skill_trace", "seo", "geo",
        ],
      });
      const reviewEnvelope = await this.persistSupervisorArtifact({
        artifactType: "review_envelope",
        organizationId,
        payload: { reviewRequest, content: version },
        sourceRefs: [artifact.artifactId],
      });
      const context: V55WorkflowContext = {
        rootRunId: run.runId,
        missionId: run.missionId,
        organizationId: run.organizationId,
        traceId: run.traceId,
        createdBy: run.createdBy,
        sourceArtifacts: [artifact, reviewEnvelope],
        requiresPublicResearch: false,
        requiresEnterpriseKnowledge: true,
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      const tasks = planV55PostDraftReviewWorkflow({
        context,
        formalVersionArtifact: artifact,
        reviewEnvelopeArtifact: reviewEnvelope,
      });
      tasks.forEach((task) => this.runtime.dispatch(task));
      await this.runtime.flushPersistence();
      const updated = await this.save({
        ...run,
        status: "RUNNING",
        taskIds: [...run.taskIds, ...tasks.map((task) => task.taskId)],
        sourceArtifactIds: [...new Set([...run.sourceArtifactIds, artifact.artifactId, reviewEnvelope.artifactId])],
        currentGate: undefined,
        error: undefined,
        updatedAt: nowIso(),
      });
      return { run: updated, artifact };
    } finally {
      await release.release();
    }
  }

  async persistSupervisorArtifact(input: {
    artifactType: "perspective_contract" | "knowledge_snapshot" | "content_version" | "review_envelope" | "variant_approval_manifest" | "review_issue_routing" | "geo_seo_request";
    organizationId: string;
    payload: unknown;
    sourceRefs?: string[];
  }): Promise<ArtifactRef> {
    const artifactId = newId("artifact");
    const canonical = JSON.stringify(input.payload, null, 2) + "\n";
    const ref: ArtifactRef = {
      artifactId,
      artifactType: input.artifactType,
      schemaVersion: "1.0.0",
      contentHash: sha256(canonical),
      uri: `local://artifacts/${artifactId}.json`,
      mimeType: "application/json",
      rights: "internal",
      createdByAgent: "agt-004",
      sourceRefs: input.sourceRefs ?? [],
      parentArtifactIds: input.sourceRefs ?? [],
      status: "READY",
    };
    await this.store.saveArtifact({
      ref,
      payload: input.payload,
      organizationId: input.organizationId,
    });
    return ref;
  }

  private async refresh(run: TeamRun): Promise<TeamRun> {
    if (["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED"].includes(run.status)) return run;
    const tasks = run.taskIds.map((taskId) => this.runtime.getTask(taskId));
    if (tasks.some((task) => task.status === "FAILED" || task.status === "EXPIRED")) {
      return this.save({ ...run, status: "FAILED", error: "TEAM_TASK_FAILED", updatedAt: nowIso() });
    }
    if (tasks.some((task) => task.status === "BLOCKED")) {
      return this.save({ ...run, status: "BLOCKED", error: "TEAM_TASK_BLOCKED", updatedAt: nowIso() });
    }
    if (tasks.some((task) => task.status === "CANCELLED")) {
      return this.save({ ...run, status: "CANCELLED", updatedAt: nowIso() });
    }
    if (tasks.length && tasks.every((task) => task.status === "SUCCEEDED")) {
      const fullReview = tasks.filter((task) => task.taskType === "FULL_CONTENT_REVIEW").at(-1);
      const variantReviews = tasks.filter((task) => task.taskType.startsWith("LIGHT_VARIANT_REVIEW_"));
      if (fullReview) {
        const sourceGateTasks = tasks.filter((task) => [
          "PUBLIC_RESEARCH",
          "KNOWLEDGE_MATCH_PRE_DRAFT",
          "DRAFT_PROPOSAL",
          "KNOWLEDGE_MATCH_POST_DRAFT",
          "FULL_CONTENT_REVIEW",
        ].includes(task.taskType));
        const allSourceChecksEnforcing = (await Promise.all(sourceGateTasks.map((task) => this.taskWasEnforcing(task.taskId))))
          .every(Boolean);
        if (!allSourceChecksEnforcing) {
          return this.save({ ...run, status: "BLOCKED", error: "SHADOW_OUTPUT_CANNOT_SATISFY_SOURCE_GATE", currentGate: undefined, updatedAt: nowIso() });
        }
        const fullStatus = await this.reviewStatus(fullReview.taskId);
        if (fullStatus !== "PASS") {
          return this.routeFullReviewIssues(run, fullReview.taskId, fullStatus ?? "INVALID");
        }
      }
      if (variantReviews.length) {
        const variantTasks = tasks.filter((task) => task.taskType.startsWith("VARIANT_"));
        const allEnforcing = (await Promise.all([...variantTasks, ...variantReviews].map((task) => this.taskWasEnforcing(task.taskId))))
          .every(Boolean);
        if (!allEnforcing) {
          return this.save({ ...run, status: "BLOCKED", error: "SHADOW_OUTPUT_CANNOT_SATISFY_VARIANT_GATE", currentGate: undefined, updatedAt: nowIso() });
        }
        const statuses = await Promise.all(variantReviews.map((task) => this.reviewStatus(task.taskId)));
        if (statuses.some((status) => status !== "PASS")) {
          const failed = statuses.find((status) => status && status !== "PASS") ?? "INVALID";
          return this.save({ ...run, status: "BLOCKED", error: `VARIANT_REVIEW_${failed}`, currentGate: undefined, updatedAt: nowIso() });
        }
      }
      const hasVariants = tasks.some((task) => task.taskType.startsWith("VARIANT_"));
      let sourceArtifactIds = run.sourceArtifactIds;
      if (hasVariants) {
        const taskIds = new Set(run.taskIds);
        const refs = (await this.store.listTaskResults())
          .filter((result) => taskIds.has(result.taskId))
          .flatMap((result) => result.outputArtifactRefs)
          .filter((ref) => ref.artifactType === "variant_proposal" || ref.artifactType === "variant_review_report");
        const existingManifest = await this.findSourceArtifact(run.sourceArtifactIds, "variant_approval_manifest");
        if (!existingManifest) {
          const sourceVersion = await this.findSourceArtifact(run.sourceArtifactIds, "content_version");
          const manifest = await this.persistSupervisorArtifact({
            artifactType: "variant_approval_manifest",
            organizationId: run.organizationId,
            payload: {
              runId: run.runId,
              sourceContentVersionArtifactId: sourceVersion?.artifactId ?? null,
              artifacts: refs.map((ref) => ({ artifactId: ref.artifactId, contentHash: ref.contentHash, artifactType: ref.artifactType })),
            },
            sourceRefs: refs.map((ref) => ref.artifactId),
          });
          sourceArtifactIds = [...sourceArtifactIds, manifest.artifactId];
        }
      }
      return this.save({
        ...run,
        status: "WAITING_HUMAN",
        sourceArtifactIds,
        currentGate: hasVariants
          ? "FINAL_VARIANTS_APPROVED"
          : fullReview
            ? "SOURCE_DRAFT_APPROVED"
            : undefined,
        updatedAt: nowIso(),
      });
    }
    return this.save({ ...run, status: "RUNNING", updatedAt: nowIso() });
  }

  private async reviewStatus(taskId: string): Promise<string | undefined> {
    const output = await this.reviewOutput(taskId);
    return typeof output?.reviewStatus === "string" ? output.reviewStatus : undefined;
  }

  private async taskWasEnforcing(taskId: string): Promise<boolean> {
    const task = this.runtime.getTask(taskId);
    if (!this.registry.isEnforcing(task.recipientAgentId)) return false;
    const result = await this.store.getTaskResult(taskId);
    const ref = result?.outputArtifactRefs[0];
    if (!ref) return false;
    const artifact = await this.store.getArtifact(ref.artifactId);
    if (!artifact?.payload || typeof artifact.payload !== "object") return false;
    return (artifact.payload as { rolloutMode?: unknown }).rolloutMode === "ENFORCING";
  }

  private async reviewOutput(taskId: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.store.getTaskResult(taskId);
    const ref = result?.outputArtifactRefs[0];
    if (!ref) return undefined;
    const artifact = await this.store.getArtifact(ref.artifactId);
    if (!artifact?.payload || typeof artifact.payload !== "object") return undefined;
    const wrapper = artifact.payload as { output?: unknown };
    if (!wrapper.output || typeof wrapper.output !== "object") return undefined;
    return wrapper.output as Record<string, unknown>;
  }

  private async routeFullReviewIssues(run: TeamRun, taskId: string, status: string): Promise<TeamRun> {
    const output = await this.reviewOutput(taskId);
    if (!output) {
      return this.save({ ...run, status: "BLOCKED", error: "FULL_REVIEW_INVALID", currentGate: undefined, updatedAt: nowIso() });
    }
    const issueArrays = ["mustFixIssues", "stronglyRecommendedIssues", "optionalIssues"]
      .flatMap((key) => Array.isArray(output[key]) ? output[key] as Array<Record<string, unknown>> : []);
    const allowedRoutes = new Set(["public-researcher", "makabaka", "content-orchestrator", "xiaodiandian"] as const);
    const routes = issueArrays
      .map((issue) => String(issue.routeTo ?? "human"))
      .filter((route): route is "public-researcher" | "makabaka" | "content-orchestrator" | "xiaodiandian" => allowedRoutes.has(route as never));
    const reviewResult = await this.store.getTaskResult(taskId);
    const reviewArtifact = reviewResult?.outputArtifactRefs[0];
    if (!reviewArtifact) {
      return this.save({ ...run, status: "BLOCKED", error: "FULL_REVIEW_ARTIFACT_MISSING", currentGate: undefined, updatedAt: nowIso() });
    }
    const routing = await this.persistSupervisorArtifact({
      artifactType: "review_issue_routing",
      organizationId: run.organizationId,
      payload: {
        runId: run.runId,
        reviewArtifactId: reviewArtifact.artifactId,
        reviewStatus: status,
        routes,
        issues: issueArrays.map((issue) => ({
          issueId: issue.issueId,
          severity: issue.severity,
          routeTo: issue.routeTo,
          module: issue.module,
        })),
      },
      sourceRefs: [reviewArtifact.artifactId],
    });
    let geoSeoRequestArtifact: ArtifactRef | undefined;
    if (routes.includes("xiaodiandian")) {
      const sourceRef = await this.findSourceArtifact([...run.sourceArtifactIds].reverse(), "content_version");
      const source = sourceRef ? await this.store.getArtifact(sourceRef.artifactId) : undefined;
      if (sourceRef && source?.payload && typeof source.payload === "object") {
        const version = ContentVersionSchema.parse(source.payload);
        const now = nowIso();
        const geoRequest = GeoSeoRequestSchema.parse({
          id: newId("geo_request"),
          requestId: newId("geo_request"),
          organizationId: run.organizationId,
          createdBy: run.createdBy,
          traceId: run.traceId,
          createdAt: now,
          updatedAt: now,
          status: "PENDING",
          sourceContentVersionId: version.id,
          sourceReviewId: String(output.reviewId ?? newId("review")),
          contentBriefId: newId("brief_ref"),
          researchPackId: newId("research_ref"),
          contentText: version.body,
          seoCorpusSnapshot: "knowledge://seo/current",
          geoCorpusSnapshot: "knowledge://geo/current",
          claimBindingSnapshot: JSON.stringify(version.claimBindingSnapshot),
          applicablePreferenceSet: "[]",
          requestedChecks: ["seo", "geo", "geo_insertion"],
          allowedResearchScope: "LOCAL_KNOWLEDGE_ONLY",
        });
        geoSeoRequestArtifact = await this.persistSupervisorArtifact({
          artifactType: "geo_seo_request",
          organizationId: run.organizationId,
          payload: geoRequest,
          sourceRefs: [sourceRef.artifactId, reviewArtifact.artifactId],
        });
      }
    }
    const context: V55WorkflowContext = {
      rootRunId: run.runId,
      missionId: run.missionId,
      organizationId: run.organizationId,
      traceId: run.traceId,
      createdBy: run.createdBy,
      sourceArtifacts: [reviewArtifact, routing, ...(geoSeoRequestArtifact ? [geoSeoRequestArtifact] : [])],
      requiresPublicResearch: false,
      requiresEnterpriseKnowledge: true,
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const tasks = planV55IssueRoutingTasks({
      context,
      reviewArtifact,
      routes,
      ...(geoSeoRequestArtifact ? { geoSeoRequestArtifact } : {}),
    });
    tasks.forEach((task) => this.runtime.dispatch(task));
    await this.runtime.flushPersistence();
    return this.save({
      ...run,
      status: "BLOCKED",
      error: `FULL_REVIEW_${status}`,
      currentGate: undefined,
      taskIds: [...run.taskIds, ...tasks.map((task) => task.taskId)],
      sourceArtifactIds: [...run.sourceArtifactIds, routing.artifactId, ...(geoSeoRequestArtifact ? [geoSeoRequestArtifact.artifactId] : [])],
      updatedAt: nowIso(),
    });
  }

  private async findSourceArtifact(ids: string[], artifactType: string): Promise<ArtifactRef | undefined> {
    for (const id of ids) {
      const artifact = await this.store.getArtifact(id);
      if (artifact?.ref.artifactType === artifactType) return artifact.ref;
    }
    return undefined;
  }

  private async resolveArtifacts(ids: string[], organizationId: string): Promise<ArtifactRef[]> {
    const artifacts: ArtifactRef[] = [];
    for (const id of ids) {
      const stored = await this.store.getArtifact(id);
      if (!stored || stored.organizationId !== organizationId) {
        throw new ConflictError("ARTIFACT_NOT_FOUND", id);
      }
      artifacts.push(stored.ref);
    }
    return artifacts;
  }

  private async save(run: TeamRun): Promise<TeamRun> {
    const parsed = TeamRunSchema.parse(run);
    await this.store.saveTeamRun(parsed);
    return parsed;
  }
}
