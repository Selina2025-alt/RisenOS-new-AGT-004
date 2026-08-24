import { BalalaVariantPackageSchema, type ArtifactRef, type GeoSeoRequest } from "@risen/content-contracts";
import { z } from "zod";

import { AgentRegistry, LocalAgentRuntime } from "./agent-runtime.js";
import {
  HostBackedBalalaVariantAgent,
  HostBackedContentOrchestratorAgent,
  HostBackedLilithReviewAgent,
  HostBackedMakabakaAgent,
  HostBackedPublicResearchAgent,
  HostBackedXiaodiandianAgent,
} from "./child-agents.js";
import type { AgentTaskStore } from "./local-agent-store.js";
import type { TopicRadarPort } from "./topic-radar.js";
import { newId, sha256 } from "./utils.js";
import { versionedPrompt } from "./version.js";

export interface V55HandlerAgents {
  topicRadar: TopicRadarPort;
  publicResearcher: HostBackedPublicResearchAgent;
  makabaka: HostBackedMakabakaAgent;
  contentOrchestrator: HostBackedContentOrchestratorAgent;
  lilith: HostBackedLilithReviewAgent;
  xiaodiandian: HostBackedXiaodiandianAgent;
  balala: HostBackedBalalaVariantAgent;
}

async function readInputs(store: AgentTaskStore, task: {
  inputArtifactRefs: ArtifactRef[];
  dependencyTaskIds: string[];
}): Promise<unknown[]> {
  const dependencyRefs = (await Promise.all(task.dependencyTaskIds.map(async (taskId) =>
    (await store.getTaskResult(taskId))?.outputArtifactRefs ?? []
  ))).flat();
  const refs = [...new Map([...task.inputArtifactRefs, ...dependencyRefs].map((ref) => [ref.artifactId, ref])).values()];
  return Promise.all(refs.map(async (ref) => {
    const stored = await store.getArtifact(ref.artifactId);
    if (!stored) throw new Error(`Input artifact ${ref.artifactId} is unavailable`);
    if (stored.payload && typeof stored.payload === "object" && "output" in stored.payload) {
      return (stored.payload as { output: unknown }).output;
    }
    return stored.payload;
  }));
}

async function persistOutput(store: AgentTaskStore, task: {
  recipientAgentId: ArtifactRef["createdByAgent"];
  taskId: string;
  organizationId: string;
  inputArtifactRefs: ArtifactRef[];
  agentVersion: string;
  skillSnapshot: string[];
}, payload: unknown, artifactType: string, rolloutMode: "OFF" | "SHADOW" | "ENFORCING"): Promise<ArtifactRef[]> {
  const artifactId = newId("artifact");
  const wrapped = {
    schemaVersion: "1.0.0",
    agentVersion: task.agentVersion,
    promptVersion: versionedPrompt(task.recipientAgentId),
    skillSnapshot: task.skillSnapshot,
    rolloutMode,
    inputHash: sha256(JSON.stringify(task.inputArtifactRefs.map((ref) => ref.contentHash))),
    output: payload,
  };
  const canonical = JSON.stringify(wrapped, null, 2) + "\n";
  const ref: ArtifactRef = {
    artifactId,
    artifactType,
    schemaVersion: "1.0.0",
    contentHash: sha256(canonical),
    uri: `local://artifacts/${artifactId}.json`,
    mimeType: "application/json",
    rights: "internal",
    createdByAgent: task.recipientAgentId,
    sourceRefs: task.inputArtifactRefs.map((item) => item.artifactId),
    parentArtifactIds: task.inputArtifactRefs.map((item) => item.artifactId),
    status: "READY",
  };
  await store.saveArtifact({ ref, payload: wrapped, organizationId: task.organizationId });
  return [ref];
}

