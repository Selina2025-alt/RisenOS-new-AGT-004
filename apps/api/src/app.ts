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
  ReviewDecisionInputSchema,
  ReviewRequestInputSchema,
  SkillImportInputSchema,
  SkillRegressionInputSchema,
  type AgentMessageEnvelope,
  type RequestIdentity,
} from "@risen/content-contracts";
import { verifyAgentEnvelope } from "@risen/content-adapters";
import { DomainError } from "@risen/content-core";
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
