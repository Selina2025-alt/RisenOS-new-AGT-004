import { randomUUID } from "node:crypto";

import {
  AgentDefinitionSchema,
  AgentTaskSchema,
  type AgentDefinition,
  type AgentTask,
  type AgentTaskStatus,
  type ArtifactRef,
} from "@risen/content-contracts";

import { ConflictError } from "./errors.js";
import type { LocalAgentStore } from "./local-agent-store.js";
import { newId, nowIso } from "./utils.js";

export interface TaskResult {
  taskId: string;
  status: Extract<AgentTaskStatus, "SUCCEEDED" | "FAILED" | "BLOCKED" | "CANCELLED" | "EXPIRED">;
  outputArtifactRefs: ArtifactRef[];
  error?: string;
}

export interface TaskHandle {
  taskId: string;
  completion: Promise<TaskResult>;
}

export interface AgentTaskHandlerContext {
  readonly signal: AbortSignal;
  readonly task: AgentTask;
  assertCanWriteContentVersion(): void;
}

export type AgentTaskHandler = (
  task: AgentTask,
  context: AgentTaskHandlerContext,
) => Promise<ArtifactRef[]>;

export class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();

  register(input: AgentDefinition): AgentDefinition {
    const definition = AgentDefinitionSchema.parse(input);
    if (this.definitions.has(definition.agentId)) {
      throw new ConflictError("AGENT_ALREADY_REGISTERED", `Agent ${definition.agentId} is already registered`);
    }
    this.definitions.set(definition.agentId, definition);
    return definition;
  }

  replace(input: AgentDefinition): AgentDefinition {
    const definition = AgentDefinitionSchema.parse(input);
    this.definitions.set(definition.agentId, definition);
    return definition;
  }

  get(agentId: string): AgentDefinition {
    const definition = this.definitions.get(agentId);
    if (!definition) throw new ConflictError("AGENT_NOT_FOUND", `Agent ${agentId} is not registered`);
    return definition;
  }

  list(): AgentDefinition[] {
    return [...this.definitions.values()];
  }

  assertActive(agentId: string): AgentDefinition {
    const definition = this.get(agentId);
    if (definition.status !== "ACTIVE") {
      throw new ConflictError("AGENT_NOT_ACTIVE", `Agent ${agentId} is not active`);
    }
    return definition;
  }

  assertCanWriteContentVersion(agentId: string): void {
    if (!this.get(agentId).canWriteContentVersion) {
      throw new ConflictError(
        "AGENT_WRITE_FORBIDDEN",
        `Agent ${agentId} cannot write ContentVersion directly`,
      );
    }
  }

  assertCannotApprove(agentId: string): void {
    if (this.get(agentId).canApprove) {
      throw new ConflictError("AGENT_APPROVAL_FORBIDDEN", "Internal agents cannot approve their own output");
    }
  }
}

export interface LocalAgentRuntimeOptions {
  maxConcurrency?: number;
  leaseMs?: number;
  clock?: () => number;
  store?: LocalAgentStore;
}

/**
 * A bounded, host-independent local scheduler for the headless Codex mode.
 * Production workers can implement the same interface on top of BullMQ or
 * Temporal without changing task contracts.
 */
export class LocalAgentRuntime {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly results = new Map<string, TaskResult>();
  private readonly handlers = new Map<string, AgentTaskHandler>();
  private readonly waiters = new Map<string, Array<(result: TaskResult) => void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly idempotency = new Map<string, string>();
  private running = 0;
  private draining = false;
  private readonly maxConcurrency: number;
  private readonly leaseMs: number;
  private readonly clock: () => number;
  private readonly store: LocalAgentStore | undefined;
  private storageError?: Error;
  private persistenceQueue: Promise<void>[] = [];

  public constructor(private readonly registry: AgentRegistry, options: LocalAgentRuntimeOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.leaseMs = options.leaseMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
    this.store = options.store;
  }

  registerHandler(agentId: string, handler: AgentTaskHandler): void {
    this.registry.assertActive(agentId);
    if (this.handlers.has(agentId)) throw new ConflictError("HANDLER_ALREADY_REGISTERED", agentId);
    this.handlers.set(agentId, handler);
  }

  dispatch(input: AgentTask): TaskHandle {
    if (this.storageError) {
      throw new ConflictError("AGENT_STORAGE_NOT_READY", this.storageError.message);
    }
    const task = AgentTaskSchema.parse(input);
    this.registry.assertActive(task.recipientAgentId);
    this.registry.assertCannotApprove(task.recipientAgentId);
    const existingTaskId = this.idempotency.get(task.idempotencyKey);
    if (existingTaskId) return this.handle(existingTaskId);
    if (this.tasks.has(task.taskId)) throw new ConflictError("TASK_ALREADY_EXISTS", task.taskId);
    const dependenciesReady = task.dependencyTaskIds.every((id) => this.results.get(id)?.status === "SUCCEEDED");
    const stored: AgentTask = {
      ...task,
      status: dependenciesReady ? "READY" : "WAITING_INPUT",
      attempt: 0,
      updatedAt: nowIso(),
    };
    this.tasks.set(task.taskId, stored);
    this.persist(stored, "TASK_QUEUED");
    this.idempotency.set(task.idempotencyKey, task.taskId);
    void this.drain();
    return this.handle(task.taskId);
  }