export function registerV55HostHandlers(
  runtime: LocalAgentRuntime,
  store: AgentTaskStore,
  agents: V55HandlerAgents,
  registry: AgentRegistry,
): void {
  runtime.registerHandler("topic-radar", async (task, context) => {
    const output = await agents.topicRadar.run({
      organizationId: task.organizationId,
      traceId: task.traceId,
      requestedBy: task.createdBy,
    }, context.signal);
    return persistOutput(store, task, output, "topic_radar_result", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("public-researcher", async (task) => {
    const inputs = await readInputs(store, task);
    const output = await agents.publicResearcher.research({
      query: { artifacts: inputs },
      traceId: task.traceId,
      idempotencyKey: task.idempotencyKey,
    });
    return persistOutput(store, task, z.record(z.string(), z.unknown()).parse(output), "research_pack", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("makabaka", async (task) => {
    const inputs = await readInputs(store, task);
    const output = await agents.makabaka.match({
      context: { taskType: task.taskType, artifacts: inputs },
      traceId: task.traceId,
      idempotencyKey: task.idempotencyKey,
    });
    return persistOutput(store, task, z.record(z.string(), z.unknown()).parse(output), task.taskType === "KNOWLEDGE_MATCH_POST_DRAFT" ? "post_draft_check" : "knowledge_snapshot_and_fusion_plan", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("content-orchestrator", async (task) => {
    const inputs = await readInputs(store, task);
    const output = await agents.contentOrchestrator.draft({
      context: { artifacts: inputs },
      traceId: task.traceId,
      idempotencyKey: task.idempotencyKey,
    });
    return persistOutput(store, task, z.record(z.string(), z.unknown()).parse(output), "draft_proposal", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("lilith", async (task) => {
    const inputs = await readInputs(store, task) as Array<Record<string, unknown>>;
    if (task.taskType.startsWith("LIGHT_VARIANT_REVIEW_")) {
      const sourceContent = inputs.find((item) => item.assetId && item.contentHash && item.body);
      const variant = inputs.find((item) => item.agent === "balala" || item.variantId);
      if (!sourceContent || !variant) throw new Error("Lilith variant review requires source ContentVersion and Balala output");
      const output = await agents.lilith.reviewVariant({
        sourceContent: sourceContent as Parameters<HostBackedLilithReviewAgent["reviewVariant"]>[0]["sourceContent"],
        variant,
        channel: task.taskType.replace("LIGHT_VARIANT_REVIEW_", "").toLowerCase(),
        traceId: task.traceId,
        idempotencyKey: task.idempotencyKey,
      });
      return persistOutput(store, task, output, "variant_review_report", registry.get(task.recipientAgentId).rolloutMode);
    }
    const envelope = inputs.find((item) => item.reviewRequest && item.content);
    if (!envelope) throw new Error("Lilith requires an artifact containing reviewRequest and content");
    const output = await agents.lilith.review({
      reviewRequest: envelope.reviewRequest as Parameters<HostBackedLilithReviewAgent["review"]>[0]["reviewRequest"],
      content: envelope.content as Parameters<HostBackedLilithReviewAgent["review"]>[0]["content"],
      traceId: task.traceId,
    });
    return persistOutput(store, task, output, "review_report", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("xiaodiandian", async (task) => {
    const inputs = await readInputs(store, task) as Array<Record<string, unknown>>;
    const request = inputs.find((item) => item.requestId && item.sourceContentVersionId);
    if (!request) throw new Error("Xiaodiandian requires a GeoSeoRequest artifact");
    const output = await agents.xiaodiandian.optimize(request as GeoSeoRequest);
    return persistOutput(store, task, output, "geo_seo_proposal", registry.get(task.recipientAgentId).rolloutMode);
  });
  runtime.registerHandler("balala", async (task) => {
    const inputs = await readInputs(store, task);
    const output = await agents.balala.generate({
      variantBrief: { artifacts: inputs, taskType: task.taskType },
      traceId: task.traceId,
    });
    return persistOutput(store, task, BalalaVariantPackageSchema.parse(output), "variant_proposal", registry.get(task.recipientAgentId).rolloutMode);
  });
}
