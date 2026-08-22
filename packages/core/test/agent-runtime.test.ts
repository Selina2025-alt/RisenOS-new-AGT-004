import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, ArtifactRef } from "@risen/content-contracts";
import { z } from "zod";
import {
  LocalAgentRuntime,
  createAgentTask,
  createDefaultAgentRegistry,
  newTaskId,
  LocalAgentStore,
} from "../src/index.js";

const artifact = (agentId: ArtifactRef["createdByAgent"], id: string): ArtifactRef => ({
  artifactId: id,
  artifactType: "test",
  schemaVersion: "1.0",
  contentHash: "a".repeat(64),
  uri: `memory://${id}`,
  mimeType: "application/json",
  rights: "internal",
  createdByAgent: agentId,
  sourceRefs: [],
  parentArtifactIds: [],
  status: "READY",
});

function task(agentId: AgentId, key: string, dependencies: string[] = []) {
  const taskId = newTaskId();
  return createAgentTask({
    taskId,
    rootRunId: "run_test001",
    missionId: "mission_test001",
    organizationId: "org_test001",
    createdBy: "agt00400",
    traceId: "trace_test001",
    senderAgentId: "agt-004",
    recipientAgentId: agentId,
    taskType: "test",
    agentVersion: "5.5.0",
    skillSnapshot: [],
    inputArtifactRefs: [],
    outputSchema: "test",
    dependencyTaskIds: dependencies,
    priority: 50,
    maxAttempts: 2,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: key,
    approvalRequirement: "NONE",
  });
}

