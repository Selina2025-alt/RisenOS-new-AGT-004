import { randomUUID } from "node:crypto";

import {
  AgentDefinitionSchema,
  AgentTaskResultSchema,
  AgentTaskSchema,
  type AgentDefinition,
  type AgentTask,
  type AgentTaskStatus,
  type ArtifactRef,
} from "@risen/content-contracts";

import { ConflictError } from "./errors.js";
import type { AgentTaskStore } from "./local-agent-store.js";
import { newId, nowIso } from "./utils.js";
import { AGT004_PROJECT_VERSION } from "./version.js";

export interface TaskResult {
  taskId: string;
  status: Extract<AgentTaskStatus, "SUCCEEDED" | "FAILED" | "BLOCKED" | "CANCELLED" | "EXPIRED">;
  outputArtifactRefs: ArtifactRef[];
  error?: string;
}

export interface InternalAgentRuntime {
  dispatch(task: AgentTask): TaskHandle;
  await(taskId: string): Promise<TaskResult>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  retry(taskId: string, reason: string): Promise<void>;
  getTask(taskId: string): AgentTask;
  listTasks(): AgentTask[];
  activate(taskIds: string[]): void;
  recoverExpiredLeases(): void;
  isLocallyExecuting(taskId: string): boolean;
  restore(): Promise<void>;
  flushPersistence(): Promise<void>;
  close(): Promise<void>;
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

  assertRunnable(agentId: string): AgentDefinition {
    const definition = this.assertActive(agentId);
    if (definition.rolloutMode === "OFF") {
      throw new ConflictError("AGENT_ROLLOUT_OFF", `Agent ${agentId} rollout mode is OFF`);
    }
    return definition;
  }

  isEnforcing(agentId: string): boolean {
    return this.get(agentId).status === "ACTIVE" && this.get(agentId).rolloutMode === "ENFORCING";
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
  maxConcurrencyPerOrganization?: number;
  leaseMs?: number;
  clock?: () => number;
  store?: AgentTaskStore;
  autoExecute?: boolean;
}

/**
 * A bounded, host-independent local scheduler for the headless Codex mode.
 * Production workers can implement the same interface on top of BullMQ or
 * Temporal without changing task contracts.
 */
export class LocalAgentRuntime implements InternalAgentRuntime {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly results = new Map<string, TaskResult>();
  private readonly handlers = new Map<string, AgentTaskHandler>();
  private readonly waiters = new Map<string, Array<(result: TaskResult) => void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pausedAbortIds = new Set<string>();
  private readonly idempotency = new Map<string, string>();
  private running = 0;
  private draining = false;
  private readonly maxConcurrency: number;
  private readonly maxConcurrencyPerOrganization: number;
  private readonly runningByOrganization = new Map<string, number>();
  private readonly leaseMs: number;
  private readonly clock: () => number;
  private readonly store: AgentTaskStore | undefined;
  private storageError?: Error;
  private persistenceQueue: Promise<void>[] = [];
  private acceptingTasks = true;
  private readonly autoExecute: boolean;
  private readonly activatedTaskIds = new Set<string>();

  public constructor(private readonly registry: AgentRegistry, options: LocalAgentRuntimeOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.maxConcurrencyPerOrganization = options.maxConcurrencyPerOrganization ?? 8;
    this.leaseMs = options.leaseMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
    this.store = options.store;
    this.autoExecute = options.autoExecute ?? true;
  }

  registerHandler(agentId: string, handler: AgentTaskHandler): void {
    this.registry.assertRunnable(agentId);
    if (this.handlers.has(agentId)) throw new ConflictError("HANDLER_ALREADY_REGISTERED", agentId);
    this.handlers.set(agentId, handler);
  }

  registeredHandlerIds(): string[] {
    return [...this.handlers.keys()].sort();
  }

  hasHandler(agentId: string): boolean {
    return this.handlers.has(agentId);
  }

