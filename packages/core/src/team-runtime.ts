import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentDefinition, AgentId } from "@risen/content-contracts";

import {
  AgentRegistry,
  LocalAgentRuntime,
  createDefaultAgentRegistry,
  type InternalAgentRuntime,
} from "./agent-runtime.js";
import {
  HostBackedBalalaVariantAgent,
  HostBackedContentOrchestratorAgent,
  HostBackedLilithReviewAgent,
  HostBackedMakabakaAgent,
  HostBackedPackagingCopyAgent,
  HostBackedPublicResearchAgent,
  HostBackedXiaodiandianAgent,
} from "./child-agents.js";
import { LocalAgentStore, type AgentTaskStore } from "./local-agent-store.js";
import type { HostModelPort } from "./ports.js";
import { LocalTopicRadarPort, type TopicRadarPort } from "./topic-radar.js";
import { registerV55HostHandlers } from "./v55-handlers.js";
import { TeamWorkflowCoordinator } from "./team-coordinator.js";

export const V56_INTERNAL_AGENT_IDS: AgentId[] = [
  "topic-radar",
  "public-researcher",
  "makabaka",
  "content-orchestrator",
  "lilith",
  "xiaodiandian",
  "balala",
  "packaging-copy-agent",
];
export const V55_INTERNAL_AGENT_IDS = V56_INTERNAL_AGENT_IDS;

export interface TeamRuntimeHealth {
  status: "READY" | "DEGRADED" | "NOT_READY";
  registryManifestHash?: string;
  registeredHandlers: AgentId[];
  enforcingAgents: AgentId[];
  shadowAgents: AgentId[];
  missingHandlers: AgentId[];
  storage: { ok: boolean; error?: string };
  hostModelAvailable: boolean;
  titleCorpusAvailable: boolean;
}

export interface TeamRuntimeBundle {
  registry: AgentRegistry;
  runtime: InternalAgentRuntime;
  localRuntime: LocalAgentRuntime;
  store: AgentTaskStore;
  coordinator: TeamWorkflowCoordinator;
  health(): Promise<TeamRuntimeHealth>;
  close(): Promise<void>;
}

export interface CreateTeamRuntimeOptions {
  workspaceRoot: string;
  hostModel?: HostModelPort;
  topicRadar?: TopicRadarPort;
  pythonExecutable?: string;
  storeRoot?: string;
  store?: AgentTaskStore;
  maxConcurrency?: number;
  maxConcurrencyPerOrganization?: number;
  autoExecute?: boolean;
  rolloutModes?: Partial<Record<AgentId, AgentDefinition["rolloutMode"]>>;
  registryManifestPath?: string | false;
  titleCorpus?: Record<string, unknown>[];
}

