import {
  AssetRightsSchema,
  BatchMissionInputSchema,
  ContentMissionInputSchema,
  CreateContentTemplateInputSchema,
  CreateSourceAttachmentInputSchema,
  CreateContentPackageInputSchema,
  CreateLocalizationInputSchema,
  CreateVariantInputSchema,
  CreateVersionInputSchema,
  EvidenceFulfillmentInputSchema,
  GenerateAssetBriefInputSchema,
  MissionPreflightRequestSchema,
  ClaimDecisionInputSchema,
  CreateTeamRunInputSchema,
  HumanGateDecisionInputSchema,
  ReviewDecisionInputSchema,
  ReviewRequestInputSchema,
  SkillImportInputSchema,
  SkillRegressionInputSchema,
  type AgentMessageEnvelope,
  type KnowledgeSnapshot,
  type RequestIdentity,
} from "@risen/content-contracts";
import { verifyAgentEnvelope } from "@risen/content-adapters";
import {
  DomainError,
  assertDraftGate,
  createKnowledgeSnapshot,
  createMissionPreflight,
  createPerspectiveContract,
} from "@risen/content-core";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DependencyContainer } from "./dependencies.js";
import { exportContentPackage } from "./export.js";

const EvidenceRequestBodySchema = z.object({
  questions: z.array(z.string().min(1)).min(1),
  claimIds: z.array(z.string().min(8)).min(1),
});

const GenerateAssetBodySchema = z.object({
  briefIndex: z.number().int().nonnegative(),
});

const DeliverBodySchema = z.object({
  target: z.string().min(1).max(300),
});

const ActivateSkillBodySchema = z.object({
  versionId: z.string().min(8),
});

const EvidenceFulfillmentPayloadSchema = z.object({
  evidenceRequestId: z.string().min(8).max(128),
  fulfillment: EvidenceFulfillmentInputSchema,
});

const ReviewDecisionPayloadSchema = z.object({
  decision: ReviewDecisionInputSchema,
});

const RegisterSourceVersionSchema = z.object({
  versionId: z.string().min(8).max(128),
});

function identityFrom(request: FastifyRequest): RequestIdentity {
  const organizationId = request.headers["x-organization-id"];
  const userId = request.headers["x-user-id"];
  const roleHeader = request.headers["x-role"];
  const identity: RequestIdentity = {
    organizationId:
      typeof organizationId === "string" ? organizationId : "org_demo001",
    userId: typeof userId === "string" ? userId : "user_demo001",
    role:
      roleHeader === "ADMIN" ||
      roleHeader === "CREATOR" ||
      roleHeader === "REVIEWER" ||
      roleHeader === "VIEWER"
        ? roleHeader
        : "CREATOR",
  };
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.IDENTITY_HMAC_SECRET;
    const signature = request.headers["x-identity-signature"];
    const timestamp = request.headers["x-identity-timestamp"];
    if (
      !secret ||
      typeof signature !== "string" ||
      typeof timestamp !== "string" ||
      !Number.isFinite(Date.parse(timestamp)) ||
      Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000
    ) {
      throw new DomainError(
        "UNAUTHENTICATED",
        "Fresh signed identity headers are required in production",
        401,
      );
    }
    const expected = createHmac("sha256", secret)
      .update(
        `${identity.organizationId}:${identity.userId}:${identity.role}:${timestamp}`,
      )
      .digest("hex");
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(signature);
    if (
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    ) {
      throw new DomainError("UNAUTHENTICATED", "Invalid identity signature", 401);
    }
  }
  return identity;
}

