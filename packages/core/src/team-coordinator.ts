import {
  ContentVersionSchema,
  GeoSeoRequestSchema,
  HumanGateDecisionInputSchema,
  HumanGateDecisionSchema,
  AutoPackagingSelectionSchema,
  PackagingBriefSchema,
  PackagingFeedbackInputSchema,
  PackagingFeedbackSchema,
  PackagingResearchModeSchema,
  PackagingOverrideSchema,
  PackagingReviewReportSchema,
  PreferenceRuleSchema,
  TitleCandidatePoolSchema,
  ReviewRequestSchema,
  TeamRunSchema,
  type AgentId,
  type ArtifactRef,
  type ContentVersion,
  type HumanGateDecision,
  type HumanGateDecisionInput,
  type PackagingFeedback,
  type PackagingFeedbackInput,
  type PackagingOverride,
  type PackagingOverrideInput,
  type AutoPackagingSelection,
  type PackagingReviewReport,
  type TitleCandidatePool,
  type TeamRun,
} from "@risen/content-contracts";

import type { AgentRegistry, InternalAgentRuntime } from "./agent-runtime.js";
import { ConflictError } from "./errors.js";
import type { AgentTaskStore } from "./local-agent-store.js";
import { newId, nowIso, sha256 } from "./utils.js";
import { assertPackagingOverrideSafe, hashPackagingPayload, normalizeTags } from "./packaging-shanshan.js";
import {
  planV55SourceDraftWorkflow,
  planV55PostDraftReviewWorkflow,
  planV55IssueRoutingTasks,
  planV55VariantTasks,
  planV56PackagingTasks,
  planV56PackagingOverrideReview,
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
  "packaging-copy-agent",
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
    if (parsed.decision === "APPROVED" && parsed.gate === "SOURCE_DRAFT_APPROVED" &&
      (artifact.ref.createdByAgent !== "agt-004" || artifact.ref.artifactType !== "content_version")) {
      throw new ConflictError("FORMAL_VERSION_REQUIRED", "Source approval must bind an immutable ContentVersion artifact created by 004");
    }
    if (parsed.decision === "APPROVED" && parsed.gate === "FINAL_VARIANTS_APPROVED") {
      if (artifact.ref.createdByAgent !== "agt-004" || artifact.ref.artifactType !== "variant_approval_manifest") {
        throw new ConflictError("VARIANT_APPROVAL_MANIFEST_REQUIRED", "Final approval must bind the 004 variant approval manifest");
      }
      const latestManifest = await this.findSourceArtifact([...run.sourceArtifactIds].reverse(), "variant_approval_manifest");
      if (!latestManifest || latestManifest.artifactId !== artifact.ref.artifactId || latestManifest.contentHash !== artifact.ref.contentHash) {
        throw new ConflictError("VARIANT_APPROVAL_MANIFEST_STALE", "Final approval must bind the latest joint variant and packaging manifest");
      }
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

  async packaging(runId: string, organizationId: string): Promise<{
    artifacts: ArtifactRef[];
    pool?: TitleCandidatePool;
    selection?: AutoPackagingSelection;
    review?: PackagingReviewReport;
    effectiveOverride?: PackagingOverride;
    feedback: PackagingFeedback[];
  }> {
    const allRefs = await this.artifacts(runId, organizationId);
    const supersededIds = new Set<string>();
    for (const marker of allRefs.filter((ref) => ref.artifactType === "packaging_supersession")) {
      const stored = await this.store.getArtifact(marker.artifactId);
      const payload = this.unwrapArtifactPayload(stored?.payload);
      if (Array.isArray(payload?.previousArtifactIds)) {
        payload.previousArtifactIds.forEach((id) => typeof id === "string" && supersededIds.add(id));
      }
    }
    const refs = allRefs.filter((ref) => !supersededIds.has(ref.artifactId) && [
      "packaging_brief",
      "title_candidate_pool",
      "auto_packaging_selection",
      "packaging_review_report",
      "packaging_feedback",
      "packaging_override",
    ].includes(ref.artifactType));
    let selection: AutoPackagingSelection | undefined;
    let pool: TitleCandidatePool | undefined;
    let review: PackagingReviewReport | undefined;
    const overrides: Array<{ value: PackagingOverride; ref: ArtifactRef }> = [];
    const reviewEntries: Array<{ value: PackagingReviewReport; ref: ArtifactRef }> = [];
    const feedback: PackagingFeedback[] = [];
    for (const ref of refs) {
      const stored = await this.store.getArtifact(ref.artifactId);
      const payload = this.unwrapArtifactPayload(stored?.payload);
      if (ref.artifactType === "auto_packaging_selection" && payload) selection = AutoPackagingSelectionSchema.parse(payload);
      if (ref.artifactType === "title_candidate_pool" && payload) pool = TitleCandidatePoolSchema.parse(payload);
      if (ref.artifactType === "packaging_review_report" && payload) {
        review = PackagingReviewReportSchema.parse(payload);
        reviewEntries.push({ value: review, ref });
      }
      if (ref.artifactType === "packaging_override" && payload) overrides.push({ value: PackagingOverrideSchema.parse(payload), ref });
      if (ref.artifactType === "packaging_feedback" && payload) feedback.push(PackagingFeedbackSchema.parse(payload));
    }
    const effectiveOverride = overrides
      .filter((item) => item.value.validationStatus === "PASS" || reviewEntries.some((entry) =>
        entry.value.reviewStatus === "PASS" && entry.ref.sourceRefs.includes(item.ref.artifactId)
      ))
      .sort((left, right) => right.value.createdAt.localeCompare(left.value.createdAt))[0]?.value;
    return { artifacts: refs, ...(pool ? { pool } : {}), ...(selection ? { selection } : {}), ...(review ? { review } : {}), ...(effectiveOverride ? { effectiveOverride } : {}), feedback };
  }

  async submitPackagingFeedback(
    input: PackagingFeedbackInput,
    identity: { organizationId: string; userId: string },
  ): Promise<PackagingFeedback> {
    const value = PackagingFeedbackInputSchema.parse(input);
    const run = await this.get(value.runId, identity.organizationId);
    const selectionRef = await this.findRunArtifact(run, "auto_packaging_selection", (payload) => payload.selectionId === value.selectionId);
    if (!selectionRef) throw new ConflictError("PACKAGING_SELECTION_NOT_FOUND", value.selectionId);
    const base = {
      ...value,
      feedbackId: newId("packaging_feedback"),
      organizationId: identity.organizationId,
      submittedBy: identity.userId,
      submittedAt: nowIso(),
    };
    const feedback = PackagingFeedbackSchema.parse({ ...base, contentHash: hashPackagingPayload(base) });
    const feedbackRef = await this.persistSupervisorArtifact({
      artifactType: "packaging_feedback",
      organizationId: identity.organizationId,
      payload: feedback,
      sourceRefs: [selectionRef.artifactId],
    });
    const now = nowIso();
    const candidate = PreferenceRuleSchema.parse({
      id: newId("preference_candidate"),
      preferenceId: newId("packaging_preference"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: run.traceId,
      createdAt: now,
      updatedAt: now,
      status: "CANDIDATE",
      sourceFeedbackIds: [feedback.feedbackId],
      scope: feedback.scope,
      appliesWhen: [
        ...(feedback.channel ? [`channel=${feedback.channel}`] : []),
        "contentType=packaging",
      ],
      doesNotApplyWhen: ["different channel, audience or topic unless separately approved"],
      channel: feedback.channel ? [feedback.channel] : [],
      contentType: ["packaging"],
      audience: [],
      topicType: [],
      strength: "RECOMMENDED",
      rule: feedback.reasons.join("；") || "Use the human packaging preference only in the recorded scope.",
      examples: Object.values(feedback.manualFinalTexts),
      confidence: feedback.generalizable ? 0.5 : 0.25,
      approvedByHuman: false,
      version: "candidate-v1",
    });
    await this.persistSupervisorArtifact({
      artifactType: "preference_candidate",
      organizationId: identity.organizationId,
      payload: candidate,
      sourceRefs: [feedbackRef.artifactId],
    });
    return feedback;
  }

  async submitPackagingOverride(
    input: PackagingOverrideInput,
    identity: { organizationId: string; userId: string },
  ): Promise<{ override: PackagingOverride; run: TeamRun }> {
    const value = assertPackagingOverrideSafe(input);
    const run = await this.get(value.runId, identity.organizationId);
    const selectionRef = await this.findRunArtifact(run, "auto_packaging_selection", (payload) => payload.selectionId === value.selectionId);
    if (!selectionRef) throw new ConflictError("PACKAGING_SELECTION_NOT_FOUND", value.selectionId);
    const selectionStored = await this.store.getArtifact(selectionRef.artifactId);
    const selection = AutoPackagingSelectionSchema.parse(this.unwrapArtifactPayload(selectionStored?.payload));
    if (selection.sourceContentHash !== value.sourceContentHash) {
      throw new ConflictError("PACKAGING_OVERRIDE_SOURCE_STALE", "Override source hash differs from the selected packaging source");
    }
    const base = {
      ...value,
      overrideId: newId("packaging_override"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      createdAt: nowIso(),
      validationStatus: "PENDING_REVIEW" as const,
    };
    const override = PackagingOverrideSchema.parse({ ...base, contentHash: hashPackagingPayload(base) });
    const overrideRef = await this.persistSupervisorArtifact({
      artifactType: "packaging_override",
      organizationId: identity.organizationId,
      payload: override,
      sourceRefs: [selectionRef.artifactId],
    });
    const artifacts = await this.artifactsWithoutRefresh(run);
    const briefRef = [...artifacts].reverse().find((ref) => ref.artifactType === "packaging_brief");
    const poolRef = [...artifacts].reverse().find((ref) => ref.artifactType === "title_candidate_pool");
    const sourceVersionRef = [...artifacts].reverse().find((ref) => ref.artifactType === "content_version");
    const variantRefs = artifacts.filter((ref) => ref.artifactType === "variant_proposal");
    if (!briefRef || !poolRef || !sourceVersionRef || !variantRefs.length) {
      throw new ConflictError("PACKAGING_OVERRIDE_REVIEW_INPUTS_MISSING", "Override cannot be reviewed without brief, pool, source and variants");
    }
    const channelSelections = selection.channelSelections.map((item) => {
      const replacement = value.channelOverrides[item.channel];
      if (!replacement) return item;
      return {
        ...item,
        ...(replacement.primaryTitle ? { primaryTitle: replacement.primaryTitle } : {}),
        ...(replacement.coverMainText !== undefined ? { coverMainText: replacement.coverMainText } : {}),
        ...(replacement.coverSubText !== undefined ? { coverSubText: replacement.coverSubText } : {}),
        ...(replacement.videoTopLines ? { videoTopLines: replacement.videoTopLines } : {}),
        ...(replacement.tags ? { tags: normalizeTags(replacement.tags) } : {}),
      };
    });
    const effectiveBase = {
      ...selection,
      selectionId: newId("packaging_override_selection"),
      selectionStatus: "REVIEWING" as const,
      channelSelections,
      overallRationale: `${selection.overallRationale} Human override ${override.overrideId}: ${override.reason}`,
      createdAt: nowIso(),
    };
    const effectiveSelection = AutoPackagingSelectionSchema.parse({
      ...effectiveBase,
      contentHash: hashPackagingPayload(effectiveBase),
    });
    const effectiveSelectionRef = await this.persistSupervisorArtifact({
      artifactType: "packaging_override_selection",
      organizationId: identity.organizationId,
      payload: effectiveSelection,
      sourceRefs: [selectionRef.artifactId, overrideRef.artifactId],
    });
    const context: V55WorkflowContext = {
      rootRunId: run.runId,
      missionId: run.missionId,
      organizationId: run.organizationId,
      traceId: run.traceId,
      createdBy: run.createdBy,
      sourceArtifacts: [briefRef, poolRef, effectiveSelectionRef, overrideRef, sourceVersionRef, ...variantRefs],
      requiresPublicResearch: false,
      requiresEnterpriseKnowledge: false,
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const reviewTask = planV56PackagingOverrideReview({
      context,
      packagingBriefArtifact: briefRef,
      candidatePoolArtifact: poolRef,
      effectiveSelectionArtifact: effectiveSelectionRef,
      overrideArtifact: overrideRef,
      approvedSourceVersion: sourceVersionRef,
      variantArtifacts: variantRefs,
    });
    this.runtime.dispatch(reviewTask);
    await this.runtime.flushPersistence();
    const updatedRun = await this.save({
      ...run,
      status: "RUNNING",
      currentGate: undefined,
      error: undefined,
      taskIds: [...run.taskIds, reviewTask.taskId],
      sourceArtifactIds: [...run.sourceArtifactIds, overrideRef.artifactId, effectiveSelectionRef.artifactId],
      updatedAt: nowIso(),
    });
    return { override, run: updatedRun };
  }

  async regeneratePackaging(
    runId: string,
    organizationId: string,
    researchMode: "LOCAL_CORPUS" | "PUBLIC_PATTERN_PACK" = "LOCAL_CORPUS",
  ): Promise<TeamRun> {
    const mode = PackagingResearchModeSchema.parse(researchMode);
    const run = await this.get(runId, organizationId);
    const tasks = run.taskIds.map((taskId) => this.runtime.getTask(taskId));
    if (tasks.filter((task) => task.taskType === "PACKAGING_CANDIDATE_GENERATION").length >= 2) {
      throw new ConflictError("PACKAGING_REGENERATION_LIMIT", "Packaging may be regenerated only once automatically");
    }
    const variantTasks = tasks.filter((task) => task.taskType.startsWith("VARIANT_"));
    const reviewTasks = tasks.filter((task) => task.taskType.startsWith("LIGHT_VARIANT_REVIEW_"));
    if (!variantTasks.length || !reviewTasks.length || [...variantTasks, ...reviewTasks].some((task) => task.status !== "SUCCEEDED")) {
      throw new ConflictError("PACKAGING_INPUTS_NOT_READY", "Reviewed variants are required before packaging regeneration");
    }
    const previous = await this.findRunArtifact(run, "auto_packaging_selection");
    const previousStored = previous ? await this.store.getArtifact(previous.artifactId) : undefined;
    const parsed = AutoPackagingSelectionSchema.safeParse(this.unwrapArtifactPayload(previousStored?.payload));
    return this.schedulePackaging(run, variantTasks, reviewTasks, 1, parsed.success ? parsed.data.selectionId : undefined, mode);
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
      const priorPackagingRefs = (await this.artifactsWithoutRefresh(run)).filter((ref) => [
        "packaging_brief",
        "title_candidate_pool",
        "auto_packaging_selection",
        "packaging_review_report",
        "packaging_override",
        "packaging_override_selection",
      ].includes(ref.artifactType));
      const supersession = priorPackagingRefs.length
        ? await this.persistSupervisorArtifact({
          artifactType: "packaging_supersession",
          organizationId,
          payload: {
            status: "SUPERSEDED",
            reason: "SOURCE_CONTENT_VERSION_CHANGED",
            previousArtifactIds: priorPackagingRefs.map((ref) => ref.artifactId),
            newSourceContentVersionId: version.id,
            newSourceContentHash: version.contentHash,
            createdAt: nowIso(),
          },
          sourceRefs: [...priorPackagingRefs.map((ref) => ref.artifactId), artifact.artifactId],
        })
        : undefined;
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
        sourceArtifactIds: [...new Set([
          ...run.sourceArtifactIds,
          artifact.artifactId,
          reviewEnvelope.artifactId,
          ...(supersession ? [supersession.artifactId] : []),
        ])],
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
    artifactType:
      | "perspective_contract"
      | "knowledge_snapshot"
      | "content_version"
      | "review_envelope"
      | "variant_approval_manifest"
      | "review_issue_routing"
      | "geo_seo_request"
      | "packaging_brief"
      | "packaging_feedback"
      | "packaging_override"
      | "packaging_override_selection"
      | "packaging_supersession"
      | "preference_candidate";
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
        const statuses = await Promise.all(variantReviews.map((task) => this.reviewStatus(task.taskId)));
        if (statuses.some((status) => status !== "PASS")) {
          const failed = statuses.find((status) => status && status !== "PASS") ?? "INVALID";
          return this.save({ ...run, status: "BLOCKED", error: `VARIANT_REVIEW_${failed}`, currentGate: undefined, updatedAt: nowIso() });
        }
        const packagingTasks = tasks.filter((task) => [
          "PACKAGING_CANDIDATE_GENERATION",
          "PACKAGING_AUTO_SELECTION",
          "PACKAGING_REVIEW",
          "PACKAGING_OVERRIDE_REVIEW",
        ].includes(task.taskType));
        if (!packagingTasks.length) {
          return this.schedulePackaging(run, variantTasks, variantReviews, 0);
        }
        const packagingReview = packagingTasks.filter((task) => task.taskType === "PACKAGING_REVIEW" || task.taskType === "PACKAGING_OVERRIDE_REVIEW").at(-1);
        if (!packagingReview) {
          return this.save({ ...run, status: "FAILED", error: "PACKAGING_REVIEW_MISSING", currentGate: undefined, updatedAt: nowIso() });
        }
        const packagingReviewOutput = await this.reviewOutput(packagingReview.taskId);
        const parsedPackagingReview = PackagingReviewReportSchema.safeParse(packagingReviewOutput);
        if (!parsedPackagingReview.success) {
          return this.save({ ...run, status: "FAILED", error: "PACKAGING_REVIEW_INVALID", currentGate: undefined, updatedAt: nowIso() });
        }
        if (parsedPackagingReview.data.reviewStatus !== "PASS") {
          const rounds = tasks.filter((task) => task.taskType === "PACKAGING_CANDIDATE_GENERATION").length;
          if (rounds < 2 && (parsedPackagingReview.data.p0Count > 0 || parsedPackagingReview.data.p1Count > 0)) {
            const selectionTask = packagingTasks.filter((task) => task.taskType === "PACKAGING_AUTO_SELECTION").at(-1);
            const selectionOutput = selectionTask ? await this.reviewOutput(selectionTask.taskId) : undefined;
            const selection = AutoPackagingSelectionSchema.safeParse(selectionOutput);
            const latestBriefRef = await this.findSourceArtifact([...run.sourceArtifactIds].reverse(), "packaging_brief");
            const latestBriefStored = latestBriefRef ? await this.store.getArtifact(latestBriefRef.artifactId) : undefined;
            const latestBrief = PackagingBriefSchema.safeParse(this.unwrapArtifactPayload(latestBriefStored?.payload));
            return this.schedulePackaging(
              run,
              variantTasks,
              variantReviews,
              1,
              selection.success ? selection.data.selectionId : undefined,
              latestBrief.success ? latestBrief.data.researchMode : "LOCAL_CORPUS",
            );
          }
          return this.save({ ...run, status: "BLOCKED", error: `PACKAGING_REVIEW_${parsedPackagingReview.data.reviewStatus}`, currentGate: undefined, updatedAt: nowIso() });
        }
        const allEnforcing = (await Promise.all([...variantTasks, ...variantReviews, ...packagingTasks].map((task) => this.taskWasEnforcing(task.taskId))))
          .every(Boolean);
        if (!allEnforcing) {
          return this.save({ ...run, status: "BLOCKED", error: "SHADOW_OUTPUT_CANNOT_SATISFY_VARIANT_GATE", currentGate: undefined, updatedAt: nowIso() });
        }
      }
      const hasVariants = tasks.some((task) => task.taskType.startsWith("VARIANT_"));
      let sourceArtifactIds = run.sourceArtifactIds;
      if (hasVariants) {
        const taskIds = new Set(run.taskIds);
        const taskRefs = (await this.store.listTaskResults())
          .filter((result) => taskIds.has(result.taskId))
          .flatMap((result) => result.outputArtifactRefs)
          .filter((ref) => [
            "variant_proposal",
            "variant_review_report",
            "title_candidate_pool",
            "auto_packaging_selection",
            "packaging_review_report",
          ].includes(ref.artifactType));
        const sourcePackagingRefs = (await this.resolveArtifacts(run.sourceArtifactIds, run.organizationId))
          .filter((ref) => ref.artifactType === "packaging_override" || ref.artifactType === "packaging_override_selection");
        const refs = [...new Map([...taskRefs, ...sourcePackagingRefs].map((ref) => [ref.artifactId, ref])).values()];
        const existingManifest = await this.findSourceArtifact(run.sourceArtifactIds, "variant_approval_manifest");
        const existingStored = existingManifest ? await this.store.getArtifact(existingManifest.artifactId) : undefined;
        const existingPayload = this.unwrapArtifactPayload(existingStored?.payload);
        const existingIds = new Set(Array.isArray(existingPayload?.artifacts)
          ? (existingPayload.artifacts as Array<Record<string, unknown>>).map((item) => String(item.artifactId ?? ""))
          : []);
        const manifestCurrent = existingManifest && existingIds.size === refs.length && refs.every((ref) => existingIds.has(ref.artifactId));
        if (!manifestCurrent) {
          const sourceVersion = await this.findSourceArtifact(run.sourceArtifactIds, "content_version");
          const manifest = await this.persistSupervisorArtifact({
            artifactType: "variant_approval_manifest",
            organizationId: run.organizationId,
            payload: {
              runId: run.runId,
              sourceContentVersionArtifactId: sourceVersion?.artifactId ?? null,
              artifacts: refs.map((ref) => ({ artifactId: ref.artifactId, contentHash: ref.contentHash, artifactType: ref.artifactType })),
              effectivePackagingPriority: "valid_override_then_latest_reviewed_auto_selection",
              titleHumanConfirmationGate: false,
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

  private async schedulePackaging(
    run: TeamRun,
    variantTasks: ReturnType<InternalAgentRuntime["listTasks"]>,
    variantReviewTasks: ReturnType<InternalAgentRuntime["listTasks"]>,
    revisionRound: 0 | 1,
    previousSelectionId?: string,
    researchMode: "LOCAL_CORPUS" | "PUBLIC_PATTERN_PACK" = "LOCAL_CORPUS",
  ): Promise<TeamRun> {
    const variantRefs = (await Promise.all(variantTasks.map(async (task) =>
      (await this.store.getTaskResult(task.taskId))?.outputArtifactRefs ?? []
    ))).flat().filter((ref) => ref.artifactType === "variant_proposal");
    const reviewRefs = (await Promise.all(variantReviewTasks.map(async (task) =>
      (await this.store.getTaskResult(task.taskId))?.outputArtifactRefs ?? []
    ))).flat().filter((ref) => ref.artifactType === "variant_review_report");
    if (variantRefs.length !== run.requestedChannels.length || reviewRefs.length !== run.requestedChannels.length) {
      return this.save({ ...run, status: "FAILED", error: "PACKAGING_VARIANT_INPUTS_INCOMPLETE", updatedAt: nowIso() });
    }
    const sourceVersionRef = await this.findSourceArtifact([...run.sourceArtifactIds].reverse(), "content_version");
    if (!sourceVersionRef) return this.save({ ...run, status: "FAILED", error: "PACKAGING_SOURCE_VERSION_MISSING", updatedAt: nowIso() });
    const sourceStored = await this.store.getArtifact(sourceVersionRef.artifactId);
    const sourceVersion = ContentVersionSchema.parse(this.unwrapArtifactPayload(sourceStored?.payload));
    const fullReviewTasks = run.taskIds.map((taskId) => this.runtime.getTask(taskId)).filter((task) => task.taskType === "FULL_CONTENT_REVIEW");
    const fullReviewOutput = fullReviewTasks.length ? await this.reviewOutput(fullReviewTasks.at(-1)!.taskId) : undefined;
    const perspectiveRef = await this.findSourceArtifact(run.sourceArtifactIds, "perspective_contract");
    const perspectiveStored = perspectiveRef ? await this.store.getArtifact(perspectiveRef.artifactId) : undefined;
    const perspective = this.unwrapArtifactPayload(perspectiveStored?.payload);
    const audience = Array.isArray(perspective?.audience)
      ? perspective.audience.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [];
    const sourceContentHash = /^[a-f0-9]{64}$/u.test(sourceVersion.contentHash)
      ? sourceVersion.contentHash
      : sha256(sourceVersion.body);
    const brief = PackagingBriefSchema.parse({
      packagingRequestId: newId("packaging_request"),
      missionId: run.missionId,
      organizationId: run.organizationId,
      sourceContentVersionId: sourceVersion.id,
      sourceContentHash,
      sourceReviewId: typeof fullReviewOutput?.reviewId === "string" ? fullReviewOutput.reviewId : "review_unknown",
      variantArtifactRefs: variantRefs.map((ref) => ref.artifactId),
      channels: run.requestedChannels,
      targetAudience: audience.length ? audience : ["企业决策者与产业AI关注者"],
      accountProfile: typeof perspective?.speaker === "string" && /艾氪|JovaAI/iu.test(perspective.speaker)
        ? "JOVAAI_OFFICIAL"
        : "OTHER",
      contentPromise: sourceVersion.title.trim() || "准确概括正文可兑现的核心判断",
      coreConflict: sourceVersion.title.trim() || "外部期待与企业真实业务之间的冲突",
      readerBenefit: "帮助目标受众理解问题、判断边界并获得可执行启示",
      claimBindingSnapshot: sourceVersion.claimBindingSnapshot,
      brandRules: ["JovaAI 与 JovaAI Nomos 拼写必须准确", "标题不得新增正文不存在的产品能力或客户结果"],
      forbiddenExpressions: ["JovaIAI", "Wtree Ultra", "260万亿", "必然成功", "保证提升"],
      titleCorpusSnapshot: "knowledge/title-packaging/TITLE_CORPUS_MANIFEST_V1.json",
      titlePatternPackSnapshot: "knowledge/title-packaging/TITLE_PATTERN_PACK_V1.md",
      applicablePreferenceSet: [],
      candidateCount: 60,
      revisionRound,
      ...(previousSelectionId ? { previousSelectionId } : {}),
      researchMode,
      traceId: run.traceId,
      titlePolicyVersion: "channel-packaging-policy-v1",
      createdAt: nowIso(),
    });
    const previousSelectionRef = previousSelectionId
      ? await this.findRunArtifact(run, "auto_packaging_selection", (payload) => payload.selectionId === previousSelectionId)
      : undefined;
    const packagingBriefRef = await this.persistSupervisorArtifact({
      artifactType: "packaging_brief",
      organizationId: run.organizationId,
      payload: brief,
      sourceRefs: [
        sourceVersionRef.artifactId,
        ...variantRefs.map((ref) => ref.artifactId),
        ...reviewRefs.map((ref) => ref.artifactId),
        ...(previousSelectionRef ? [previousSelectionRef.artifactId] : []),
      ],
    });
    const context: V55WorkflowContext = {
      rootRunId: run.runId,
      missionId: run.missionId,
      organizationId: run.organizationId,
      traceId: run.traceId,
      createdBy: run.createdBy,
      sourceArtifacts: [packagingBriefRef, sourceVersionRef, ...variantRefs, ...reviewRefs],
      requiresPublicResearch: false,
      requiresEnterpriseKnowledge: false,
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const packagingTasks = planV56PackagingTasks({
      context,
      packagingBriefArtifact: packagingBriefRef,
      approvedSourceVersion: sourceVersionRef,
      variantArtifacts: variantRefs,
      variantReviewArtifacts: reviewRefs,
      researchMode,
    });
    packagingTasks.forEach((task) => this.runtime.dispatch(task));
    await this.runtime.flushPersistence();
    return this.save({
      ...run,
      status: "RUNNING",
      taskIds: [...run.taskIds, ...packagingTasks.map((task) => task.taskId)],
      sourceArtifactIds: [...run.sourceArtifactIds, packagingBriefRef.artifactId],
      currentGate: undefined,
      error: undefined,
      updatedAt: nowIso(),
    });
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

  private unwrapArtifactPayload(payload: unknown): Record<string, unknown> | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const value = payload as Record<string, unknown>;
    return value.output && typeof value.output === "object"
      ? value.output as Record<string, unknown>
      : value;
  }

  private async findRunArtifact(
    run: TeamRun,
    artifactType: string,
    predicate?: (payload: Record<string, unknown>) => boolean,
  ): Promise<ArtifactRef | undefined> {
    const refs = await this.artifactsWithoutRefresh(run);
    for (const ref of [...refs].reverse()) {
      if (ref.artifactType !== artifactType) continue;
      const stored = await this.store.getArtifact(ref.artifactId);
      const payload = this.unwrapArtifactPayload(stored?.payload);
      if (payload && (!predicate || predicate(payload))) return ref;
    }
    return undefined;
  }

  private async artifactsWithoutRefresh(run: TeamRun): Promise<ArtifactRef[]> {
    const taskIds = new Set(run.taskIds);
    const outputRefs = (await this.store.listTaskResults())
      .filter((result) => taskIds.has(result.taskId))
      .flatMap((result) => result.outputArtifactRefs);
    const sourceRefs = await this.resolveArtifacts(run.sourceArtifactIds, run.organizationId);
    return [...new Map([...sourceRefs, ...outputRefs].map((ref) => [ref.artifactId, ref])).values()];
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