  async await(taskId: string): Promise<TaskResult> {
    const existing = this.results.get(taskId);
    if (existing) return existing;
    if (!this.tasks.has(taskId)) throw new ConflictError("TASK_NOT_FOUND", taskId);
    return new Promise<TaskResult>((resolve) => {
      const waiters = this.waiters.get(taskId) ?? [];
      waiters.push(resolve);
      this.waiters.set(taskId, waiters);
    });
  }

  async pause(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (this.isTerminal(task.status)) return;
    this.abortControllers.get(taskId)?.abort();
    this.tasks.set(taskId, { ...task, status: "WAITING_HUMAN", updatedAt: nowIso() });
    this.persist(this.tasks.get(taskId)!, "TASK_PAUSED");
  }

  async resume(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (task.status !== "WAITING_HUMAN" && task.status !== "WAITING_INPUT") return;
    const ready = task.dependencyTaskIds.every((id) => this.results.get(id)?.status === "SUCCEEDED");
    this.tasks.set(taskId, { ...task, status: ready ? "READY" : "WAITING_INPUT", updatedAt: nowIso() });
    this.persist(this.tasks.get(taskId)!, "TASK_RESUMED");
    void this.drain();
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (this.isTerminal(task.status)) return;
    this.abortControllers.get(taskId)?.abort();
    this.finish(task, { taskId, status: "CANCELLED", outputArtifactRefs: [] });
  }

  async retry(taskId: string, reason: string): Promise<void> {
    const task = this.getTask(taskId);
    if (task.attempt >= task.maxAttempts) {
      this.finish(task, { taskId, status: "FAILED", outputArtifactRefs: [], error: reason });
      return;
    }
    const ready = task.dependencyTaskIds.every((id) => this.results.get(id)?.status === "SUCCEEDED");
    this.tasks.set(taskId, {
      ...task,
      status: ready ? "READY" : "WAITING_INPUT",
      attempt: task.attempt + 1,
      error: reason,
      updatedAt: nowIso(),
    });
    this.persist(this.tasks.get(taskId)!, "TASK_RETRYING");
    void this.drain();
  }