function inboundAgentEnvelope(
  request: FastifyRequest,
  expected: {
    messageType: AgentMessageEnvelope["messageType"];
    sender: AgentMessageEnvelope["sender"];
  },
): AgentMessageEnvelope {
  const secret = process.env.AGENT_PROTOCOL_HMAC_SECRET;
  const signature = request.headers["x-risen-signature"];
  if (!secret || typeof signature !== "string") {
    throw new DomainError(
      "UNAUTHENTICATED_AGENT",
      "Signed agent protocol message is required",
      401,
    );
  }
  let envelope: AgentMessageEnvelope;
  try {
    envelope = verifyAgentEnvelope(request.body, signature, secret);
  } catch {
    throw new DomainError(
      "UNAUTHENTICATED_AGENT",
      "Agent protocol signature or envelope is invalid",
      401,
    );
  }
  if (
    envelope.recipient !== "AGT-RSN-004" ||
    envelope.sender !== expected.sender ||
    envelope.messageType !== expected.messageType
  ) {
    throw new DomainError(
      "AGENT_PROTOCOL_ROUTE_MISMATCH",
      "Agent protocol sender, recipient or message type does not match this route",
      400,
    );
  }
  return envelope;
}

export async function buildApp(container: DependencyContainer) {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: Number.parseInt(process.env.API_RATE_LIMIT_MAX ?? "300", 10),
    timeWindow: process.env.API_RATE_LIMIT_WINDOW ?? "1 minute",
    keyGenerator: (request) => {
      const organizationId = request.headers["x-organization-id"];
      return `${typeof organizationId === "string" ? organizationId : "anonymous"}:${request.ip}`;
    },
    allowList: (request) =>
      request.url === "/health" || request.url === "/ready",
  });
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    allowedHeaders: [
      "content-type",
      "x-organization-id",
      "x-user-id",
      "x-role",
      "x-identity-signature",
      "x-identity-timestamp",
      "x-risen-signature",
      "x-risen-message-id",
      "x-idempotency-key",
      "x-trace-id",
    ],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues,
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error instanceof Error
              ? error.message
              : String(error),
      },
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "AGT-RSN-004",
    domain: "content-only",
    platformConnections: false,
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      const dependencies = await container.ready();
      return { status: "ready", ...dependencies };
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }
  });

  app.get("/v1/missions", async (request) =>
    container.service.listMissions(identityFrom(request)),
  );

  app.post("/v1/missions", async (request, reply) => {
    const identity = identityFrom(request);
    const input = ContentMissionInputSchema.parse(request.body);
    const created = await container.service.createMission(input, identity);
    await container.enqueueRun?.(created.run.id, identity);
    return reply.status(202).send(created);
  });

  app.get<{ Params: { runId: string } }>("/v1/runs/:runId", async (request) =>
    container.service.getRun(request.params.runId, identityFrom(request)),
  );

  app.get("/v1/batches", async (request) =>
    container.service.listBatches(identityFrom(request)),
  );

  app.post("/v1/batches", async (request, reply) => {
    const identity = identityFrom(request);
    const input = BatchMissionInputSchema.parse(request.body);
    const created = await container.service.createBatch(input, identity);
    await Promise.all(
      created.runs.map((run) => container.enqueueRun?.(run.id, identity)),
    );
    return reply.status(202).send(created);
  });

  app.get<{ Params: { id: string } }>("/v1/batches/:id", async (request) =>
    container.service.getBatch(request.params.id, identityFrom(request)),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/batches/:id/cancel",
    async (request) => {
      const identity = identityFrom(request);
      const batch = await container.service.getBatch(request.params.id, identity);
      const cancelled = await container.service.cancelBatch(
        request.params.id,
        identity,
      );
      await container.cancelRunJobs?.(batch.runIds);
      return cancelled;
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/v1/runs/:runId/execute",
    async (request) =>
      container.service.executeRun(request.params.runId, identityFrom(request)),
  );

  app.post<{ Params: { runId: string } }>(
    "/v1/runs/:runId/cancel",
    async (request) => {
      const identity = identityFrom(request);
      const cancelled = await container.service.cancelQueuedRun(
        request.params.runId,
        identity,
      );
      await container.cancelRunJobs?.([request.params.runId]);
      return cancelled;
    },
  );

  app.get("/v1/content-assets", async (request) =>
    container.service.listAssets(identityFrom(request)),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/missions/:id/preflight",
    async (request, reply) => {
      const identity = identityFrom(request);
      const mission = await container.repository.getMission(
        request.params.id,
        identity.organizationId,
      );
      if (!mission) throw new DomainError("NOT_FOUND", `ContentMission ${request.params.id} does not exist`, 404);
      const input = MissionPreflightRequestSchema.parse(request.body);
      const preflight = createMissionPreflight({
        missionId: mission.id,
        organizationId: identity.organizationId,
        createdBy: identity.userId,
        traceId: mission.traceId,
        value: input.preflight,
      });
      const perspective = createPerspectiveContract({
        missionId: mission.id,
        organizationId: identity.organizationId,
        createdBy: identity.userId,
        traceId: mission.traceId,
        value: input.perspective,
      });
      let knowledgeSnapshot: KnowledgeSnapshot | undefined;
      if (input.knowledge) {
        const claimCards = await container.governance.getClaimCards(
          input.knowledge.claimCardIds,
          identity.organizationId,
        );
        const sourceIds = [...new Set(claimCards.flatMap((card) => card.evidenceRefs))].sort();
        const expectedSourceHashes = sourceIds.map((sourceId) => {
          const hash = container.canonSourceHashesById[sourceId];
          if (!hash) throw new DomainError("KNOWLEDGE_SOURCE_NOT_ACTIVE", `Source ${sourceId} is not in the active canon`, 409);
          return hash;
        }).sort();
        const suppliedSourceHashes = [...input.knowledge.sourceHashes].sort();
        if (JSON.stringify(expectedSourceHashes) !== JSON.stringify(suppliedSourceHashes)) {
          throw new DomainError("SOURCE_SNAPSHOT_STALE", "Knowledge source hashes do not match the selected active Claim cards", 409);
        }
        knowledgeSnapshot = createKnowledgeSnapshot({
          missionId: mission.id,
          organizationId: identity.organizationId,
          createdBy: identity.userId,
          traceId: mission.traceId,
          sourceHashes: suppliedSourceHashes,
          claimCards,
          conflicts: await container.governance.listConflicts(identity.organizationId),
          audienceLayer: input.knowledge.audienceLayer,
          publicationScope: input.preflight.publicationScope,
          canonVersion: input.knowledge.canonVersion,
        });
      }
      assertDraftGate({
        preflight,
        perspective,
        ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
      });
      if (knowledgeSnapshot) {
        await container.governance.saveMissionGate(preflight, perspective, knowledgeSnapshot);
      } else {
        await container.governance.saveMissionGate(preflight, perspective);
      }
      return reply.status(201).send({ preflight, perspective, knowledgeSnapshot });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/missions/:id/knowledge-snapshot",
    async (request) => {
      const identity = identityFrom(request);
      const snapshot = await container.governance.getSnapshot(request.params.id, identity.organizationId);
      if (!snapshot) throw new DomainError("NOT_FOUND", `KnowledgeSnapshot for mission ${request.params.id} does not exist`, 404);
      return snapshot;
    },
  );

  app.post("/v1/knowledge/claim-decisions", async (request) => {
    const identity = identityFrom(request);
    if (identity.role !== "ADMIN" && identity.role !== "REVIEWER") {
      throw new DomainError("FORBIDDEN", "Only enterprise reviewers may decide knowledge claims", 403);
    }
    const input = ClaimDecisionInputSchema.parse(request.body);
    return container.governance.decideClaim(input, identity.organizationId);
  });

  app.get("/v1/knowledge/conflicts", async (request) => {
    const identity = identityFrom(request);
    return { items: await container.governance.listConflicts(identity.organizationId) };
  });

  app.get("/v1/agents/runtime-health", async () =>
    container.teamRuntime.health(),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/missions/:id/team-runs",
    async (request, reply) => {
      const identity = identityFrom(request);
      const input = CreateTeamRunInputSchema.parse(request.body);
      const mission = await container.repository.getMission(request.params.id, identity.organizationId);
      if (!mission) throw new DomainError("NOT_FOUND", `ContentMission ${request.params.id} does not exist`, 404);
      const [preflight, perspective, snapshot] = await Promise.all([
        container.governance.getPreflight(mission.id, identity.organizationId),
        container.governance.getPerspective(mission.id, identity.organizationId),
        container.governance.getSnapshot(mission.id, identity.organizationId),
      ]);
      if (!preflight || !perspective) {
        throw new DomainError("MISSION_PREFLIGHT_REQUIRED", "Mission preflight and PerspectiveContract are required", 409);
      }
      const perspectiveArtifact = await container.teamRuntime.coordinator.persistSupervisorArtifact({
        artifactType: "perspective_contract",
        organizationId: identity.organizationId,
        payload: perspective,
      });
      const generatedSourceIds = [perspectiveArtifact.artifactId];
      if (snapshot) {
        const snapshotArtifact = await container.teamRuntime.coordinator.persistSupervisorArtifact({
          artifactType: "knowledge_snapshot",
          organizationId: identity.organizationId,
          payload: snapshot,
          sourceRefs: [perspectiveArtifact.artifactId],
        });
        generatedSourceIds.push(snapshotArtifact.artifactId);
      }
      const run = await container.teamRuntime.coordinator.start({
        missionId: mission.id,
        organizationId: identity.organizationId,
        traceId: mission.traceId,
        createdBy: identity.userId,
        sourceArtifactIds: [...new Set([...input.sourceArtifactIds, ...generatedSourceIds])],
        requestedChannels: input.requestedChannels,
        requiresPublicResearch: preflight.requiresPublicResearch,
        requiresEnterpriseKnowledge: preflight.requiresEnterpriseKnowledge,
      });
      await container.enqueueTeamRun?.(run.runId, identity.organizationId, run.taskIds.length);
      return reply.status(202).send(run);
    },
  );

  app.get<{ Params: { runId: string } }>("/v1/team-runs/:runId", async (request) => {
    const identity = identityFrom(request);
    return container.teamRuntime.coordinator.get(request.params.runId, identity.organizationId);
  });

  app.post<{ Params: { runId: string } }>("/v1/team-runs/:runId/pause", async (request) => {
    const identity = identityFrom(request);
    return container.teamRuntime.coordinator.pause(request.params.runId, identity.organizationId);
  });

  app.post<{ Params: { runId: string } }>("/v1/team-runs/:runId/resume", async (request) => {
    const identity = identityFrom(request);
    return container.teamRuntime.coordinator.resume(request.params.runId, identity.organizationId);
  });

  app.post<{ Params: { runId: string } }>("/v1/team-runs/:runId/cancel", async (request) => {
    const identity = identityFrom(request);
    return container.teamRuntime.coordinator.cancel(request.params.runId, identity.organizationId);
  });

  app.get<{ Params: { runId: string } }>("/v1/team-runs/:runId/artifacts", async (request) => {
    const identity = identityFrom(request);
    return {
      items: await container.teamRuntime.coordinator.artifacts(request.params.runId, identity.organizationId),
    };
  });

  app.post<{ Params: { runId: string } }>(
    "/v1/team-runs/:runId/source-version",
    async (request, reply) => {
      const identity = identityFrom(request);
      const input = RegisterSourceVersionSchema.parse(request.body);
      const run = await container.teamRuntime.coordinator.get(request.params.runId, identity.organizationId);
      const version = await container.repository.getVersion(input.versionId, identity.organizationId);
      if (!version) throw new DomainError("NOT_FOUND", `ContentVersion ${input.versionId} does not exist`, 404);
      const submitted = await container.teamRuntime.coordinator.submitFormalVersion(
        run.runId,
        identity.organizationId,
        version,
      );
      await container.enqueueTeamRun?.(submitted.run.runId, identity.organizationId, submitted.run.taskIds.length);
      return reply.status(201).send(submitted);
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/v1/team-runs/:runId/human-decisions",
    async (request, reply) => {
      const identity = identityFrom(request);
      if (identity.role !== "ADMIN" && identity.role !== "REVIEWER") {
        throw new DomainError("FORBIDDEN", "Only enterprise reviewers may decide human gates", 403);
      }
      const input = HumanGateDecisionInputSchema.parse({
        ...(request.body as Record<string, unknown>),
        runId: request.params.runId,
      });
      const result = await container.teamRuntime.coordinator.decide(input, identity);
      if (result.run.status === "RUNNING") {
        await container.enqueueTeamRun?.(result.run.runId, identity.organizationId, result.run.taskIds.length);
      }
      return reply.status(201).send(result);
    },
  );

  app.get("/v1/source-attachments", async (request) =>
    container.service.listAttachments(identityFrom(request)),
  );

  app.post("/v1/source-attachments", async (request, reply) => {
    const input = CreateSourceAttachmentInputSchema.parse(request.body);
    const prepared = await container.service.prepareAttachment(
      input,
      identityFrom(request),
    );
    return reply.status(201).send(prepared);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/source-attachments/:id/complete",
    async (request) =>
      container.service.completeAttachment(
        request.params.id,
        identityFrom(request),
      ),
  );

  app.get("/v1/content-templates", async (request) =>
    container.service.listTemplates(identityFrom(request)),
  );

  app.post("/v1/content-templates", async (request, reply) => {
    const input = CreateContentTemplateInputSchema.parse(request.body);
    const template = await container.service.createTemplate(
      input,
      identityFrom(request),
    );
    return reply.status(201).send(template);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/content-templates/:id/activate",
    async (request) =>
      container.service.activateTemplate(
        request.params.id,
        identityFrom(request),
      ),
  );

  app.get<{
    Querystring: {
      traceId?: string;
      entityType?: string;
      entityId?: string;
      limit?: string;
    };
  }>("/v1/audit-events", async (request) =>
    container.service.listAuditEvents(
      {
        ...(request.query.traceId ? { traceId: request.query.traceId } : {}),
        ...(request.query.entityType
          ? { entityType: request.query.entityType }
          : {}),
        ...(request.query.entityId ? { entityId: request.query.entityId } : {}),
        limit: Number.parseInt(request.query.limit ?? "100", 10),
      },
      identityFrom(request),
    ),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/content-assets/:id/versions",
    async (request) =>
      container.service.listVersions(request.params.id, identityFrom(request)),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/versions",
    async (request, reply) => {
      const input = CreateVersionInputSchema.parse(request.body);
      const version = await container.service.createVersion(
        request.params.id,
        input,
        identityFrom(request),
      );
      return reply.status(201).send(version);
    },
  );

  app.post("/v1/agent-protocol/evidence-fulfillments", async (request) => {
    const envelope = inboundAgentEnvelope(request, {
      messageType: "EVIDENCE_FULFILLMENT",
      sender: "AGT-RSN-003",
    });
    const claimed = await container.repository.claimInboundMessage(
      envelope.messageId,
      envelope.idempotencyKey,
      envelope.organizationId,
    );
    if (!claimed) return { duplicate: true, messageId: envelope.messageId };
    try {
      const payload = EvidenceFulfillmentPayloadSchema.parse(envelope.payload);
      const result = await container.service.fulfillEvidenceRequest(
        payload.evidenceRequestId,
        payload.fulfillment,
        {
          organizationId: envelope.organizationId,
          userId: envelope.sender,
          role: "CREATOR",
        },
      );
      await container.repository.completeInboundMessage(
        envelope.messageId,
        envelope.organizationId,
      );
      return { duplicate: false, messageId: envelope.messageId, result };
    } catch (error) {
      await container.repository.releaseInboundMessage(
        envelope.messageId,
        envelope.organizationId,
      );
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/variants",
    async (request, reply) => {
      const input = CreateVariantInputSchema.parse(request.body);
      const value = await container.service.createVariant(
        request.params.id,
        input,
        identityFrom(request),
      );
      return reply.status(201).send(value);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/localizations",
    async (request, reply) => {
      const input = CreateLocalizationInputSchema.parse(request.body);
      const value = await container.service.createLocalization(
        request.params.id,
        input,
        identityFrom(request),
      );
      return reply.status(201).send(value);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/assets",
    async (request, reply) => {
      const input = GenerateAssetBodySchema.parse(request.body);
      const value = await container.service.generateAsset(
        request.params.id,
        input.briefIndex,
        identityFrom(request),
      );
      return reply.status(202).send(value);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/asset-briefs",
    async (request, reply) => {
      const input = GenerateAssetBriefInputSchema.parse(request.body);
      const brief = await container.service.generateAssetBrief(
        request.params.id,
        input,
        identityFrom(request),
      );
      return reply.status(201).send(brief);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/v1/generated-assets/:id/rights",
    async (request) => {
      const rights = AssetRightsSchema.parse(request.body);
      return container.service.updateAssetRights(
        request.params.id,
        rights,
        identityFrom(request),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/content-assets/:id/validate",
    async (request) =>
      container.service.validateAsset(request.params.id, identityFrom(request)),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/missions/:id/evidence-requests",
    async (request, reply) => {
      const input = EvidenceRequestBodySchema.parse(request.body);
      const value = await container.service.createEvidenceRequest(
        request.params.id,
        input.questions,
        input.claimIds,
        identityFrom(request),
      );
      return reply.status(201).send(value);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/evidence-requests/:id/fulfill",
    async (request) => {
      const input = EvidenceFulfillmentInputSchema.parse(request.body);
      return container.service.fulfillEvidenceRequest(
        request.params.id,
        input,
        identityFrom(request),
      );
    },
  );

  app.post("/v1/reviews", async (request, reply) => {
    const input = ReviewRequestInputSchema.parse(request.body);
    const review = await container.service.submitReview(input, identityFrom(request));
    return reply.status(201).send(review);
  });

  app.post("/v1/review-decisions", async (request, reply) => {
    const input = ReviewDecisionInputSchema.parse(request.body);
    const decision = await container.service.decideReview(
      input,
      identityFrom(request),
    );
    return reply.status(201).send(decision);
  });

  app.post("/v1/agent-protocol/review-decisions", async (request) => {
    const envelope = inboundAgentEnvelope(request, {
      messageType: "REVIEW_DECISION",
      sender: "AGT-RSN-006",
    });
    const claimed = await container.repository.claimInboundMessage(
      envelope.messageId,
      envelope.idempotencyKey,
      envelope.organizationId,
    );
    if (!claimed) return { duplicate: true, messageId: envelope.messageId };
    try {
      const payload = ReviewDecisionPayloadSchema.parse(envelope.payload);
      const result = await container.service.decideReview(payload.decision, {
        organizationId: envelope.organizationId,
        userId: envelope.sender,
        role: "REVIEWER",
      });
      await container.repository.completeInboundMessage(
        envelope.messageId,
        envelope.organizationId,
      );
      return { duplicate: false, messageId: envelope.messageId, result };
    } catch (error) {
      await container.repository.releaseInboundMessage(
        envelope.messageId,
        envelope.organizationId,
      );
      throw error;
    }
  });

  app.post("/v1/content-packages", async (request, reply) => {
    const input = CreateContentPackageInputSchema.parse(request.body);
    const value = await container.service.createPackage(input, identityFrom(request));
    return reply.status(201).send(value);
  });

  app.get<{
    Params: { id: string };
    Querystring: { format?: "json" | "markdown" | "html" | "docx" };
  }>("/v1/content-packages/:id/export", async (request, reply) => {
    const contentPackage = await container.service.getPackage(
      request.params.id,
      identityFrom(request),
    );
    const result = await exportContentPackage(
      contentPackage,
      request.query.format ?? "json",
    );
    return reply
      .header("content-type", result.contentType)
      .header(
        "content-disposition",
        `attachment; filename="${request.params.id}.${result.extension}"`,
      )
      .send(result.body);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/content-packages/:id/deliver",
    async (request) => {
      const input = DeliverBodySchema.parse(request.body);
      return container.service.deliverPackage(
        request.params.id,
        input.target,
        identityFrom(request),
      );
    },
  );

  app.post("/v1/skills/import", async (request, reply) => {
    const input = SkillImportInputSchema.parse(request.body);
    const value = await container.service.importSkill(input, identityFrom(request));
    return reply.status(201).send(value);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/skills/:id/test",
    async (request) => {
      const input = SkillRegressionInputSchema.parse(request.body);
      return container.service.testSkill(
        request.params.id,
        input,
        identityFrom(request),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/skills/:id/activate",
    async (request) => {
      const input = ActivateSkillBodySchema.parse(request.body);
      return container.service.activateSkill(
        request.params.id,
        input.versionId,
        identityFrom(request),
      );
    },
  );

  app.addHook("onClose", async () => {
    await container.close();
  });
  return app;
}