async function loadLocalTitleCorpus(workspaceRoot: string): Promise<Record<string, unknown>[]> {
  const resources = [
    ["manifest", "TITLE_CORPUS_MANIFEST_V1.json"],
    ["title_corpus", "TITLE_CORPUS_V1.json"],
    ["policy", "CHANNEL_PACKAGING_POLICY_V1.json"],
    ["golden", "PACKAGING_GOLDEN_SET_V1.json"],
    ["negative", "PACKAGING_NEGATIVE_SET_V1.json"],
  ] as const;
  const loaded: Record<string, unknown>[] = [];
  for (const [resourceType, fileName] of resources) {
    try {
      const content = JSON.parse(await readFile(join(workspaceRoot, "knowledge", "title-packaging", fileName), "utf8")) as Record<string, unknown>;
      if (resourceType === "title_corpus") {
        const records = Array.isArray(content.records) ? content.records : [];
        if (records.length < 50 || records.some((record) => {
          if (!record || typeof record !== "object") return true;
          const keys = Object.keys(record as Record<string, unknown>);
          return !keys.includes("title") || keys.some((key) => /instruction|prompt|analysis/iu.test(key));
        })) {
          throw new Error("The sanitized title corpus is incomplete or contains non-whitelisted fields");
        }
      }
      loaded.push({ resourceType, fileName, content });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    loaded.push({
      resourceType: "pattern_pack",
      fileName: "TITLE_PATTERN_PACK_V1.md",
      content: await readFile(join(workspaceRoot, "knowledge", "title-packaging", "TITLE_PATTERN_PACK_V1.md"), "utf8"),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return loaded;
}

export function assertEnforcingHandlersRegistered(
  registry: AgentRegistry,
  handlerIds: readonly string[],
): void {
  const available = new Set(handlerIds);
  const missing = registry.list()
    .filter((definition) => definition.agentId !== "agt-004" && definition.status === "ACTIVE" && definition.rolloutMode === "ENFORCING")
    .map((definition) => definition.agentId)
    .filter((agentId) => !available.has(agentId));
  if (missing.length) {
    throw new Error(`Team runtime refused startup: missing enforcing handlers ${missing.join(", ")}`);
  }
}

class UnavailableTeamHostModel implements HostModelPort {
  async generateObject(): Promise<never> {
    throw new Error("HOST_RUNTIME_UNAVAILABLE");
  }
}

async function validateRegistryManifest(
  registry: AgentRegistry,
  manifestPath: string | undefined,
): Promise<string | undefined> {
  if (!manifestPath) return undefined;
  const text = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(text) as {
    release?: string;
    agents?: Array<Pick<AgentDefinition, "agentId" | "version" | "manifestHash" | "rolloutMode" | "canWriteContentVersion" | "canApprove"> & Partial<Pick<AgentDefinition, "allowedTools" | "forbiddenTools" | "skills" | "outputSchemas" | "requiresHumanGate">>>;
  };
  if (!Array.isArray(manifest.agents)) throw new Error("Agent registry manifest is invalid");
  const configured = new Map(manifest.agents.map((agent) => [agent.agentId, agent]));
  const knownIds = new Set(registry.list().map((definition) => definition.agentId));
  const extras = [...configured.keys()].filter((agentId) => !knownIds.has(agentId));
  if (extras.length) throw new Error(`Agent registry manifest contains unknown agents: ${extras.join(", ")}`);
  for (const definition of registry.list()) {
    const declared = configured.get(definition.agentId);
    if (!declared) throw new Error(`Agent registry manifest is missing ${definition.agentId}`);
    const sameStrings = (left: string[], right: string[]) =>
      [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
    const packagingPermissionsInvalid = definition.agentId === "packaging-copy-agent" && (
      !declared.allowedTools || !sameStrings(declared.allowedTools, definition.allowedTools) ||
      !declared.forbiddenTools || !sameStrings(declared.forbiddenTools, definition.forbiddenTools) ||
      !declared.skills || !sameStrings(declared.skills, definition.skills) ||
      !declared.outputSchemas || !sameStrings(declared.outputSchemas, definition.outputSchemas) ||
      declared.requiresHumanGate !== definition.requiresHumanGate
    );
    if (
      declared.rolloutMode !== definition.rolloutMode ||
      declared.version !== definition.version ||
      declared.manifestHash !== definition.manifestHash ||
      declared.canWriteContentVersion !== definition.canWriteContentVersion ||
      declared.canApprove !== definition.canApprove ||
      packagingPermissionsInvalid
    ) {
      throw new Error(`Agent registry manifest differs from runtime for ${definition.agentId}`);
    }
  }
  return createHash("sha256").update(text).digest("hex");
}

async function loadManifestRolloutModes(manifestPath: string | undefined): Promise<Partial<Record<AgentId, AgentDefinition["rolloutMode"]>>> {
  if (!manifestPath) return {};
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    agents?: Array<{ agentId?: string; rolloutMode?: string; rolloutApprovedBy?: string; rolloutApprovedAt?: string }>;
  };
  if (!Array.isArray(manifest.agents)) throw new Error("Agent registry manifest is invalid");
  const output: Partial<Record<AgentId, AgentDefinition["rolloutMode"]>> = {};
  for (const agent of manifest.agents) {
    if (!agent.agentId || !["OFF", "SHADOW", "ENFORCING"].includes(agent.rolloutMode ?? "")) {
      throw new Error("Agent registry manifest contains an invalid rollout entry");
    }
    if (agent.agentId !== "agt-004" && agent.rolloutMode === "ENFORCING" && (!agent.rolloutApprovedBy || !agent.rolloutApprovedAt)) {
      throw new Error(`Agent ${agent.agentId} cannot be ENFORCING without versioned human rollout approval`);
    }
    output[agent.agentId as AgentId] = agent.rolloutMode as AgentDefinition["rolloutMode"];
  }
  return output;
}

export async function createV56TeamRuntime(options: CreateTeamRuntimeOptions): Promise<TeamRuntimeBundle> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const registryManifestPath = options.registryManifestPath === false
    ? undefined
    : options.registryManifestPath ?? join(workspaceRoot, "agents", "registry.v5.6.json");
  const manifestRolloutModes = await loadManifestRolloutModes(registryManifestPath);
  const registry = createDefaultAgentRegistry({
    rolloutModes: { ...manifestRolloutModes, ...(options.rolloutModes ?? {}) },
  });
  const registryManifestHash = await validateRegistryManifest(
    registry,
    registryManifestPath,
  );
  const store: AgentTaskStore = options.store ?? new LocalAgentStore(options.storeRoot ?? join(workspaceRoot, ".runtime", "v5.6", "team"));
  const runtime = new LocalAgentRuntime(registry, {
    store,
    maxConcurrency: options.maxConcurrency ?? 1,
    maxConcurrencyPerOrganization: options.maxConcurrencyPerOrganization ?? 8,
    autoExecute: options.autoExecute ?? true,
  });
  const hostModel = options.hostModel ?? new UnavailableTeamHostModel();
  const titleCorpus = options.titleCorpus ?? await loadLocalTitleCorpus(workspaceRoot);
  const titleCorpusAvailable = titleCorpus.some((resource) => resource.resourceType === "title_corpus");
  registerV55HostHandlers(runtime, store, {
    topicRadar: options.topicRadar ?? new LocalTopicRadarPort({
      workspaceRoot,
      ...(options.pythonExecutable ? { pythonExecutable: options.pythonExecutable } : {}),
    }),
    publicResearcher: new HostBackedPublicResearchAgent(hostModel),
    makabaka: new HostBackedMakabakaAgent(hostModel),
    contentOrchestrator: new HostBackedContentOrchestratorAgent(hostModel),
    lilith: new HostBackedLilithReviewAgent(hostModel),
    xiaodiandian: new HostBackedXiaodiandianAgent(hostModel),
    balala: new HostBackedBalalaVariantAgent(hostModel),
    packagingCopyAgent: new HostBackedPackagingCopyAgent(hostModel, titleCorpus),
  }, registry);
  assertEnforcingHandlersRegistered(registry, runtime.registeredHandlerIds());
  await runtime.restore();
  const coordinator = new TeamWorkflowCoordinator(runtime, store, registry);

  const health = async (): Promise<TeamRuntimeHealth> => {
    const handlers = runtime.registeredHandlerIds() as AgentId[];
    const missingHandlers = V56_INTERNAL_AGENT_IDS.filter((agentId) => !runtime.hasHandler(agentId));
    const enforcingAgents = V56_INTERNAL_AGENT_IDS.filter((agentId) => registry.isEnforcing(agentId));
    const shadowAgents = V56_INTERNAL_AGENT_IDS.filter((agentId) => registry.get(agentId).rolloutMode === "SHADOW");
    const enforcingMissing = enforcingAgents.filter((agentId) => missingHandlers.includes(agentId));
    const enforcingPackagingWithoutCorpus = enforcingAgents.includes("packaging-copy-agent") && !titleCorpusAvailable;
    const storage = runtime.storageHealth();
    return {
      status: enforcingMissing.length || enforcingPackagingWithoutCorpus || !storage.ok
        ? "NOT_READY"
        : missingHandlers.length || options.hostModel === undefined || !titleCorpusAvailable
          ? "DEGRADED"
          : "READY",
      ...(registryManifestHash ? { registryManifestHash } : {}),
      registeredHandlers: handlers,
      enforcingAgents,
      shadowAgents,
      missingHandlers,
      storage,
      hostModelAvailable: options.hostModel !== undefined,
      titleCorpusAvailable,
    };
  };
  const initialHealth = await health();
  if (initialHealth.status === "NOT_READY") {
    await runtime.close();
    throw new Error(`Team runtime refused startup: missing enforcing handlers ${initialHealth.missingHandlers.join(", ")}`);
  }
  return {
    registry,
    runtime,
    localRuntime: runtime,
    store,
    coordinator,
    health,
    close: async () => {
      await runtime.close();
      await store.close?.();
    },
  };
}

/** @deprecated Use createV56TeamRuntime. Kept only for V5.5 caller compatibility. */
export const createV55TeamRuntime = createV56TeamRuntime;
