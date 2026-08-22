import {
  ChannelVariantSchema,
  ClaimAuditSchema,
  AuditQuerySchema,
  AssetBriefSchema,
  BatchMissionInputSchema,
  ContentMissionInputSchema,
  CreateContentTemplateInputSchema,
  CreateSourceAttachmentInputSchema,
  GeneratedContentBundleSchema,
  ReviewDecisionInputSchema,
  ReviewRequestInputSchema,
  SkillImportInputSchema,
  SkillRegressionInputSchema,
  type AgentRun,
  type AgentRunStep,
  type AssetRights,
  type AssetBrief,
  type AuditEvent,
  type AuditQuery,
  type ChannelVariant,
  type ContentAsset,
  type ContentBatch,
  type ContentMission,
  type ContentMissionInput,
  type BatchMissionInput,
  type ContentPackage,
  type ContentTemplate,
  type ContentValidationResult,
  type ContentVersion,
  type CreateContentPackageInput,
  type CreateContentTemplateInput,
  type CreateSourceAttachmentInput,
  type CreateLocalizationInput,
  type CreateVariantInput,
  type CreateVersionInput,
  type EvidenceRequest,
  type EvidenceFulfillmentInput,
  type GeneratedAsset,
  type GenerateAssetBriefInput,
  type HostGenerationMetadata,
  type OutboxMessage,
  type Page,
  type RequestIdentity,
  type ReviewDecision,
  type ReviewDecisionInput,
  type ReviewRequest,
  type ReviewRequestInput,
  type SkillImportInput,
  type SkillPackage,
  type SkillRegressionInput,
  type SkillVersion,
  type SourceAttachment,
  type PreparedSourceAttachment,
} from "@risen/content-contracts";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { ConflictError, NotFoundError } from "./errors.js";
import { protectSensitiveData } from "./data-protection.js";
import { containsForbiddenDeliveryFields } from "./network-boundary.js";
import type {
  ContentRepository,
  ContextPort,
  AttachmentPort,
  GenerateObjectRequest,
  HandoffPort,
  HostGenerationResult,
  HostImagePort,
  HostModelPort,
  PolicyPort,
  ReviewPort,
  GovernanceGatePort,
} from "./ports.js";
import { assertContentTransition, canTransition } from "./state-machine.js";
import { clone, newId, nowIso, sha256 } from "./utils.js";
import { validateContentVersion } from "./validation.js";

export interface ContentServiceDependencies {
  repository: ContentRepository;
  hostModel: HostModelPort;
  context: ContextPort;
  policy: PolicyPort;
  review: ReviewPort;
  handoff: HandoffPort;
  hostImage?: HostImagePort;
  attachments?: AttachmentPort;
  governanceGate: GovernanceGatePort;
}

const stepNames: AgentRunStep["name"][] = [
  "context",
  "research",
  "matching",
  "writing",
  "post_write",
  "quality",
];

export class ContentService {
  constructor(private readonly dependencies: ContentServiceDependencies) {}

  async createMission(
    rawInput: ContentMissionInput,
    identity: RequestIdentity,
  ): Promise<{ mission: ContentMission; run: AgentRun }> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const input = ContentMissionInputSchema.parse({
      ...rawInput,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
    });
    let templateSnapshot: ContentMission["templateSnapshot"];
    if (input.templateId) {
      const template = await this.dependencies.repository.getTemplate(
        input.templateId,
        identity.organizationId,
      );
      if (!template) throw new NotFoundError("ContentTemplate", input.templateId);
      if (template.status !== "ACTIVE") {
        throw new ConflictError(
          "TEMPLATE_NOT_ACTIVE",
          "Only an active content template can be used",
        );
      }
      const unsupportedOutputs = input.requestedOutputs.filter(
        (item) => !template.supportedOutputs.includes(item),
      );
      const unsupportedChannels = input.channels.filter(
        (item) => !template.supportedChannels.includes(item),
      );
      const unsupportedLocales = input.locales.filter(
        (item) => !template.supportedLocales.includes(item),
      );
      if (
        unsupportedOutputs.length ||
        unsupportedChannels.length ||
        unsupportedLocales.length
      ) {
        throw new ConflictError(
          "TEMPLATE_SCOPE_MISMATCH",
          "Mission outputs, channels or locales exceed the template scope",
        );
      }
      const variables = Object.fromEntries(
        template.variables.map((variable) => {
          const value =
            input.templateVariables?.[variable.name] ?? variable.defaultValue;
          if (variable.required && !value) {
            throw new ConflictError(
              "TEMPLATE_VARIABLE_REQUIRED",
              `Template variable ${variable.name} is required`,
            );
          }
          return [variable.name, value ?? ""];
        }),
      );
      const renderedInstructions = template.instructions.replace(
        /\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g,
        (_match, name: string) => variables[name] ?? "",
      );
      templateSnapshot = {
        templateId: template.id,
        revision: template.revision,
        name: template.name,
        renderedInstructions,
        variables,
      };
    }
    const attachmentSnapshots: ContentMission["attachmentSnapshots"] = [];
    for (const attachmentId of input.attachmentIds ?? []) {
      const attachment = await this.dependencies.repository.getAttachment(
        attachmentId,
        identity.organizationId,
      );
      if (!attachment) throw new NotFoundError("SourceAttachment", attachmentId);
      if (attachment.status !== "READY" || attachment.extractedText === undefined) {
        throw new ConflictError(
          "ATTACHMENT_NOT_READY",
          `Attachment ${attachmentId} has not passed scanning and extraction`,
        );
      }
      attachmentSnapshots.push({
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        checksum: attachment.checksum,
        sourceUse: attachment.sourceUse,
        extractedText: attachment.extractedText,
      });
    }
    const timestamp = nowIso();
    const traceId = newId("trace");
    const evidence = input.evidence.map((item) => ({
      ...item,
      id: item.id ?? newId("evidence"),
    }));
    const claims = input.claims.map((item) => ({
      ...item,
      id: item.id ?? newId("claim"),
    }));
    const mission: ContentMission = {
      id: newId("mission"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "DRAFT",
      title: input.title,
      objective: input.objective,
      strategy: input.strategy,
      audience: input.audience,
      message: input.message,
      contentPlan: input.contentPlan,
      claims,
      evidence,
      brandRules: input.brandRules,
      policies: input.policies,
      requestedOutputs: input.requestedOutputs,
      channels: input.channels,
      locales: input.locales,
      highRisk: input.highRisk,
      ...(templateSnapshot ? { templateSnapshot } : {}),
      attachmentSnapshots,
    };
    const run: AgentRun = {
      id: newId("run"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "QUEUED",
      missionId: mission.id,
      steps: stepNames.map((name) => ({
        id: newId("step"),
        name,
        status: "PENDING",
        metadata: {},
      })),
    };

    await this.dependencies.repository.saveMission(mission);
    await this.dependencies.repository.saveRun(run);
    return { mission, run };
  }

  async listMissions(identity: RequestIdentity): Promise<Page<ContentMission>> {
    return this.dependencies.repository.listMissions(identity);
  }

  async listAssets(identity: RequestIdentity): Promise<Page<ContentAsset>> {
    return this.dependencies.repository.listAssets(identity);
  }

  async createBatch(
    rawInput: BatchMissionInput,
    identity: RequestIdentity,
  ): Promise<{ batch: ContentBatch; runs: AgentRun[] }> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const input = BatchMissionInputSchema.parse(rawInput);
    const created = [];
    for (const missionInput of input.missions) {
      created.push(await this.createMission(missionInput, identity));
    }
    const timestamp = nowIso();
    const batchId = newId("batch");
    const runs = created.map((item) => ({
      ...item.run,
      batchId,
      updatedAt: timestamp,
    }));
    for (const run of runs) await this.dependencies.repository.saveRun(run);
    const batch: ContentBatch = {
      id: batchId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: newId("trace"),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "QUEUED",
      missionIds: created.map((item) => item.mission.id),
      runIds: runs.map((item) => item.id),
      total: runs.length,
      completed: 0,
      failed: 0,
    };
    await this.dependencies.repository.saveBatch(batch);
    return { batch, runs };
  }

  async getBatch(batchId: string, identity: RequestIdentity): Promise<ContentBatch> {
    const batch = await this.dependencies.repository.getBatch(
      batchId,
      identity.organizationId,
    );
    if (!batch) throw new NotFoundError("ContentBatch", batchId);
    return batch;
  }

  async listBatches(identity: RequestIdentity): Promise<Page<ContentBatch>> {
    return this.dependencies.repository.listBatches(identity);
  }