  dispatch(input: AgentTask): TaskHandle {
    if (!this.acceptingTasks) {
      throw new ConflictError("AGENT_RUNTIME_CLOSED", "Agent runtime is not accepting new tasks");
    }
    if (this.storageError) {
      throw new ConflictError("AGENT_STORAGE_NOT_READY", this.storageError.message);
    }
    const task = AgentTaskSchema.parse(input);
    this.registry.assertRunnable(task.recipientAgentId);
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
    if (this.autoExecute) void this.drain();
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
    if (task.status === "RUNNING") this.pausedAbortIds.add(taskId);
    this.abortControllers.get(taskId)?.abort();
    this.tasks.set(taskId, {
      ...task,
      status: "WAITING_HUMAN",
      attempt: task.status === "RUNNING" ? Math.max(0, task.attempt - 1) : task.attempt,
      lease: undefined,
      updatedAt: nowIso(),
    });
    this.persist(this.tasks.get(taskId)!, "TASK_PAUSED");
  }

  async resume(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (task.status !== "WAITING_HUMAN" && task.status !== "WAITING_INPUT") return;
    const ready = task.dependencyTaskIds.every((id) => this.results.get(id)?.status === "SUCCEEDED");
    this.tasks.set(taskId, { ...task, status: ready ? "READY" : "WAITING_INPUT", updatedAt: nowIso() });
    this.persist(this.tasks.get(taskId)!, "TASK_RESUMED");
    if (this.autoExecute) void this.drain();
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
    if (this.autoExecute) void this.drain();
  }

  getTask(taskId: string): AgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new ConflictError("TASK_NOT_FOUND", taskId);
    return task;
  }

  listTasks(): AgentTask[] {
    return [...this.tasks.values()];
  }

  activate(taskIds: string[]): void {
    for (const taskId of taskIds) {
      if (!this.tasks.has(taskId)) throw new ConflictError("TASK_NOT_FOUND", taskId);
      this.activatedTaskIds.add(taskId);
    }
    void this.drain();
  }

  isLocallyExecuting(taskId: string): boolean {
    return this.abortControllers.has(taskId);
  }