  getTask(taskId: string): AgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new ConflictError("TASK_NOT_FOUND", taskId);
    return task;
  }

  listTasks(): AgentTask[] {
    return [...this.tasks.values()];
  }

  storageHealth(): { ok: boolean; error?: string } {
    return this.storageError ? { ok: false, error: this.storageError.message } : { ok: true };
  }

  async flushPersistence(): Promise<void> {
    const pending = this.persistenceQueue;
    this.persistenceQueue = [];
    await Promise.all(pending);
    if (this.storageError) throw new ConflictError("AGENT_STORAGE_NOT_READY", this.storageError.message);
  }

  private handle(taskId: string): TaskHandle {
    return { taskId, completion: this.await(taskId) };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.running < this.maxConcurrency) {
        const next = [...this.tasks.values()].find((task) => task.status === "READY");
        if (!next) break;
        this.running += 1;
        void this.execute(next).finally(() => {
          this.running -= 1;
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(task: AgentTask): Promise<void> {
    const handler = this.handlers.get(task.recipientAgentId);
    if (!handler) {
      this.finish(task, { taskId: task.taskId, status: "FAILED", outputArtifactRefs: [], error: "NO_AGENT_HANDLER" });
      return;
    }
    const controller = new AbortController();
    this.abortControllers.set(task.taskId, controller);
    const started = this.clock();
    const leaseExpiresAt = new Date(started + this.leaseMs).toISOString();
    const running: AgentTask = {
      ...task,
      status: "RUNNING",
      attempt: task.attempt + 1,
      updatedAt: nowIso(),
      lease: {
        owner: `local-${process.pid}-${randomUUID()}`,
        acquiredAt: new Date(started).toISOString(),
        heartbeatAt: new Date(started).toISOString(),
        expiresAt: leaseExpiresAt,
      },
    };
    this.tasks.set(task.taskId, running);
    this.persist(running, "TASK_RUNNING");
    try {
      const output = await handler(running, {
        signal: controller.signal,
        task: running,
        assertCanWriteContentVersion: () => this.registry.assertCanWriteContentVersion(running.recipientAgentId),
      });
      if (controller.signal.aborted) {
        this.finish(running, { taskId: task.taskId, status: "CANCELLED", outputArtifactRefs: [] });
      } else if (this.clock() > Date.parse(leaseExpiresAt)) {
        this.finish(running, { taskId: task.taskId, status: "EXPIRED", outputArtifactRefs: [], error: "LEASE_EXPIRED" });
      } else {
        this.finish(running, { taskId: task.taskId, status: "SUCCEEDED", outputArtifactRefs: output });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(running, { taskId: task.taskId, status: "FAILED", outputArtifactRefs: [], error: message });
    } finally {
      this.abortControllers.delete(task.taskId);
    }
  }

  private finish(task: AgentTask, result: TaskResult): void {
    this.results.set(task.taskId, result);
    this.tasks.set(task.taskId, {
      ...task,
      status: result.status,
      error: result.error,
      updatedAt: nowIso(),
      lease: undefined,
    });
    this.persist(this.tasks.get(task.taskId)!, `TASK_${result.status}`);
    for (const [id, dependent] of this.tasks.entries()) {
      if (dependent.status !== "WAITING_INPUT") continue;
      if (!dependent.dependencyTaskIds.includes(task.taskId)) continue;
      if (dependent.dependencyTaskIds.every((dependencyId) => this.results.get(dependencyId)?.status === "SUCCEEDED")) {
        this.tasks.set(id, { ...dependent, status: "READY", updatedAt: nowIso() });
      } else if (dependent.dependencyTaskIds.some((dependencyId) => {
        const dependency = this.results.get(dependencyId);
        return dependency && dependency.status !== "SUCCEEDED";
      })) {
        this.finish(dependent, { taskId: id, status: "BLOCKED", outputArtifactRefs: [], error: "DEPENDENCY_FAILED" });
      }
    }
    const waiters = this.waiters.get(task.taskId) ?? [];
    this.waiters.delete(task.taskId);
    for (const resolve of waiters) resolve(result);
  }

  private isTerminal(status: AgentTaskStatus): boolean {
    return ["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "EXPIRED"].includes(status);
  }

  private persist(task: AgentTask, event: string): void {
    if (!this.store) return;
    const operation = Promise.all([
      this.store.saveTask(task),
      this.store.appendEvent({
        event,
        taskId: task.taskId,
        missionId: task.missionId,
        organizationId: task.organizationId,
        traceId: task.traceId,
        at: nowIso(),
      }),
    ]).catch((error: unknown) => {
      this.storageError = error instanceof Error ? error : new Error(String(error));
    });
    this.persistenceQueue.push(operation.then(() => undefined));
  }
}

export function createDefaultAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  const base = {
    inputSchemas: ["artifact_ref"],
    skills: [],
    forbiddenTools: ["publish", "platform_monitoring", "learning_proposal"],
    canWriteContentVersion: false,
    canWriteKnowledge: false,
    canWriteSkill: false,
    canApprove: false,
    maxConcurrency: 1,
    timeoutMs: 120_000,
    maxRetries: 2,
    supportsPauseResume: true,
    requiresHumanGate: true,
    status: "ACTIVE" as const,
  };
  registry.register({
    ...base,
    agentId: "agt-004",
    version: "5.3.0",
    role: "supervisor",
    description: "Content domain supervisor and immutable version writer",
    outputSchemas: ["content_version", "content_package"],
    allowedTools: ["host_model", "host_image", "public_read_research", "local_knowledge"],
    canWriteContentVersion: true,
    requiresHumanGate: true,
    manifestHash: "agt-004-v5.3",
  });
  registry.register({
    ...base,
    agentId: "lilith",
    version: "5.3.0",
    role: "reviewer",
    description: "Content, logic, AI-style, compliance and GEO/SEO issue reviewer",
    outputSchemas: ["review_report", "review_issue"],
    allowedTools: ["local_knowledge", "research_pack"],
    manifestHash: "lilith-v5.3",
  });
  registry.register({
    ...base,
    agentId: "xiaodiandian",
    version: "5.3.0",
    role: "geo_seo_optimizer",
    description: "Content-only SEO/GEO optimization proposal agent",
    outputSchemas: ["geo_seo_proposal", "technical_geo_recommendation"],
    allowedTools: ["local_knowledge", "public_read_research"],
    manifestHash: "xiaodiandian-v5.3",
  });
  registry.register({
    ...base,
    agentId: "balala",
    version: "5.3.0",
    role: "variant_agent",
    description: "Channel variant and asset brief agent",
    outputSchemas: ["channel_variant", "asset_brief"],
    allowedTools: ["host_model", "public_read_research"],
    manifestHash: "balala-v5.3",
  });
  return registry;
}

export function createAgentTask(input: Omit<AgentTask, "id" | "createdAt" | "updatedAt" | "status" | "attempt"> & { status?: AgentTaskStatus }): AgentTask {
  const now = nowIso();
  return AgentTaskSchema.parse({
    ...input,
    id: input.taskId,
    status: input.status ?? "QUEUED",
    attempt: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export function newTaskId(): string {
  return newId("task");
}
