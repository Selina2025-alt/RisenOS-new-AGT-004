import {
  ContentService,
  createV55TeamRuntime,
  InMemoryContentRepository,
  RuleBasedPolicyPort,
  V55GovernanceStore,
  type ContextPort,
  type HandoffPort,
  type HostModelPort,
  type ReviewPort,
} from "@risen/content-core";
import { signAgentEnvelope } from "@risen/content-adapters";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const repository = new InMemoryContentRepository();
const hostModel: HostModelPort = {
  async generateObject() {
    throw new Error("not used in API contract test");
  },
};
const context: ContextPort = {
  async resolveMissionContext() {
    return {};
  },
};
const review: ReviewPort = { async submit() {} };
const handoff: HandoffPort = {
  async deliver(contentPackage, target) {
    return {
      receiptId: `receipt_${contentPackage.id}`,
      packageId: contentPackage.id,
      contentHash: contentPackage.contentHash,
      acceptedAt: new Date().toISOString(),
      receiver: target,
    };
  },
};
const service = new ContentService({
  repository,
  hostModel,
  context,
  policy: new RuleBasedPolicyPort(),
  review,
  handoff,
  governanceGate: {
    async assertMissionReady() {},
    async assertGeneratedContent() {},
  },
});
const governance = new V55GovernanceStore(".codex-tmp/api-v55-test");
const teamRuntime = await createV55TeamRuntime({
  workspaceRoot: process.cwd(),
  storeRoot: ".codex-tmp/api-team-runtime-test",
  hostModel,
  registryManifestPath: false,
});
const app = await buildApp({
  repository,
  service,
  governance,
  canonSourceHashesById: {},
  teamRuntime,
  async ready() {
    return { database: "ok", queue: "disabled", teamRuntime: "READY" };
  },
  async close() {},
});

afterEach(async () => {
  // Fastify inject does not open a listening socket; no cleanup is required here.
});