  async cancelBatch(
    batchId: string,
    identity: RequestIdentity,
  ): Promise<ContentBatch> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const batch = await this.getBatch(batchId, identity);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(batch.status)) return batch;
    const runs = await Promise.all(
      batch.runIds.map((runId) =>
        this.dependencies.repository.getRun(runId, identity.organizationId),
      ),
    );
    if (
      runs.some(
        (run) => run && !["QUEUED", "CANCELLED"].includes(run.status),
      )
    ) {
      throw new ConflictError(
        "BATCH_NOT_CANCELLABLE",
        "A batch can only be cancelled before any run starts",
      );
    }
    for (const runId of batch.runIds) {
      await this.dependencies.repository.cancelQueuedRun(
        runId,
        identity.organizationId,
      );
    }
    const cancelled: ContentBatch = {
      ...batch,
      status: "CANCELLED",
      updatedAt: nowIso(),
    };
    await this.dependencies.repository.saveBatch(cancelled);
    return cancelled;
  }

  async createTemplate(
    rawInput: CreateContentTemplateInput,
    identity: RequestIdentity,
  ): Promise<ContentTemplate> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const input = CreateContentTemplateInputSchema.parse(rawInput);
    const parent = input.parentTemplateId
      ? await this.dependencies.repository.getTemplate(
          input.parentTemplateId,
          identity.organizationId,
        )
      : undefined;
    if (input.parentTemplateId && !parent) {
      throw new NotFoundError("ContentTemplate", input.parentTemplateId);
    }
    const timestamp = nowIso();
    const template: ContentTemplate = {
      id: newId("template"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: newId("trace"),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "DRAFT",
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      variables: input.variables,
      supportedOutputs: input.supportedOutputs,
      supportedChannels: input.supportedChannels,
      supportedLocales: input.supportedLocales,
      revision: (parent?.revision ?? 0) + 1,
      ...(parent ? { parentTemplateId: parent.id } : {}),
    };
    await this.dependencies.repository.saveTemplate(template);
    return template;
  }

  async activateTemplate(
    templateId: string,
    identity: RequestIdentity,
  ): Promise<ContentTemplate> {
    this.assertRole(identity, ["ADMIN"]);
    const template = await this.dependencies.repository.getTemplate(
      templateId,
      identity.organizationId,
    );
    if (!template) throw new NotFoundError("ContentTemplate", templateId);
    if (template.status === "RETIRED") {
      throw new ConflictError(
        "TEMPLATE_RETIRED",
        "A retired template cannot be reactivated",
      );
    }
    if (template.parentTemplateId) {
      const parent = await this.dependencies.repository.getTemplate(
        template.parentTemplateId,
        identity.organizationId,
      );
      if (parent?.status === "ACTIVE") {
        await this.dependencies.repository.saveTemplate({
          ...parent,
          status: "RETIRED",
          updatedAt: nowIso(),
        });
      }
    }
    const timestamp = nowIso();
    const active: ContentTemplate = {
      ...template,
      status: "ACTIVE",
      activatedAt: timestamp,
      activatedBy: identity.userId,
      updatedAt: timestamp,
    };
    await this.dependencies.repository.saveTemplate(active);
    return active;
  }

  async listTemplates(identity: RequestIdentity): Promise<Page<ContentTemplate>> {
    this.assertRole(identity, ["ADMIN", "CREATOR", "REVIEWER", "VIEWER"]);
    return this.dependencies.repository.listTemplates(identity);
  }

  async listAuditEvents(
    rawQuery: AuditQuery,
    identity: RequestIdentity,
  ): Promise<AuditEvent[]> {
    this.assertRole(identity, ["ADMIN"]);
    const query = AuditQuerySchema.parse(rawQuery);
    return this.dependencies.repository.listAuditEvents(query, identity);
  }

  async prepareAttachment(
    rawInput: CreateSourceAttachmentInput,
    identity: RequestIdentity,
  ): Promise<PreparedSourceAttachment> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    if (!this.dependencies.attachments) {
      throw new ConflictError(
        "ATTACHMENT_RUNTIME_UNAVAILABLE",
        "The deployment host has not provided secure attachment storage and scanning",
      );
    }
    const input = CreateSourceAttachmentInputSchema.parse(rawInput);
    const attachmentId = newId("attachment");
    const traceId = newId("trace");
    const prepared = await this.dependencies.attachments.prepareUpload({
      attachmentId,
      organizationId: identity.organizationId,
      input,
      traceId,
    });
    const timestamp = nowIso();
    const attachment: SourceAttachment = {
      id: attachmentId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "UPLOAD_PENDING",
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksum: input.checksum.toLocaleLowerCase(),
      sourceUse: input.sourceUse,
      objectKey: prepared.objectKey,
      uploadExpiresAt: prepared.uploadExpiresAt,
    };
    await this.dependencies.repository.saveAttachment(attachment);
    return {
      attachment,
      uploadUrl: prepared.uploadUrl,
      requiredHeaders: prepared.requiredHeaders,
    };
  }

  async completeAttachment(
    attachmentId: string,
    identity: RequestIdentity,
  ): Promise<SourceAttachment> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    if (!this.dependencies.attachments) {
      throw new ConflictError(
        "ATTACHMENT_RUNTIME_UNAVAILABLE",
        "The deployment host has not provided secure attachment storage and scanning",
      );
    }
    const attachment = await this.dependencies.repository.getAttachment(
      attachmentId,
      identity.organizationId,
    );
    if (!attachment) throw new NotFoundError("SourceAttachment", attachmentId);
    if (attachment.status === "READY" || attachment.status === "REJECTED") {
      return attachment;
    }
    const quarantined: SourceAttachment = {
      ...attachment,
      status: "QUARANTINED",
      updatedAt: nowIso(),
    };
    await this.dependencies.repository.saveAttachment(quarantined);
    const result = await this.dependencies.attachments.scanAndExtract({
      attachmentId: attachment.id,
      organizationId: attachment.organizationId,
      objectKey: attachment.objectKey,
      expectedChecksum: attachment.checksum,
      expectedByteSize: attachment.byteSize,
      mimeType: attachment.mimeType,
      traceId: attachment.traceId,
    });
    const checksumMatches =
      result.observedChecksum.toLocaleLowerCase() === attachment.checksum;
    const sizeMatches = result.observedByteSize === attachment.byteSize;
    const accepted =
      result.clean &&
      checksumMatches &&
      sizeMatches &&
      result.extractedText !== undefined;
    const completed: SourceAttachment = {
      ...quarantined,
      status: accepted ? "READY" : "REJECTED",
      updatedAt: nowIso(),
      scan: {
        engine: result.engine,
        signatureVersion: result.signatureVersion,
        scannedAt: nowIso(),
        clean: result.clean,
        observedChecksum: result.observedChecksum,
        observedByteSize: result.observedByteSize,
      },
      ...(accepted ? { extractedText: result.extractedText } : {}),
      ...(!accepted
        ? {
            rejectionReason:
              result.rejectionReason ??
              (!checksumMatches
                ? "CHECKSUM_MISMATCH"
                : !sizeMatches
                  ? "SIZE_MISMATCH"
                  : !result.clean
                    ? "MALWARE_DETECTED"
                    : "TEXT_EXTRACTION_FAILED"),
          }
        : {}),
    };
    await this.dependencies.repository.saveAttachment(completed);
    return completed;
  }

  async listAttachments(
    identity: RequestIdentity,
  ): Promise<Page<SourceAttachment>> {
    this.assertRole(identity, ["ADMIN", "CREATOR", "REVIEWER", "VIEWER"]);
    return this.dependencies.repository.listAttachments(identity);
  }

  async listVersions(
    assetId: string,
    identity: RequestIdentity,
  ): Promise<ContentVersion[]> {
    await this.getAsset(assetId, identity);
    return this.dependencies.repository.listVersions(
      assetId,
      identity.organizationId,
    );
  }

  async getRun(runId: string, identity: RequestIdentity): Promise<AgentRun> {
    const run = await this.dependencies.repository.getRun(runId, identity.organizationId);
    if (!run) {
      throw new NotFoundError("AgentRun", runId);
    }
    return run;
  }

  async cancelQueuedRun(
    runId: string,
    identity: RequestIdentity,
  ): Promise<AgentRun> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const run = await this.getRun(runId, identity);
    if (run.status === "CANCELLED") return run;
    const cancelled = await this.dependencies.repository.cancelQueuedRun(
      runId,
      identity.organizationId,
    );
    if (!cancelled) {
      throw new ConflictError(
        "RUN_NOT_CANCELLABLE",
        "Only a queued run can be cancelled safely",
      );
    }
    await this.refreshBatch(cancelled);
    return cancelled;
  }

  async executeRun(runId: string, identity: RequestIdentity): Promise<AgentRun> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const observedRun = await this.getRun(runId, identity);
    if (!["QUEUED", "RUNNING", "FAILED"].includes(observedRun.status)) {
      throw new ConflictError(
        "RUN_NOT_EXECUTABLE",
        `Run ${observedRun.id} is ${observedRun.status}`,
      );
    }
    const mission = await this.getMission(observedRun.missionId, identity);
    await this.dependencies.governanceGate.assertMissionReady(mission);
    const run = await this.dependencies.repository.claimRun(
      runId,
      identity.organizationId,
    );
    if (!run) {
      throw new ConflictError(
        "RUN_ALREADY_CLAIMED",
        `Run ${runId} is already executing`,
      );
    }

    const recoveringStalledRun = observedRun.status === "RUNNING";
    run.updatedAt = nowIso();
    if (
      !recoveringStalledRun ||
      (!mission.currentAssetId &&
        canTransition(mission.status, "GENERATING"))
    ) {
      this.transitionMission(mission, "GENERATING");
    }
    await this.dependencies.repository.saveRun(run);
    await this.dependencies.repository.saveMission(mission);

    try {
      await this.runStep(run, "context", async () => {
        const context = await this.dependencies.context.resolveMissionContext(mission);
        return { contextKeys: Object.keys(context) };
      });

      const unsupportedClaims = this.findUnsupportedClaims(mission);
      await this.runStep(run, "research", async () => ({
        evidenceCount: mission.evidence.length,
        unsupportedClaimCount: unsupportedClaims.length,
      }));

      if (unsupportedClaims.length > 0) {
        const existingRequests =
          await this.dependencies.repository.listEvidenceRequests(
            mission.id,
            identity.organizationId,
          );
        const requestedClaimIds = unsupportedClaims.map((item) => item.id).sort();
        const evidenceRequest =
          existingRequests.find(
            (item) =>
              item.status === "OPEN" &&
              [...item.claimIds].sort().join(":") === requestedClaimIds.join(":"),
          ) ?? this.makeEvidenceRequest(mission, unsupportedClaims, identity);
        if (!existingRequests.some((item) => item.id === evidenceRequest.id)) {
          await this.dependencies.repository.saveEvidenceRequest(
            evidenceRequest,
            this.makeOutboxMessage(
              "EVIDENCE_REQUEST",
              "AGT-RSN-003",
              { evidenceRequest },
              identity,
              mission.traceId,
              evidenceRequest.id,
            ),
          );
        }
        this.transitionMission(mission, "EVIDENCE_REQUIRED");
        run.status = "WAITING_EVIDENCE";
        run.updatedAt = nowIso();
        await this.dependencies.repository.saveMission(mission);
        await this.dependencies.repository.saveRun(run);
        await this.refreshBatch(run);
        return run;
      }

      await this.runStep(run, "matching", async () => ({
        channels: mission.channels,
        locales: mission.locales,
        requestedOutputs: mission.requestedOutputs,
      }));

      const recoveredAsset =
        await this.dependencies.repository.getAssetByMissionId(
          mission.id,
          identity.organizationId,
        );
      let bundle: ReturnType<typeof GeneratedContentBundleSchema.parse> | undefined =
        recoveredAsset?.bundle;
      let generationMetadata: HostGenerationMetadata | undefined;
      const writingStep = run.steps.find((step) => step.name === "writing");
      if (recoveredAsset && writingStep) {
        writingStep.status = "COMPLETED";
        writingStep.completedAt ??= nowIso();
        mission.currentAssetId = recoveredAsset.id;
      } else {
        if (writingStep?.status === "COMPLETED") {
          writingStep.status = "PENDING";
          writingStep.completedAt = undefined;
        }
        await this.runStep(run, "writing", async () => {
          const context = await this.dependencies.context.resolveMissionContext(mission);
          const generated = await this.generateProtected({
            schemaName: "content_bundle",
            systemPrompt: this.bundleSystemPrompt(),
            input: { mission, context },
            jsonSchema: z.toJSONSchema(GeneratedContentBundleSchema),
            traceId: mission.traceId,
            requestId: `${run.id}:writing`,
            idempotencyKey: `${run.id}:content_bundle:v1`,
            promptVersion: "content-bundle-v5.5",
            maxOutputTokens: 16_000,
            timeoutMs: 120_000,
          });
          const proposedBundle = GeneratedContentBundleSchema.parse(generated.output);
          // V5.5 defers all channel/localization work until an enterprise
          // human has approved the immutable source version.
          bundle = {
            ...proposedBundle,
            variants: [],
            localizations: [],
          };
          generationMetadata = generated.metadata;
          this.assertBundleClaims(bundle, mission);
          return {
            primaryChannel: bundle.primary.channel,
            variantCount: 0,
            localizationCount: 0,
            deferredLegacyVariantCount:
              proposedBundle.variants.length + proposedBundle.localizations.length,
          };
        });
      }

      if (!bundle) {
        throw new Error("Model did not produce a content bundle");
      }

      const created = recoveredAsset
        ? {
            asset: recoveredAsset,
            version: await this.getVersion(
              recoveredAsset.currentVersionId,
              identity,
            ),
          }
        : this.createInitialAsset(
            mission,
            bundle,
            identity,
            generationMetadata,
          );
      if (!recoveredAsset) {
        await this.dependencies.repository.saveVersion(created.version);
        await this.dependencies.repository.saveAsset(created.asset);
      }
      mission.currentAssetId = created.asset.id;
      mission.updatedAt = nowIso();
      await this.dependencies.repository.saveMission(mission);

      await this.runStep(run, "post_write", async () => {
        await this.dependencies.governanceGate.assertGeneratedContent(
          mission,
          created.version.body,
        );
        return {
          governanceGate: "PASSED",
          assetId: created.asset.id,
          versionId: created.version.id,
          contentHash: created.version.contentHash,
        };
      });

      await this.runStep(run, "quality", async () => {
        const validation = await this.validateAssetInternal(
          created.asset,
          created.version,
          mission,
          identity,
        );
        return {
          validationId: validation.id,
          status: validation.status,
          blockingIssues: validation.issues.filter(
            (item) => item.severity === "BLOCKING",
          ).length,
        };
      });

      const persistedAsset = await this.getAsset(created.asset.id, identity);
      run.status =
        persistedAsset.status === "REVIEW_REQUIRED" ? "WAITING_REVIEW" : "COMPLETED";
      run.updatedAt = nowIso();
      await this.dependencies.repository.saveRun(run);
      await this.refreshBatch(run);
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.status = "FAILED";
      run.failureReason = message;
      run.updatedAt = nowIso();
      const activeStep = run.steps.find((step) => step.status === "RUNNING");
      if (activeStep) {
        activeStep.status = "FAILED";
        activeStep.error = message;
        activeStep.completedAt = nowIso();
      }
      mission.status = "FAILED";
      mission.failureReason = message;
      mission.updatedAt = nowIso();
      await this.dependencies.repository.saveRun(run);
      await this.dependencies.repository.saveMission(mission);
      await this.refreshBatch(run);
      throw error;
    }
  }

  async createVersion(
    assetId: string,
    input: CreateVersionInput,
    identity: RequestIdentity,
  ): Promise<ContentVersion> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const asset = await this.getAsset(assetId, identity);
    const current = await this.getVersion(asset.currentVersionId, identity);
    const mission = await this.getMission(asset.missionId, identity);
    if (asset.status === "ARCHIVED") {
      throw new ConflictError("ASSET_ARCHIVED", "Archived content cannot be edited");
    }

    const versions = await this.dependencies.repository.listVersions(
      asset.id,
      identity.organizationId,
    );
    const sanitizedRichBody = input.richBody
      ? sanitizeHtml(input.richBody, {
          allowedTags: [
            "p",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "strong",
            "em",
            "s",
            "blockquote",
            "ul",
            "ol",
            "li",
            "pre",
            "code",
            "br",
            "hr",
            "a",
          ],
          allowedAttributes: {
            a: ["href", "title", "target", "rel"],
          },
          allowedSchemes: ["http", "https", "mailto"],
          disallowedTagsMode: "discard",
        })
      : undefined;
    const timestamp = nowIso();
    const version: ContentVersion = {
      id: newId("version"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: asset.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "REVISION_REQUIRED",
      assetId: asset.id,
      versionNumber: versions.length + 1,
      parentVersionId: current.id,
      title: input.title,
      body: input.body,
      bodyFormat: input.bodyFormat,
      richBody: sanitizedRichBody,
      contentHash: sha256(
        input.bodyFormat === "tiptap_html" && sanitizedRichBody
          ? sanitizedRichBody
          : input.body,
      ),
      changeReason: input.changeReason,
      changedBy: identity.userId,
      generationContextSnapshot: clone(current.generationContextSnapshot),
      claimBindingSnapshot: this.claimSnapshot(mission),
    };
    await this.dependencies.repository.saveVersion(version);

    asset.currentVersionId = version.id;
    asset.versionIds = [...asset.versionIds, version.id];
    asset.bundle.primary = {
      ...asset.bundle.primary,
      title: version.title,
      body: version.body,
    };
    asset.bundle.variants = [];
    asset.bundle.localizations = [];
    asset.bundle.assetBriefs = [];
    asset.status = "REVISION_REQUIRED";
    asset.validationId = undefined;
    asset.activeReviewId = undefined;
    asset.updatedAt = timestamp;
    await this.dependencies.repository.saveAsset(asset);

    mission.status = "REVISION_REQUIRED";
    mission.updatedAt = timestamp;
    await this.dependencies.repository.saveMission(mission);
    return version;
  }

  async createVariant(
    assetId: string,
    input: CreateVariantInput,
    identity: RequestIdentity,
  ): Promise<ChannelVariant> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const asset = await this.getAsset(assetId, identity);
    const version = await this.getVersion(input.versionId, identity);
    this.assertVersionBelongsToAsset(version, asset);
    if (asset.currentVersionId !== version.id) {
      throw new ConflictError(
        "STALE_VERSION",
        "Variants can only be generated from the current content version",
      );
    }
    if (asset.status !== "APPROVED" || !asset.activeReviewId) {
      throw new ConflictError(
        "SOURCE_DRAFT_APPROVAL_REQUIRED",
        "Variants require an enterprise-human-approved current source version",
      );
    }
    const sourceReview = await this.dependencies.repository.getReview(
      asset.activeReviewId,
      identity.organizationId,
    );
    if (!sourceReview || sourceReview.status !== "APPROVED" || sourceReview.reviewerType !== "HUMAN") {
      throw new ConflictError(
        "SOURCE_DRAFT_APPROVAL_REQUIRED",
        "Balala cannot generate variants from an agent-only or pending review",
      );
    }
    const generated = await this.generateProtected({
      schemaName: "channel_variant",
      systemPrompt:
        "Create a content-format variant. Return only the requested JSON. Do not add publishing, account, scheduling or performance fields.",
      input: { version, channel: input.channel, locale: input.locale, audienceAdjustment: input.audienceAdjustment },
      jsonSchema: z.toJSONSchema(ChannelVariantSchema),
      traceId: asset.traceId,
      requestId: `${asset.id}:variant:${input.channel}:${input.locale}`,
      idempotencyKey: `${version.id}:variant:${input.channel}:${input.locale}`,
      promptVersion: "channel-variant-v1",
      maxOutputTokens: 8_000,
      timeoutMs: 90_000,
    });
    const variant: ChannelVariant = {
      ...ChannelVariantSchema.parse(generated.output),
      derivedFromVersionId: version.id,
    };
    this.assertVariantClaims(
      variant,
      await this.getMission(asset.missionId, identity),
    );
    asset.bundle.variants = [...asset.bundle.variants, variant];
    asset.updatedAt = nowIso();
    await this.dependencies.repository.saveAsset(asset);
    return variant;
  }

  async createLocalization(
    assetId: string,
    input: CreateLocalizationInput,
    identity: RequestIdentity,
  ): Promise<ChannelVariant> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const asset = await this.getAsset(assetId, identity);
    const version = await this.getVersion(input.versionId, identity);
    this.assertVersionBelongsToAsset(version, asset);
    if (asset.currentVersionId !== version.id) {
      throw new ConflictError(
        "STALE_VERSION",
        "Localizations can only be generated from the current content version",
      );
    }
    if (asset.status !== "APPROVED" || !asset.activeReviewId) {
      throw new ConflictError(
        "SOURCE_DRAFT_APPROVAL_REQUIRED",
        "Localizations require an enterprise-human-approved current source version",
      );
    }
    const sourceReview = await this.dependencies.repository.getReview(
      asset.activeReviewId,
      identity.organizationId,
    );
    if (!sourceReview || sourceReview.status !== "APPROVED" || sourceReview.reviewerType !== "HUMAN") {
      throw new ConflictError(
        "SOURCE_DRAFT_APPROVAL_REQUIRED",
        "Localizations cannot derive from an agent-only or pending review",
      );
    }
    const generated = await this.generateProtected({
      schemaName: "localization",
      systemPrompt:
        "Localize the content culturally and linguistically. Return only JSON and preserve claim meaning.",
      input: { version, locale: input.locale, culturalNotes: input.culturalNotes },
      jsonSchema: z.toJSONSchema(ChannelVariantSchema),
      traceId: asset.traceId,
      requestId: `${asset.id}:localization:${input.locale}`,
      idempotencyKey: `${version.id}:localization:${input.locale}`,
      promptVersion: "localization-v1",
      maxOutputTokens: 8_000,
      timeoutMs: 90_000,
    });
    const localization: ChannelVariant = {
      ...ChannelVariantSchema.parse(generated.output),
      derivedFromVersionId: version.id,
    };
    this.assertVariantClaims(
      localization,
      await this.getMission(asset.missionId, identity),
    );
    asset.bundle.localizations = [...asset.bundle.localizations, localization];
    asset.updatedAt = nowIso();
    await this.dependencies.repository.saveAsset(asset);
    return localization;
  }

  async generateAssetBrief(
    contentAssetId: string,
    input: GenerateAssetBriefInput,
    identity: RequestIdentity,
  ): Promise<AssetBrief> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const asset = await this.getAsset(contentAssetId, identity);
    const version = await this.getVersion(input.versionId, identity);
    this.assertVersionBelongsToAsset(version, asset);
    if (asset.currentVersionId !== version.id) {
      throw new ConflictError(
        "STALE_VERSION",
        "Asset briefs can only be generated from the current content version",
      );
    }
    const generated = await this.generateProtected({
      schemaName: "asset_brief",
      systemPrompt: [
        "Create a visual-production brief for the supplied content version.",
        "Do not include platform credentials, publishing instructions or unlicensed source assets.",
        "Return JSON only.",
      ].join("\n"),
      input: {
        version,
        assetType: input.assetType,
        purpose: input.purpose,
        aspectRatio: input.aspectRatio,
      },
      jsonSchema: z.toJSONSchema(AssetBriefSchema),
      traceId: asset.traceId,
      requestId: `${asset.id}:asset-brief:${input.assetType}:${version.id}`,
      idempotencyKey: `${version.id}:asset-brief:${input.assetType}:${input.aspectRatio}`,
      promptVersion: "asset-brief-v1",
      maxOutputTokens: 4_000,
      timeoutMs: 60_000,
    });
    const brief: AssetBrief = {
      ...AssetBriefSchema.parse(generated.output),
      assetType: input.assetType,
      purpose: input.purpose,
      aspectRatio: input.aspectRatio,
      derivedFromVersionId: version.id,
    };
    asset.bundle.assetBriefs = [...asset.bundle.assetBriefs, brief];
    asset.updatedAt = nowIso();
    await this.dependencies.repository.saveAsset(asset);
    return brief;
  }

  async generateAsset(
    contentAssetId: string,
    briefIndex: number,
    identity: RequestIdentity,
  ): Promise<GeneratedAsset> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const contentAsset = await this.getAsset(contentAssetId, identity);
    const brief = contentAsset.bundle.assetBriefs[briefIndex];
    if (!brief) {
      throw new NotFoundError("AssetBrief", String(briefIndex));
    }
    if (brief.derivedFromVersionId !== contentAsset.currentVersionId) {
      throw new ConflictError(
        "STALE_ASSET_BRIEF",
        "Visual assets can only be generated from a brief for the current content version",
      );
    }
    if (!this.dependencies.hostImage) {
      throw new ConflictError(
        "HOST_IMAGE_CAPABILITY_UNAVAILABLE",
        "The deployment host does not expose image generation; no prototype asset was created",
      );
    }
    const timestamp = nowIso();
    const base: GeneratedAsset = {
      id: newId("generated_asset"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: contentAsset.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "PENDING",
      contentAssetId,
      derivedFromVersionId: contentAsset.currentVersionId,
      assetBrief: brief,
      rights: {
        status: "PENDING",
        restrictions: [],
      },
    };
    await this.dependencies.repository.saveGeneratedAsset(base);
    try {
      const generated = await this.dependencies.hostImage.generate({
        prompt: brief.prompt,
        aspectRatio: brief.aspectRatio,
        traceId: contentAsset.traceId,
      });
      const ready: GeneratedAsset = {
        ...base,
        status: "GENERATED",
        uri: generated.uri,
        mimeType: generated.mimeType,
        checksum: generated.checksum,
        updatedAt: nowIso(),
      };
      await this.dependencies.repository.saveGeneratedAsset(ready);
      return ready;
    } catch (error) {
      await this.dependencies.repository.saveGeneratedAsset({
        ...base,
        status: "FAILED",
        updatedAt: nowIso(),
      });
      throw error;
    }
  }

  async updateAssetRights(
    generatedAssetId: string,
    rights: AssetRights,
    identity: RequestIdentity,
  ): Promise<GeneratedAsset> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const generated = await this.dependencies.repository.getGeneratedAsset(
      generatedAssetId,
      identity.organizationId,
    );
    if (!generated) {
      throw new NotFoundError("GeneratedAsset", generatedAssetId);
    }
    if (
      rights.status === "CLEARED" &&
      rights.expiresAt &&
      Date.parse(rights.expiresAt) <= Date.now()
    ) {
      throw new ConflictError(
        "ASSET_RIGHTS_EXPIRED",
        "Expired rights cannot mark an asset ready",
      );
    }
    const updated: GeneratedAsset = {
      ...generated,
      rights,
      status: rights.status === "CLEARED" ? "READY" : generated.status,
      updatedAt: nowIso(),
    };
    await this.dependencies.repository.saveGeneratedAsset(updated);
    return updated;
  }

  async validateAsset(
    assetId: string,
    identity: RequestIdentity,
  ): Promise<ContentValidationResult> {
    this.assertRole(identity, ["ADMIN", "CREATOR", "REVIEWER"]);
    const asset = await this.getAsset(assetId, identity);
    const version = await this.getVersion(asset.currentVersionId, identity);
    const mission = await this.getMission(asset.missionId, identity);
    return this.validateAssetInternal(asset, version, mission, identity);
  }

  async createEvidenceRequest(
    missionId: string,
    questions: string[],
    claimIds: string[],
    identity: RequestIdentity,
  ): Promise<EvidenceRequest> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const mission = await this.getMission(missionId, identity);
    const knownClaimIds = new Set(mission.claims.map((item) => item.id));
    if (claimIds.some((id) => !knownClaimIds.has(id))) {
      throw new ConflictError("UNKNOWN_CLAIM", "Evidence request contains an unknown claim");
    }
    const value = this.makeEvidenceRequest(
      mission,
      mission.claims.filter((item) => claimIds.includes(item.id)),
      identity,
      questions,
    );
    const existing = (
      await this.dependencies.repository.listEvidenceRequests(
        mission.id,
        identity.organizationId,
      )
    ).find(
      (item) =>
        item.status === "OPEN" &&
        [...item.claimIds].sort().join(":") ===
          [...value.claimIds].sort().join(":"),
    );
    if (existing) return existing;
    await this.dependencies.repository.saveEvidenceRequest(
      value,
      this.makeOutboxMessage(
        "EVIDENCE_REQUEST",
        "AGT-RSN-003",
        { evidenceRequest: value },
        identity,
        mission.traceId,
        value.id,
      ),
    );
    return value;
  }

  async fulfillEvidenceRequest(
    requestId: string,
    input: EvidenceFulfillmentInput,
    identity: RequestIdentity,
  ): Promise<{ evidenceRequest: EvidenceRequest; run: AgentRun }> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const request = await this.dependencies.repository.getEvidenceRequest(
      requestId,
      identity.organizationId,
    );
    if (!request) throw new NotFoundError("EvidenceRequest", requestId);
    const run = await this.dependencies.repository.getRunByMissionId(
      request.missionId,
      identity.organizationId,
    );
    if (!run) throw new NotFoundError("AgentRun", request.missionId);
    if (request.status === "FULFILLED") {
      if (request.fulfillmentIdempotencyKey !== input.idempotencyKey) {
        throw new ConflictError(
          "EVIDENCE_REQUEST_ALREADY_FULFILLED",
          "EvidenceRequest was fulfilled with another idempotency key",
        );
      }
      return { evidenceRequest: request, run };
    }
    const mission = await this.getMission(request.missionId, identity);
    const requestedClaims = new Set(request.claimIds);
    const suppliedEvidence = new Map(input.evidence.map((item) => [item.id, item]));
    for (const binding of input.claimBindings) {
      if (
        !requestedClaims.has(binding.claimId) ||
        binding.evidenceIds.some((id) => !suppliedEvidence.has(id))
      ) {
        throw new ConflictError(
          "INVALID_EVIDENCE_FULFILLMENT",
          "Fulfillment contains an unrequested Claim or unknown Evidence",
        );
      }
    }
    const existingEvidence = new Map(
      mission.evidence.map((item) => [item.id, item]),
    );
    input.evidence.forEach((item) => existingEvidence.set(item.id, item));
    mission.evidence = [...existingEvidence.values()];
    mission.claims = mission.claims.map((claim) => {
      const binding = input.claimBindings.find(
        (item) => item.claimId === claim.id,
      );
      return binding
        ? {
            ...claim,
            evidenceIds: [...new Set([...claim.evidenceIds, ...binding.evidenceIds])],
          }
        : claim;
    });
    mission.updatedAt = nowIso();
    const fulfilled: EvidenceRequest = {
      ...request,
      status: "FULFILLED",
      fulfilledAt: nowIso(),
      fulfilledBy: input.fulfilledBy,
      fulfillmentIdempotencyKey: input.idempotencyKey,
      updatedAt: nowIso(),
    };
    run.status = "QUEUED";
    run.failureReason = undefined;
    run.updatedAt = nowIso();
    await this.dependencies.repository.saveMission(mission);
    await this.dependencies.repository.saveEvidenceRequest(fulfilled);
    await this.dependencies.repository.saveRun(run);
    return { evidenceRequest: fulfilled, run };
  }

  async submitReview(
    rawInput: ReviewRequestInput,
    identity: RequestIdentity,
  ): Promise<ReviewRequest> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const input = ReviewRequestInputSchema.parse(rawInput);
    const asset = await this.getAsset(input.assetId, identity);
    const version = await this.getVersion(input.versionId, identity);
    this.assertVersionBelongsToAsset(version, asset);
    if (asset.currentVersionId !== version.id) {
      throw new ConflictError("STALE_VERSION", "Only the current content version can be reviewed");
    }
    const mission = await this.getMission(asset.missionId, identity);
    if (
      (mission.highRisk || mission.requestedOutputs.includes("public_statement")) &&
      input.reviewerType !== "HUMAN"
    ) {
      throw new ConflictError(
        "HUMAN_REVIEW_REQUIRED",
        "High-risk or public-statement content requires a human reviewer",
      );
    }
    const reviewId = `review_${sha256(
      `${identity.organizationId}:${asset.id}:${version.id}:${input.reviewerType}`,
    ).slice(0, 24)}`;
    const existingReview = await this.dependencies.repository.getReview(
      reviewId,
      identity.organizationId,
    );
    if (existingReview) return existingReview;
    const validation = await this.validateAssetInternal(asset, version, mission, identity);
    if (validation.status !== "PASSED") {
      throw new ConflictError(
        "VALIDATION_FAILED",
        "Content cannot enter review until all blocking validation issues are resolved",
      );
    }
    const timestamp = nowIso();
    const review: ReviewRequest = {
      id: reviewId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: asset.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "PENDING",
      assetId: asset.id,
      versionId: version.id,
      reviewerType: input.reviewerType,
      ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const outbox =
      review.reviewerType === "AGT-RSN-006"
        ? this.makeOutboxMessage(
            "REVIEW_REQUEST",
            "AGT-RSN-006",
            { reviewRequest: review, contentVersion: version },
            identity,
            asset.traceId,
            review.id,
          )
        : undefined;
    await this.dependencies.repository.saveReview(review, outbox);
    asset.status = "REVIEW_REQUIRED";
    asset.activeReviewId = review.id;
    asset.updatedAt = timestamp;
    await this.dependencies.repository.saveAsset(asset);
    return review;
  }

  async decideReview(
    rawInput: ReviewDecisionInput,
    identity: RequestIdentity,
  ): Promise<ReviewDecision> {
    this.assertRole(identity, ["ADMIN", "REVIEWER"]);
    const input = ReviewDecisionInputSchema.parse(rawInput);
    const review = await this.dependencies.repository.getReview(
      input.reviewId,
      identity.organizationId,
    );
    if (!review) {
      throw new NotFoundError("ReviewRequest", input.reviewId);
    }
    if (review.status !== "PENDING") {
      throw new ConflictError("REVIEW_ALREADY_DECIDED", "Review is already decided");
    }
    const asset = await this.getAsset(review.assetId, identity);
    if (asset.currentVersionId !== review.versionId) {
      throw new ConflictError("STALE_REVIEW", "Review targets a stale content version");
    }
    const timestamp = nowIso();
    const decision: ReviewDecision = {
      id: newId("decision"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: review.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewId: review.id,
      decision: input.decision,
      reviewerId: input.reviewerId,
      summary: input.summary,
      comments: input.comments,
    };
    const updatedReview: ReviewRequest = {
      ...review,
      status: input.decision,
      decisionId: decision.id,
      reviewerId: input.reviewerId,
      updatedAt: timestamp,
    };
    await this.dependencies.repository.saveReviewDecision(decision);
    await this.dependencies.repository.saveReview(updatedReview);

    asset.status = input.decision === "APPROVED" ? "APPROVED" : "REVISION_REQUIRED";
    asset.updatedAt = timestamp;
    await this.dependencies.repository.saveAsset(asset);
    const mission = await this.getMission(asset.missionId, identity);
    mission.status = asset.status;
    mission.updatedAt = timestamp;
    await this.dependencies.repository.saveMission(mission);
    return decision;
  }

  async createPackage(
    input: CreateContentPackageInput,
    identity: RequestIdentity,
  ): Promise<ContentPackage> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const asset = await this.getAsset(input.contentAssetId, identity);
    const version = await this.getVersion(input.versionId, identity);
    this.assertVersionBelongsToAsset(version, asset);
    if (asset.status !== "APPROVED" || asset.currentVersionId !== version.id) {
      throw new ConflictError(
        "CONTENT_NOT_APPROVED",
        "Only the approved current version can be packaged",
      );
    }
    if (!asset.validationId) {
      throw new ConflictError("MISSING_VALIDATION", "Approved content has no validation");
    }
    const validation = await this.dependencies.repository.getValidation(
      asset.validationId,
      identity.organizationId,
    );
    if (!validation || validation.status !== "PASSED" || validation.versionId !== version.id) {
      throw new ConflictError(
        "INVALID_VALIDATION",
        "Content validation is missing, failed, or targets another version",
      );
    }
    const staleDerivedContent = [
      ...asset.bundle.variants,
      ...asset.bundle.localizations,
      ...asset.bundle.assetBriefs,
    ].filter((item) => item.derivedFromVersionId !== version.id);
    if (staleDerivedContent.length > 0) {
      throw new ConflictError(
        "STALE_DERIVED_CONTENT",
        "Every packaged variant and localization must be regenerated from the approved version",
      );
    }

    const generatedAssets: GeneratedAsset[] = [];
    for (const id of input.generatedAssetIds) {
      const generated = await this.dependencies.repository.getGeneratedAsset(
        id,
        identity.organizationId,
      );
      if (!generated || generated.contentAssetId !== asset.id) {
        throw new NotFoundError("GeneratedAsset", id);
      }
      if (
        generated.status !== "READY" ||
        generated.rights.status !== "CLEARED" ||
        generated.derivedFromVersionId !== version.id ||
        (generated.rights.expiresAt &&
          Date.parse(generated.rights.expiresAt) <= Date.now())
      ) {
        throw new ConflictError(
          "ASSET_RIGHTS_NOT_CLEARED",
          `Generated asset ${id} is not rights-cleared`,
        );
      }
      generatedAssets.push(generated);
    }

    const timestamp = nowIso();
    const contentPackage: ContentPackage = {
      id: newId("package"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: asset.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "PACKAGED",
      contentAssetId: asset.id,
      contentVersion: version,
      variants: asset.bundle.variants,
      localizations: asset.bundle.localizations,
      assets: generatedAssets,
      assetBriefs: asset.bundle.assetBriefs,
      claimEvidenceBindings: version.claimBindingSnapshot,
      validation,
      rightsRestrictions: generatedAssets.flatMap((item) => item.rights.restrictions),
      recommendedTitle: asset.bundle.primary.title,
      summary: asset.bundle.primary.summary,
      tags: asset.bundle.primary.tags,
      formatGuidance: Object.fromEntries(
        asset.bundle.variants.map((item) => [item.channel, item.formatMetadata]),
      ),
      contentHash: version.contentHash,
      versionNumber: version.versionNumber,
    };
    const forbidden = containsForbiddenDeliveryFields(contentPackage);
    if (forbidden.length > 0) {
      throw new ConflictError(
        "FORBIDDEN_PACKAGE_FIELDS",
        `ContentPackage includes forbidden platform fields: ${forbidden.join(", ")}`,
      );
    }
    await this.dependencies.repository.savePackage(contentPackage);
    asset.status = "PACKAGED";
    asset.updatedAt = timestamp;
    await this.dependencies.repository.saveAsset(asset);
    return contentPackage;
  }

  async deliverPackage(
    packageId: string,
    target: string,
    identity: RequestIdentity,
  ): Promise<ContentPackage> {
    this.assertRole(identity, ["ADMIN", "CREATOR"]);
    const contentPackage = await this.dependencies.repository.getPackage(
      packageId,
      identity.organizationId,
    );
    if (!contentPackage) {
      throw new NotFoundError("ContentPackage", packageId);
    }
    if (
      contentPackage.status === "DELIVERED" &&
      contentPackage.deliveredTo === target &&
      contentPackage.handoffReceipt
    ) {
      return contentPackage;
    }
    if (contentPackage.status !== "PACKAGED") {
      throw new ConflictError("PACKAGE_ALREADY_DELIVERED", "Package is already delivered");
    }
    const receipt = await this.dependencies.handoff.deliver(contentPackage, target);
    if (
      receipt.packageId !== contentPackage.id ||
      receipt.contentHash !== contentPackage.contentHash
    ) {
      throw new ConflictError(
        "HANDOFF_RECEIPT_MISMATCH",
        "Downstream receipt does not match the immutable content package",
      );
    }
    const timestamp = nowIso();
    const delivered: ContentPackage = {
      ...contentPackage,
      status: "DELIVERED",
      deliveredAt: timestamp,
      deliveredTo: target,
      handoffReceipt: receipt,
      updatedAt: timestamp,
    };
    await this.dependencies.repository.savePackage(delivered);
    const asset = await this.getAsset(contentPackage.contentAssetId, identity);
    asset.status = "DELIVERED";
    asset.updatedAt = timestamp;
    await this.dependencies.repository.saveAsset(asset);
    return delivered;
  }

  async getPackage(packageId: string, identity: RequestIdentity): Promise<ContentPackage> {
    const value = await this.dependencies.repository.getPackage(
      packageId,
      identity.organizationId,
    );
    if (!value) {
      throw new NotFoundError("ContentPackage", packageId);
    }
    return value;
  }

  async importSkill(
    rawInput: SkillImportInput,
    identity: RequestIdentity,
  ): Promise<{ skill: SkillPackage; version: SkillVersion }> {
    this.assertRole(identity, ["ADMIN"]);
    const input = SkillImportInputSchema.parse(rawInput);
    const prohibited = [
      "fetch(",
      "axios",
      "publish",
      "access_token",
      "cookie",
      "api.weixin.qq.com",
      "xiaohongshu.com",
      "api.twitter.com",
      "api.x.com",
    ];
    const prompt = input.manifest.systemPrompt.toLocaleLowerCase();
    const promptProtection = protectSensitiveData(input.manifest.systemPrompt);
    const securityPassed =
      !promptProtection.blocked &&
      prohibited.every((term) => !prompt.includes(term));
    const timestamp = nowIso();
    const skillId = newId("skill");
    const versionId = newId("skill_version");
    const status = securityPassed ? "TESTING" : "REJECTED";
    const skill: SkillPackage = {
      id: skillId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: newId("trace"),
      createdAt: timestamp,
      updatedAt: timestamp,
      status,
      name: input.name,
      description: input.description,
      versionIds: [versionId],
    };
    const version: SkillVersion = {
      id: versionId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: skill.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status,
      skillId,
      semanticVersion: input.manifest.version,
      manifest: input.manifest,
      manifestDigest: sha256(JSON.stringify(input.manifest)),
      securityPassed,
      regressionPassed: false,
    };
    await this.dependencies.repository.saveSkill(skill);
    await this.dependencies.repository.saveSkillVersion(version);
    return { skill, version };
  }

  async testSkill(
    skillId: string,
    rawInput: SkillRegressionInput,
    identity: RequestIdentity,
  ): Promise<SkillVersion> {
    this.assertRole(identity, ["ADMIN"]);
    const input = SkillRegressionInputSchema.parse(rawInput);
    const skill = await this.dependencies.repository.getSkill(
      skillId,
      identity.organizationId,
    );
    const version = await this.dependencies.repository.getSkillVersion(
      input.versionId,
      identity.organizationId,
    );
    if (!skill) {
      throw new NotFoundError("SkillPackage", skillId);
    }
    if (!version || version.skillId !== skill.id) {
      throw new NotFoundError("SkillVersion", input.versionId);
    }
    if (!version.securityPassed || version.status === "REJECTED") {
      throw new ConflictError(
        "SKILL_SECURITY_FAILED",
        "Rejected Skill cannot run regression tests",
      );
    }

    let regressionPassed = true;
    for (const testCase of input.cases) {
      const generated = await this.generateProtected({
        schemaName: "channel_variant",
        systemPrompt: [
          version.manifest.systemPrompt,
          "This is an isolated content regression test.",
          "Return only JSON matching the supplied schema.",
          "Do not include publishing, monitoring, credential or performance fields.",
        ].join("\n"),
        input: {
          testCaseName: testCase.name,
          contentInput: testCase.input,
          channel: testCase.channel,
          locale: testCase.locale,
        },
        jsonSchema: z.toJSONSchema(ChannelVariantSchema),
        traceId: version.traceId,
        requestId: `${version.id}:regression:${testCase.name}`,
        idempotencyKey: `${version.id}:regression:${testCase.name}`,
        promptVersion: `skill-${version.semanticVersion}`,
        maxOutputTokens: 4_000,
        timeoutMs: 60_000,
      });
      const output = ChannelVariantSchema.parse(generated.output);
      const searchable = `${output.title}\n${output.body}\n${output.summary}`;
      if (
        testCase.expectedMustInclude.some((term) => !searchable.includes(term)) ||
        testCase.forbiddenTerms.some((term) => searchable.includes(term))
      ) {
        regressionPassed = false;
      }
    }

    const timestamp = nowIso();
    const status = regressionPassed ? "READY" : "REJECTED";
    const testedVersion: SkillVersion = {
      ...version,
      status,
      regressionPassed,
      updatedAt: timestamp,
    };
    const testedSkill: SkillPackage = {
      ...skill,
      status,
      updatedAt: timestamp,
    };
    await this.dependencies.repository.saveSkillVersion(testedVersion);
    await this.dependencies.repository.saveSkill(testedSkill);
    return testedVersion;
  }

  async activateSkill(
    skillId: string,
    versionId: string,
    identity: RequestIdentity,
  ): Promise<SkillPackage> {
    this.assertRole(identity, ["ADMIN"]);
    const skill = await this.dependencies.repository.getSkill(
      skillId,
      identity.organizationId,
    );
    const version = await this.dependencies.repository.getSkillVersion(
      versionId,
      identity.organizationId,
    );
    if (!skill) {
      throw new NotFoundError("SkillPackage", skillId);
    }
    if (!version || version.skillId !== skill.id) {
      throw new NotFoundError("SkillVersion", versionId);
    }
    if (!version.securityPassed || !version.regressionPassed || version.status !== "READY") {
      throw new ConflictError(
        "SKILL_NOT_READY",
        "Skill must pass security and regression checks before activation",
      );
    }
    const timestamp = nowIso();
    const activeVersion: SkillVersion = {
      ...version,
      status: "ACTIVE",
      approvedBy: identity.userId,
      updatedAt: timestamp,
    };
    const activeSkill: SkillPackage = {
      ...skill,
      status: "ACTIVE",
      activeVersionId: version.id,
      updatedAt: timestamp,
    };
    await this.dependencies.repository.saveSkillVersion(activeVersion);
    await this.dependencies.repository.saveSkill(activeSkill);
    return activeSkill;
  }

  private async generateProtected(
    request: GenerateObjectRequest,
  ): Promise<HostGenerationResult> {
    const protection = protectSensitiveData(request.input);
    if (protection.blocked) {
      const categories = [
        ...new Set(
          protection.findings
            .filter((finding) => finding.action === "BLOCK")
            .map((finding) => finding.category),
        ),
      ];
      throw new ConflictError(
        "SENSITIVE_INPUT_BLOCKED",
        `Model input contains blocked sensitive data categories: ${categories.join(", ")}`,
      );
    }
    return this.dependencies.hostModel.generateObject({
      ...request,
      input: protection.sanitized,
    });
  }

  private async refreshBatch(run: AgentRun): Promise<void> {
    if (!run.batchId) return;
    const batch = await this.dependencies.repository.getBatch(
      run.batchId,
      run.organizationId,
    );
    if (!batch || batch.status === "CANCELLED") return;
    const runs = (
      await Promise.all(
        batch.runIds.map((runId) =>
          this.dependencies.repository.getRun(runId, run.organizationId),
        ),
      )
    ).filter((item): item is AgentRun => item !== undefined);
    const completed = runs.filter((item) => item.status === "COMPLETED").length;
    const failed = runs.filter((item) =>
      ["FAILED", "CANCELLED"].includes(item.status),
    ).length;
    const terminal = completed + failed;
    const status: ContentBatch["status"] =
      terminal < batch.total
        ? "RUNNING"
        : failed === 0
          ? "COMPLETED"
          : completed === 0
            ? "FAILED"
            : "PARTIAL";
    await this.dependencies.repository.saveBatch({
      ...batch,
      status,
      completed,
      failed,
      updatedAt: nowIso(),
    });
  }

  private async validateAssetInternal(
    asset: ContentAsset,
    version: ContentVersion,
    mission: ContentMission,
    identity: RequestIdentity,
  ): Promise<ContentValidationResult> {
    if (canTransition(asset.status, "VALIDATING")) {
      asset.status = "VALIDATING";
    }
    const validation = await validateContentVersion(
      mission,
      version,
      identity,
      this.dependencies.policy,
    );
    const derivedContent = [
      ...asset.bundle.variants.map((item, index) => ({
        item,
        path: `variants[${index}]`,
      })),
      ...asset.bundle.localizations.map((item, index) => ({
        item,
        path: `localizations[${index}]`,
      })),
    ];
    for (const { item, path } of derivedContent) {
      if (item.derivedFromVersionId !== version.id) {
        validation.issues.push({
          code: "STALE_DERIVED_CONTENT",
          severity: "BLOCKING",
          message: "Derived content does not belong to the current version",
          path,
        });
      }
      const protectedVariant = protectSensitiveData({
        title: item.title,
        body: item.body,
        summary: item.summary,
      });
      for (const finding of protectedVariant.findings) {
        validation.issues.push({
          code: "SENSITIVE_DATA",
          severity: "BLOCKING",
          message: `Derived content contains sensitive data category ${finding.category}`,
          path: `${path}.${finding.path}`,
        });
      }
      const policyResult = await this.dependencies.policy.check(mission, {
        ...version,
        title: item.title,
        body: item.body,
        contentHash: sha256(item.body),
      });
      for (const issue of policyResult.issues) {
        validation.issues.push({
          code: issue.code,
          severity: "BLOCKING",
          message: issue.message,
          path: `${path}.${issue.path ?? "body"}`,
        });
      }
    }
    asset.bundle.assetBriefs.forEach((brief, index) => {
      const path = `assetBriefs[${index}]`;
      if (brief.derivedFromVersionId !== version.id) {
        validation.issues.push({
          code: "STALE_DERIVED_CONTENT",
          severity: "BLOCKING",
          message: "Asset brief does not belong to the current version",
          path,
        });
      }
      const protectedBrief = protectSensitiveData(brief);
      for (const finding of protectedBrief.findings) {
        validation.issues.push({
          code: "SENSITIVE_DATA",
          severity: "BLOCKING",
          message: `Asset brief contains sensitive data category ${finding.category}`,
          path: `${path}.${finding.path}`,
        });
      }
    });
    const semanticGenerated = await this.generateProtected({
      schemaName: "claim_audit",
      systemPrompt: [
        "Audit every factual assertion in the supplied content.",
        "Opinions and creative phrasing are not factual assertions.",
        "A factual assertion must match one supplied Claim ID and be entailed by its linked Evidence.",
        "Do not invent Claim IDs or Evidence IDs. Return JSON only.",
      ].join("\n"),
      input: {
        content: {
          primary: { title: version.title, body: version.body },
          variants: asset.bundle.variants,
          localizations: asset.bundle.localizations,
        },
        claims: mission.claims,
        evidence: mission.evidence,
      },
      jsonSchema: z.toJSONSchema(ClaimAuditSchema),
      traceId: version.traceId,
      requestId: `${version.id}:claim-audit`,
      idempotencyKey: `${version.contentHash}:claim-audit:v1`,
      promptVersion: "claim-audit-v1",
      maxOutputTokens: 8_000,
      timeoutMs: 90_000,
    });
    const semanticAudit = ClaimAuditSchema.parse(semanticGenerated.output);
    const claimById = new Map(mission.claims.map((claim) => [claim.id, claim]));
    for (const assertion of semanticAudit.assertions.filter(
      (item) => item.factual,
    )) {
      const claim = assertion.matchedClaimId
        ? claimById.get(assertion.matchedClaimId)
        : undefined;
      if (!claim) {
        validation.issues.push({
          code: "UNKNOWN_FACTUAL_CLAIM",
          severity: "BLOCKING",
          message: `Content contains a factual assertion not bound to an approved Claim: ${assertion.statement}`,
          path: assertion.path,
        });
        continue;
      }
      const allowedEvidence = new Set(claim.evidenceIds);
      const evidenceMatches =
        assertion.evidenceIds.length > 0 &&
        assertion.evidenceIds.every((id) => allowedEvidence.has(id));
      if (!assertion.entailedByEvidence || !evidenceMatches) {
        validation.issues.push({
          code: "CLAIM_EVIDENCE_MISMATCH",
          severity: "BLOCKING",
          message: `Factual assertion is not entailed by its approved Evidence: ${assertion.statement}`,
          claimId: claim.id,
          path: assertion.path,
        });
      }
    }
    validation.semanticClaimAudit = semanticAudit;
    validation.semanticAuditMetadata = semanticGenerated.metadata;
    validation.checks.claimSemantics = !validation.issues.some(
      (issue) =>
        issue.code === "UNKNOWN_FACTUAL_CLAIM" ||
        issue.code === "CLAIM_EVIDENCE_MISMATCH",
    );
    if (!validation.checks.claimSemantics) {
      validation.status = "FAILED";
    }
    validation.checks.dataProtection = !validation.issues.some(
      (issue) => issue.code === "SENSITIVE_DATA",
    );
    validation.checks.brand = !validation.issues.some(
      (issue) => issue.code === "BRAND_RULE",
    );
    validation.checks.policy = !validation.issues.some(
      (issue) =>
        issue.code === "POLICY_RULE" ||
        issue.code === "MISSING_DISCLOSURE",
    );
    if (validation.issues.some((issue) => issue.severity === "BLOCKING")) {
      validation.status = "FAILED";
    }
    await this.dependencies.repository.saveValidation(validation);
    asset.validationId = validation.id;
    asset.status = validation.status === "PASSED" ? "REVIEW_REQUIRED" : "REVISION_REQUIRED";
    asset.updatedAt = nowIso();
    await this.dependencies.repository.saveAsset(asset);
    mission.status = asset.status;
    mission.updatedAt = nowIso();
    await this.dependencies.repository.saveMission(mission);
    return validation;
  }

  private createInitialAsset(
    mission: ContentMission,
    bundle: ReturnType<typeof GeneratedContentBundleSchema.parse>,
    identity: RequestIdentity,
    generationMetadata: HostGenerationMetadata | undefined,
  ): { asset: ContentAsset; version: ContentVersion } {
    const timestamp = nowIso();
    const assetId = newId("content_asset");
    const versionId = newId("version");
    const version: ContentVersion = {
      id: versionId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: mission.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "VALIDATING",
      assetId,
      versionNumber: 1,
      title: bundle.primary.title,
      body: bundle.primary.body,
      contentHash: sha256(bundle.primary.body),
      changeReason: "Initial generated content",
      changedBy: identity.userId,
      generationContextSnapshot: {
        objective: mission.objective,
        strategy: mission.strategy,
        audience: mission.audience,
        message: mission.message,
        brandRules: mission.brandRules,
        policies: mission.policies,
        requestedOutputs: mission.requestedOutputs,
        channels: mission.channels,
        locales: mission.locales,
        ...(mission.templateSnapshot
          ? { templateSnapshot: mission.templateSnapshot }
          : {}),
      },
      generationMetadataSnapshot: generationMetadata,
      bodyFormat: "plain_text",
      claimBindingSnapshot: this.claimSnapshot(mission),
    };
    const asset: ContentAsset = {
      id: assetId,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: mission.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "VALIDATING",
      missionId: mission.id,
      title: bundle.primary.title,
      currentVersionId: versionId,
      bundle: {
        ...bundle,
        variants: bundle.variants.map((variant) => ({
          ...variant,
          derivedFromVersionId: versionId,
        })),
        localizations: bundle.localizations.map((localization) => ({
          ...localization,
          derivedFromVersionId: versionId,
        })),
        assetBriefs: bundle.assetBriefs.map((brief) => ({
          ...brief,
          derivedFromVersionId: versionId,
        })),
      },
      versionIds: [versionId],
    };
    return { asset, version };
  }

  private claimSnapshot(mission: ContentMission): ContentVersion["claimBindingSnapshot"] {
    return mission.claims.map((claim) => ({
      claimId: claim.id,
      evidenceIds: [...claim.evidenceIds],
      statementHash: sha256(claim.statement),
    }));
  }

  private findUnsupportedClaims(mission: ContentMission): ContentMission["claims"] {
    const evidenceById = new Map(mission.evidence.map((item) => [item.id, item]));
    const now = Date.now();
    return mission.claims.filter((claim) => {
      if (!claim.factual) {
        return false;
      }
      return !claim.evidenceIds.some((id) => {
        const evidence = evidenceById.get(id);
        return (
          evidence?.verified === true &&
          evidence.rights.status === "CLEARED" &&
          (!evidence.rights.expiresAt ||
            Date.parse(evidence.rights.expiresAt) >= now) &&
          (!evidence.validUntil || Date.parse(evidence.validUntil) >= now)
        );
      });
    });
  }

  private makeEvidenceRequest(
    mission: ContentMission,
    claims: ContentMission["claims"],
    identity: RequestIdentity,
    customQuestions?: string[],
  ): EvidenceRequest {
    const timestamp = nowIso();
    return {
      id: newId("evidence_request"),
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId: mission.traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "OPEN",
      missionId: mission.id,
      claimIds: claims.map((item) => item.id),
      questions:
        customQuestions ??
        claims.map((item) => `请提供可验证且已授权的证据，以支持：${item.statement}`),
      requestedFrom: "AGT-RSN-003",
    };
  }

  private makeOutboxMessage(
    messageType: OutboxMessage["messageType"],
    recipient: OutboxMessage["recipient"],
    payload: Record<string, unknown>,
    identity: RequestIdentity,
    traceId: string,
    idempotencyKey: string,
  ): OutboxMessage {
    const timestamp = nowIso();
    const protection = protectSensitiveData(payload);
    if (protection.blocked) {
      throw new ConflictError(
        "SENSITIVE_AGENT_MESSAGE_BLOCKED",
        "Inter-agent message contains blocked sensitive data",
      );
    }
    return {
      id: `outbox_${sha256(
        `${messageType}:${recipient}:${identity.organizationId}:${idempotencyKey}`,
      ).slice(0, 24)}`,
      organizationId: identity.organizationId,
      createdBy: identity.userId,
      traceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "PENDING",
      protocolVersion: "1.0",
      messageType,
      sender: "AGT-RSN-004",
      recipient,
      idempotencyKey,
      payload: protection.sanitized,
      attempts: 0,
      nextAttemptAt: timestamp,
    };
  }

  private assertBundleClaims(
    bundle: ReturnType<typeof GeneratedContentBundleSchema.parse>,
    mission: ContentMission,
  ): void {
    const known = new Set(mission.claims.map((item) => item.id));
    const used = [
      ...bundle.primary.claimIdsUsed,
      ...bundle.variants.flatMap((item) => item.claimIdsUsed),
      ...bundle.localizations.flatMap((item) => item.claimIdsUsed),
      ...bundle.answerBlocks.flatMap((item) => item.claimIdsUsed),
    ];
    const unknown = used.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new ConflictError(
        "MODEL_ADDED_UNKNOWN_CLAIM",
        `Model output references unknown claims: ${[...new Set(unknown)].join(", ")}`,
      );
    }
  }

  private assertVariantClaims(
    variant: ChannelVariant,
    mission: ContentMission,
  ): void {
    const known = new Set(mission.claims.map((claim) => claim.id));
    const unknown = variant.claimIdsUsed.filter((claimId) => !known.has(claimId));
    if (unknown.length > 0) {
      throw new ConflictError(
        "MODEL_ADDED_UNKNOWN_CLAIM",
        `Generated content references unknown claims: ${[...new Set(unknown)].join(", ")}`,
      );
    }
  }

  private assertVersionBelongsToAsset(
    version: ContentVersion,
    asset: ContentAsset,
  ): void {
    if (version.assetId !== asset.id) {
      throw new ConflictError("VERSION_ASSET_MISMATCH", "Version belongs to another asset");
    }
  }

  private async runStep(
    run: AgentRun,
    name: AgentRunStep["name"],
    operation: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const step = run.steps.find((item) => item.name === name);
    if (!step) {
      throw new Error(`Missing run step ${name}`);
    }
    if (step.status === "COMPLETED") {
      return;
    }
    step.status = "RUNNING";
    step.startedAt = nowIso();
    run.updatedAt = nowIso();
    await this.dependencies.repository.saveRun(run);
    try {
      step.metadata = await operation();
      step.status = "COMPLETED";
      step.completedAt = nowIso();
      run.updatedAt = nowIso();
      await this.dependencies.repository.saveRun(run);
    } catch (error) {
      step.status = "FAILED";
      step.error = error instanceof Error ? error.message : String(error);
      step.completedAt = nowIso();
      run.updatedAt = nowIso();
      await this.dependencies.repository.saveRun(run);
      throw error;
    }
  }

  private transitionMission(mission: ContentMission, status: ContentMission["status"]): void {
    assertContentTransition(mission.status, status);
    mission.status = status;
    mission.updatedAt = nowIso();
  }

  private async getMission(
    missionId: string,
    identity: RequestIdentity,
  ): Promise<ContentMission> {
    const mission = await this.dependencies.repository.getMission(
      missionId,
      identity.organizationId,
    );
    if (!mission) {
      throw new NotFoundError("ContentMission", missionId);
    }
    return mission;
  }

  private async getAsset(
    assetId: string,
    identity: RequestIdentity,
  ): Promise<ContentAsset> {
    const asset = await this.dependencies.repository.getAsset(
      assetId,
      identity.organizationId,
    );
    if (!asset) {
      throw new NotFoundError("ContentAsset", assetId);
    }
    return asset;
  }

  private async getVersion(
    versionId: string,
    identity: RequestIdentity,
  ): Promise<ContentVersion> {
    const version = await this.dependencies.repository.getVersion(
      versionId,
      identity.organizationId,
    );
    if (!version) {
      throw new NotFoundError("ContentVersion", versionId);
    }
    return version;
  }

  private bundleSystemPrompt(): string {
    return [
      "You are AGT-RSN-004, a pure content-domain agent.",
      "Return exactly one JSON object matching the provided content_bundle schema.",
      "Never invent claims, evidence, endorsements, sources, statistics or quotes.",
      "Use only claim IDs and evidence supplied in the mission.",
      "Generate the source draft only. Set variants and localizations to empty arrays; they are generated after enterprise human approval.",
      "Never include account, credential, publishing, scheduling, monitoring or performance fields.",
      "Preserve evidence meaning in every variant and localization.",
    ].join("\n");
  }

  private assertRole(
    identity: RequestIdentity,
    allowed: RequestIdentity["role"][],
  ): void {
    if (!allowed.includes(identity.role)) {
      throw new ConflictError(
        "ROLE_NOT_ALLOWED",
        `Role ${identity.role} cannot perform this content-domain action`,
      );
    }
  }
}