describe("V5.5 local agent runtime", () => {
  it("keeps only the supervisor enforcing until each subagent passes shadow rollout", () => {
    const registry = createDefaultAgentRegistry();
    expect(registry.list().map((item) => item.agentId).sort()).toEqual([
      "agt-004", "balala", "content-orchestrator", "lilith", "makabaka",
      "public-researcher", "topic-radar", "xiaodiandian",
    ]);
    expect(registry.get("agt-004").rolloutMode).toBe("ENFORCING");
    expect(registry.list().filter((item) => item.agentId !== "agt-004").every((item) => item.rolloutMode === "SHADOW")).toBe(true);
  });
  it("executes dependency tasks and joins their results", async () => {
    const registry = createDefaultAgentRegistry();
    const runtime = new LocalAgentRuntime(registry, { maxConcurrency: 2 });
    runtime.registerHandler("xiaodiandian", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);
    runtime.registerHandler("lilith", async (current) => {
      expect(current.inputArtifactRefs.some((item) => item.createdByAgent === "xiaodiandian")).toBe(true);
      return [artifact(current.recipientAgentId, `a_${current.taskId}`)];
    });

    const first = task("xiaodiandian", "idempotent_a");
    const second = task("lilith", "idempotent_b", [first.taskId]);
    const firstHandle = runtime.dispatch(first);
    const secondHandle = runtime.dispatch(second);

    expect((await firstHandle.completion).status).toBe("SUCCEEDED");
    expect((await secondHandle.completion).status).toBe("SUCCEEDED");
    expect(runtime.getTask(second.taskId).dependencyTaskIds).toContain(first.taskId);
  });

  it("deduplicates by idempotency key", async () => {
    const registry = createDefaultAgentRegistry();
    const runtime = new LocalAgentRuntime(registry);
    runtime.registerHandler("balala", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);
    const first = task("balala", "same_key");
    const duplicate = { ...first, taskId: newTaskId() };
    const a = runtime.dispatch(first);
    const b = runtime.dispatch(duplicate);
    expect(a.taskId).toBe(b.taskId);
    expect((await b.completion).status).toBe("SUCCEEDED");
  });

  it("prevents non-supervisor agents from claiming ContentVersion write permission", () => {
    const registry = createDefaultAgentRegistry();
    expect(() => registry.assertCanWriteContentVersion("lilith")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("xiaodiandian")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("balala")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("topic-radar")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("public-researcher")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("makabaka")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("content-orchestrator")).toThrow("cannot write ContentVersion");
    expect(() => registry.assertCanWriteContentVersion("agt-004")).not.toThrow();
  });

  it("persists task transitions and events to the local workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-runtime-"));
    const store = new LocalAgentStore(root);
    const runtime = new LocalAgentRuntime(createDefaultAgentRegistry(), { store });
    runtime.registerHandler("balala", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);
    const handle = runtime.dispatch(task("balala", "persisted_key"));
    expect((await handle.completion).status).toBe("SUCCEEDED");
    await runtime.flushPersistence();
    expect(runtime.storageHealth().ok).toBe(true);
    expect(await store.getTask(handle.taskId)).toBeDefined();
  });

  it("retries a structured-output failure once but does not retry policy failures", async () => {
    const runtime = new LocalAgentRuntime(createDefaultAgentRegistry());
    let schemaCalls = 0;
    runtime.registerHandler("lilith", async (current) => {
      schemaCalls += 1;
      if (schemaCalls === 1) z.object({ required: z.string() }).parse({});
      return [artifact(current.recipientAgentId, `a_${current.taskId}`)];
    });
    expect((await runtime.dispatch(task("lilith", "schema_retry_key")).completion).status).toBe("SUCCEEDED");
    expect(schemaCalls).toBe(2);

    const policyRuntime = new LocalAgentRuntime(createDefaultAgentRegistry());
    let policyCalls = 0;
    policyRuntime.registerHandler("makabaka", async () => {
      policyCalls += 1;
      throw new Error("POLICY_FAILED");
    });
    expect((await policyRuntime.dispatch(task("makabaka", "policy_no_retry_key")).completion).status).toBe("FAILED");
    expect(policyCalls).toBe(1);
  });

  it("pauses an active task without consuming its retry budget and resumes it", async () => {
    const runtime = new LocalAgentRuntime(createDefaultAgentRegistry());
    let calls = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    runtime.registerHandler("content-orchestrator", async (current, context) => {
      calls += 1;
      if (calls === 1) {
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return [artifact(current.recipientAgentId, `a_${current.taskId}`)];
    });
    const current = task("content-orchestrator", "pause_resume_key");
    const handle = runtime.dispatch(current);
    await started;
    await runtime.pause(current.taskId);
    expect(runtime.getTask(current.taskId).status).toBe("WAITING_HUMAN");
    await runtime.resume(current.taskId);
    expect((await handle.completion).status).toBe("SUCCEEDED");
    expect(calls).toBe(2);
  });

  it("rejects repository path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-path-"));
    const store = new LocalAgentStore(root);
    await expect(store.getTask("../../outside")).rejects.toThrow("escapes workspace");
  });

  it("holds a renewable per-mission lock until its owner releases it", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-lock-"));
    const firstStore = new LocalAgentStore(root);
    const secondStore = new LocalAgentStore(root);
    const lock = await firstStore.acquireMissionLock("mission_lock001", "org_lock001");
    await expect(secondStore.acquireMissionLock("mission_lock001", "org_lock001")).rejects.toThrow("already locked");
    await lock.renew();
    await lock.release();
    const next = await secondStore.acquireMissionLock("mission_lock001", "org_lock001");
    await next.release();
  });

  it("does not steal an active foreign lease and recovers it only after expiry", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-lease-"));
    const store = new LocalAgentStore(root);
    let clock = Date.now();
    const leased = {
      ...task("public-researcher", "lease_recovery_key"),
      status: "RUNNING" as const,
      attempt: 1,
      lease: {
        owner: "worker-that-crashed",
        acquiredAt: new Date(clock).toISOString(),
        heartbeatAt: new Date(clock).toISOString(),
        expiresAt: new Date(clock + 60_000).toISOString(),
      },
    };
    await store.saveTask(leased);
    const runtime = new LocalAgentRuntime(createDefaultAgentRegistry(), { store, autoExecute: false, clock: () => clock });
    runtime.registerHandler("public-researcher", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);
    await runtime.restore();
    expect(runtime.getTask(leased.taskId).status).toBe("RUNNING");
    expect(runtime.isLocallyExecuting(leased.taskId)).toBe(false);
    clock += 60_001;
    runtime.recoverExpiredLeases();
    expect(runtime.getTask(leased.taskId).status).toBe("READY");
    runtime.activate([leased.taskId]);
    expect((await runtime.await(leased.taskId)).status).toBe("SUCCEEDED");
  });
});