describe("content API", () => {
  it("advertises a content-only healthy service", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "AGT-RSN-004",
      domain: "content-only",
      platformConnections: false,
    });
  });

  it("reports dependency readiness separately from process health", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      database: "ok",
      queue: "disabled",
      teamRuntime: "READY",
    });
  });

  it("creates a mission without platform credentials or publishing fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/missions",
      headers: {
        "x-organization-id": "org_api001",
        "x-user-id": "user_api001",
        "x-role": "CREATOR",
      },
      payload: {
        title: "API 内容任务",
        objective: "验证任务创建契约",
        strategy: "专业、可信",
        audience: ["内容负责人"],
        message: "内容资产可审计",
        contentPlan: "生成一份内容初稿",
        claims: [],
        evidence: [],
        brandRules: [],
        policies: [],
        requestedOutputs: ["content_brief", "outline", "content"],
        channels: ["wechat"],
        locales: ["zh-CN"],
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.mission.organizationId).toBe("org_api001");
    expect(body.mission.status).toBe("DRAFT");
    expect(JSON.stringify(body)).not.toMatch(
      /accessToken|scheduledAt|publishStatus|platformContentId/,
    );
  });

  it("reports the seven registered handlers and honest shadow rollout state", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/agents/runtime-health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "READY",
      registeredHandlers: expect.arrayContaining([
        "topic-radar", "public-researcher", "makabaka", "content-orchestrator",
        "lilith", "xiaodiandian", "balala",
      ]),
      shadowAgents: expect.arrayContaining(["lilith", "xiaodiandian", "balala"]),
      missingHandlers: [],
      hostModelAvailable: true,
    });
  });

  it("persists a confirmed perspective before a public-topic mission can draft", async () => {
    const identityHeaders = {
      "x-organization-id": "org_api_v55",
      "x-user-id": "user_api_v55",
      "x-role": "CREATOR",
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/missions",
      headers: identityHeaders,
      payload: {
        title: "V5.5 预检",
        objective: "验证视角契约",
        strategy: "公开研究",
        audience: ["企业管理者"],
        message: "解释公开AI话题",
        contentPlan: "公众号文章",
        requestedOutputs: ["content"],
        channels: ["wechat"],
        locales: ["zh-CN"],
      },
    });
    const missionId = created.json().mission.id as string;
    const response = await app.inject({
      method: "POST",
      url: `/v1/missions/${missionId}/preflight`,
      headers: identityHeaders,
      payload: {
        preflight: {
          missionClass: "PUBLIC_TOPIC",
          enterpriseRelevance: "NONE",
          topicEntities: ["AI"],
          publicationScope: "EXTERNAL_DRAFT",
          riskLevel: "LOW",
          requiresPublicResearch: true,
          requiresEnterpriseKnowledge: false,
          requiresNomosPolicy: false,
          requiresCasePolicy: false,
        },
        perspective: {
          speaker: "艾氪智能",
          audience: ["企业管理者"],
          channel: "wechat",
          voicePositioning: "第一方真诚分享",
          publicationScope: "EXTERNAL_DRAFT",
          narrativeLevel: "BUSINESS",
          brandNaming: "NOT_APPLICABLE",
          confirmationMode: "EXPLICIT_HUMAN",
          confirmedBy: "user_api_v55",
          confirmedAt: new Date().toISOString(),
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      preflight: { status: "READY", missionId },
      perspective: { status: "CONFIRMED", missionId },
    });
  });

  it("accepts a signed AGT-003 fulfillment exactly once", async () => {
    const identity = {
      organizationId: "org_api_protocol",
      userId: "user_api_protocol",
      role: "CREATOR" as const,
    };
    const claimId = "claim_api_protocol";
    const evidenceId = "evidence_api_protocol";
    const created = await service.createMission(
      {
        title: "Protocol contract",
        objective: "Verify authenticated evidence fulfillment",
        strategy: "Evidence first",
        audience: ["Content team"],
        message: "Only verified claims may proceed",
        contentPlan: "Create one content asset",
        claims: [
          {
            id: claimId,
            statement: "A factual statement requiring evidence",
            factual: true,
            evidenceIds: [],
            riskLevel: "MEDIUM",
          },
        ],
        evidence: [],
        brandRules: [],
        policies: [],
        requestedOutputs: ["content"],
        channels: ["generic"],
        locales: ["zh-CN"],
        highRisk: false,
      },
      identity,
    );
    const evidenceRequest = await service.createEvidenceRequest(
      created.mission.id,
      ["Supply verified evidence"],
      [claimId],
      identity,
    );
    const protocolSecret = "api-agent-protocol-secret-at-least-32-bytes";
    process.env.AGENT_PROTOCOL_HMAC_SECRET = protocolSecret;
    const envelope = {
      protocolVersion: "1.0" as const,
      messageId: "message_api_protocol",
      messageType: "EVIDENCE_FULFILLMENT" as const,
      sender: "AGT-RSN-003" as const,
      recipient: "AGT-RSN-004" as const,
      organizationId: identity.organizationId,
      traceId: created.mission.traceId,
      idempotencyKey: "fulfillment_api_protocol",
      sentAt: new Date().toISOString(),
      payload: {
        evidenceRequestId: evidenceRequest.id,
        fulfillment: {
          protocolVersion: "1.0",
          idempotencyKey: "fulfillment_api_protocol",
          fulfilledBy: "AGT-RSN-003",
          evidence: [
            {
              id: evidenceId,
              title: "Verified source",
              sourceType: "agt003",
              sourceRef: "agt003://evidence/api-protocol",
              excerpt: "Evidence supporting the requested factual statement.",
              verified: true,
              verifiedBy: "AGT-RSN-003",
              verifiedAt: new Date().toISOString(),
              rights: { status: "CLEARED", restrictions: [] },
            },
          ],
          claimBindings: [{ claimId, evidenceIds: [evidenceId] }],
        },
      },
    };
    const headers = {
      "x-risen-signature": signAgentEnvelope(envelope, protocolSecret),
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/agent-protocol/evidence-fulfillments",
      headers,
      payload: envelope,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ duplicate: false });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/agent-protocol/evidence-fulfillments",
      headers,
      payload: envelope,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ duplicate: true });
    delete process.env.AGENT_PROTOCOL_HMAC_SECRET;
  });
});