  recoverExpiredLeases(): void {
    const now = this.clock();
    for (const [taskId, task] of this.tasks) {
      if (task.status !== "RUNNING" || this.abortControllers.has(taskId)) continue;
      if (task.lease && Date.parse(task.lease.expiresAt) > now) continue;
      const recovered: AgentTask = task.attempt < task.maxAttempts
        ? { ...task, status: "READY", lease: undefined, error: "RECOVERED_EXPIRED_LEASE", updatedAt: nowIso() }
        : { ...task, status: "BLOCKED", lease: undefined, error: "LEASE_RETRY_LIMIT_REACHED", updatedAt: nowIso() };
      this.tasks.set(taskId, recovered);
      this.persist(recovered, recovered.status === "READY" ? "TASK_LEASE_RECOVERED" : "TASK_LEASE_EXHAUSTED");
    }
    void this.drain();
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

  async restore(): Promise<void> {
    if (!this.store) return;
    const [storedTasks, storedResults] = await Promise.all([
      this.store.listTasks(),
      this.store.listTaskResults(),
    ]);
    for (const value of storedResults) {
      const result = AgentTaskResultSchema.parse(value);
      for (const artifact of result.outputArtifactRefs) {
        await this.store.getArtifact(artifact.artifactId);
      }
      this.results.set(result.taskId, {
        taskId: result.taskId,
        status: result.status,
        outputArtifactRefs: result.outputArtifactRefs,
        ...(result.error ? { error: result.error } : {}),
      });
    }
    const now = this.clock();
    for (const value of storedTasks) {
      let task = AgentTaskSchema.parse(value);
      const current = this.tasks.get(task.taskId);
      if (current) continue;
      this.idempotency.set(task.idempotencyKey, task.taskId);
      if (this.results.has(task.taskId)) {
        task = { ...task, status: this.results.get(task.taskId)!.status, lease: undefined };
      } else if (task.status === "RUNNING") {
        const expired = !task.lease || Date.parse(task.lease.expiresAt) <= now;
        task = expired
          ? task.attempt < task.maxAttempts
            ? { ...task, status: "READY", lease: undefined, error: "RECOVERED_EXPIRED_LEASE", updatedAt: nowIso() }
            : { ...task, status: "BLOCKED", lease: undefined, error: "LEASE_RETRY_LIMIT_REACHED", updatedAt: nowIso() }
          : task;
      } else if (task.status === "QUEUED") {
        task = { ...task, status: "READY", updatedAt: nowIso() };
      }
      this.tasks.set(task.taskId, task);
    }
    for (const [taskId, task] of this.tasks) {
      if (task.status !== "WAITING_INPUT") continue;
      const dependencies = task.dependencyTaskIds.map((id) => this.results.get(id));
      if (dependencies.every((result) => result?.status === "SUCCEEDED")) {
        this.tasks.set(taskId, { ...task, status: "READY", updatedAt: nowIso() });
      } else if (dependencies.some((result) => result && result.status !== "SUCCEEDED")) {
        this.tasks.set(taskId, { ...task, status: "BLOCKED", error: "DEPENDENCY_FAILED", updatedAt: nowIso() });
      }
    }
    if (this.autoExecute) void this.drain();
  }

  async close(): Promise<void> {
    this.acceptingTasks = false;
    const runningTaskIds = [...this.tasks.values()]
      .filter((task) => task.status === "RUNNING")
      .map((task) => task.taskId);
    await Promise.allSettled(runningTaskIds.map((taskId) => this.await(taskId)));
    await this.flushPersistence();
  }

  private handle(taskId: string): TaskHandle {
    return { taskId, completion: this.await(taskId) };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.running < this.maxConcurrency) {
        const next = [...this.tasks.values()].find((task) =>
          task.status === "READY" &&
          (this.autoExecute || this.activatedTaskIds.has(task.taskId)) &&
          (this.runningByOrganization.get(task.organizationId) ?? 0) < this.maxConcurrencyPerOrganization
        );
        if (!next) break;
        this.running += 1;
        this.runningByOrganization.set(next.organizationId, (this.runningByOrganization.get(next.organizationId) ?? 0) + 1);
        void this.execute(next).finally(() => {
          this.running -= 1;
          const remaining = Math.max(0, (this.runningByOrganization.get(next.organizationId) ?? 1) - 1);
          if (remaining) this.runningByOrganization.set(next.organizationId, remaining);
          else this.runningByOrganization.delete(next.organizationId);
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
    const heartbeat = setInterval(() => {
      const current = this.tasks.get(task.taskId);
      if (!current || current.status !== "RUNNING" || this.abortControllers.get(task.taskId) !== controller) return;
      const heartbeatAt = new Date(this.clock()).toISOString();
      const renewed: AgentTask = {
        ...current,
        updatedAt: nowIso(),
        lease: {
          ...current.lease!,
          heartbeatAt,
          expiresAt: new Date(this.clock() + this.leaseMs).toISOString(),
        },
      };
      this.tasks.set(task.taskId, renewed);
      this.persist(renewed, "TASK_HEARTBEAT");
    }, Math.max(1_000, Math.min(30_000, Math.floor(this.leaseMs / 3))));
    heartbeat.unref();
    try {
      const output = await handler(running, {
        signal: controller.signal,
        task: running,
        assertCanWriteContentVersion: () => this.registry.assertCanWriteContentVersion(running.recipientAgentId),
      });
      if (this.results.has(task.taskId)) return;
      if (controller.signal.aborted) {
        if (this.pausedAbortIds.delete(task.taskId)) {
          return;
        }
        if (this.tasks.get(task.taskId)?.status !== "WAITING_HUMAN") {
          this.finish(running, { taskId: task.taskId, status: "CANCELLED", outputArtifactRefs: [] });
        }
      } else if (this.clock() > Date.parse(this.tasks.get(task.taskId)?.lease?.expiresAt ?? leaseExpiresAt)) {
        this.finish(running, { taskId: task.taskId, status: "EXPIRED", outputArtifactRefs: [], error: "LEASE_EXPIRED" });
      } else {
        this.finish(running, { taskId: task.taskId, status: "SUCCEEDED", outputArtifactRefs: output });
      }
    } catch (error) {
      if (this.results.has(task.taskId) || (controller.signal.aborted && this.pausedAbortIds.delete(task.taskId))) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (running.attempt < running.maxAttempts && this.isRetryableFailure(error, message)) {
        const retrying: AgentTask = {
          ...running,
          status: "READY",
          lease: undefined,
          error: `RETRYABLE:${message}`,
          updatedAt: nowIso(),
        };
        this.tasks.set(task.taskId, retrying);
        this.persist(retrying, "TASK_RETRY_SCHEDULED");
      } else {
        this.finish(running, { taskId: task.taskId, status: "FAILED", outputArtifactRefs: [], error: message });
      }
    } finally {
      clearInterval(heartbeat);
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
    if (this.store) {
      const operation = this.store.saveTaskResult(AgentTaskResultSchema.parse({
        ...result,
        completedAt: nowIso(),
      })).catch((error: unknown) => {
        this.storageError = error instanceof Error ? error : new Error(String(error));
      });
      this.persistenceQueue.push(operation.then(() => undefined));
    }
    for (const [id, dependent] of this.tasks.entries()) {
      if (dependent.status !== "WAITING_INPUT") continue;
      if (!dependent.dependencyTaskIds.includes(task.taskId)) continue;
      if (dependent.dependencyTaskIds.every((dependencyId) => this.results.get(dependencyId)?.status === "SUCCEEDED")) {
        const inherited = dependent.dependencyTaskIds.flatMap(
          (dependencyId) => this.results.get(dependencyId)?.outputArtifactRefs ?? [],
        );
        const byId = new Map(
          [...dependent.inputArtifactRefs, ...inherited].map((artifact) => [artifact.artifactId, artifact]),
        );
        const readyTask = {
          ...dependent,
          inputArtifactRefs: [...byId.values()],
          status: "READY" as const,
          updatedAt: nowIso(),
        };
        this.tasks.set(id, readyTask);
        this.persist(readyTask, "TASK_DEPENDENCIES_READY");
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

  private isRetryableFailure(error: unknown, message: string): boolean {
    if (error instanceof Error && error.name === "ZodError") return true;
    return [
      "SCHEMA_VALIDATION_FAILED",
      "PACKAGING_CANDIDATE_VALIDATION_FAILED",
      "PACKAGING_SELECTION_VALIDATION_FAILED",
      "VARIANT_CHANNEL_MISMATCH",
      "VARIANT_CHANNEL_STRUCTURE_INCOMPLETE",
      "HOST_RUNTIME_UNAVAILABLE",
      "timed out",
      "timeout",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "temporarily unavailable",
    ].some((signal) => message.toLowerCase().includes(signal.toLowerCase()));
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

export function createDefaultAgentRegistry(input: {
  rolloutModes?: Partial<Record<AgentDefinition["agentId"], AgentDefinition["rolloutMode"]>>;
} = {}): AgentRegistry {
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
    rolloutMode: "SHADOW" as const,
  };
  registry.register({
    ...base,
    agentId: "agt-004",
    version: AGT004_PROJECT_VERSION,
    role: "supervisor",
    description: "Content domain supervisor and immutable version writer",
    outputSchemas: ["content_version", "content_package"],
    allowedTools: ["host_model", "host_image", "public_read_research", "local_knowledge"],
    canWriteContentVersion: true,
    requiresHumanGate: true,
    rolloutMode: input.rolloutModes?.["agt-004"] ?? "ENFORCING",
    manifestHash: `agt-004-v${AGT004_PROJECT_VERSION}`,
  });
  registry.register({
    ...base,
    agentId: "topic-radar",
    version: AGT004_PROJECT_VERSION,
    role: "topic_radar",
    description: "Local feed topic clustering, scoring and immutable topic snapshot proposal agent",
    outputSchemas: ["topic_candidate", "topic_snapshot"],
    allowedTools: ["local_feed_runs", "local_knowledge"],
    manifestHash: `topic-radar-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.["topic-radar"] ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "public-researcher",
    version: AGT004_PROJECT_VERSION,
    role: "public_researcher",
    description: "Public read-only research and Claim-Evidence proposal agent",
    outputSchemas: ["research_pack", "evidence"],
    allowedTools: ["host_model", "public_read_research"],
    manifestHash: `public-researcher-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.["public-researcher"] ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "makabaka",
    version: AGT004_PROJECT_VERSION,
    role: "enterprise_knowledge_matcher",
    description: "Pre-draft knowledge snapshot, fusion plan and post-draft knowledge checker",
    outputSchemas: ["knowledge_snapshot", "fusion_plan", "post_draft_check"],
    allowedTools: ["host_model", "local_knowledge"],
    manifestHash: `makabaka-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.makabaka ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "content-orchestrator",
    version: AGT004_PROJECT_VERSION,
    role: "content_orchestrator",
    description: "Perspective-bound content brief, outline and draft proposal agent",
    outputSchemas: ["content_brief", "outline", "draft_proposal"],
    allowedTools: ["host_model", "research_pack", "local_knowledge"],
    manifestHash: `content-orchestrator-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.["content-orchestrator"] ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "lilith",
    version: AGT004_PROJECT_VERSION,
    role: "reviewer",
    description: "Content, logic, repetition, narrative quality, AI-style, compliance and GEO/SEO issue reviewer",
    outputSchemas: ["review_report", "review_issue"],
    allowedTools: ["host_model", "local_knowledge", "research_pack"],
    manifestHash: `lilith-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.lilith ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "xiaodiandian",
    version: AGT004_PROJECT_VERSION,
    role: "geo_seo_optimizer",
    description: "Content-only SEO/GEO optimization proposal agent",
    outputSchemas: ["geo_seo_proposal", "technical_geo_recommendation"],
    allowedTools: ["host_model", "local_knowledge", "public_read_research"],
    manifestHash: `xiaodiandian-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.xiaodiandian ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "balala",
    version: AGT004_PROJECT_VERSION,
    role: "variant_agent",
    description: "Channel variant and asset brief agent",
    outputSchemas: ["channel_variant", "asset_brief"],
    allowedTools: ["host_model", "public_read_research"],
    manifestHash: `balala-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.balala ?? base.rolloutMode,
  });
  registry.register({
    ...base,
    agentId: "packaging-copy-agent",
    version: AGT004_PROJECT_VERSION,
    role: "content_packaging_copy",
    description: "Shanshan title, hook, cover-copy, overlay-copy, tag and automatic packaging selection proposal agent",
    inputSchemas: ["packaging_brief", "content_version", "variant_proposal", "title_corpus_snapshot"],
    outputSchemas: ["title_candidate_pool", "auto_packaging_selection"],
    skills: ["title-tag-cover-generator", "huashu-video-check"],
    allowedTools: ["host_model", "local_title_corpus"],
    forbiddenTools: [
      ...base.forbiddenTools,
      "platform_publish",
      "platform_analytics",
      "platform_credentials",
      "direct_knowledge_write",
      "unrestricted_external_search",
    ],
    requiresHumanGate: false,
    manifestHash: `packaging-copy-agent-v${AGT004_PROJECT_VERSION}`,
    rolloutMode: input.rolloutModes?.["packaging-copy-agent"] ?? base.rolloutMode,
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
