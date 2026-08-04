import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactRef } from "@risen/content-contracts";
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

function task(agentId: "agt-004" | "lilith" | "xiaodiandian" | "balala", key: string, dependencies: string[] = []) {
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
    agentVersion: "5.3.0",
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

describe("V5.3 local agent runtime", () => {
  it("executes dependency tasks and joins their results", async () => {
    const registry = createDefaultAgentRegistry();
    const runtime = new LocalAgentRuntime(registry, { maxConcurrency: 2 });
    runtime.registerHandler("xiaodiandian", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);
    runtime.registerHandler("lilith", async (current) => [artifact(current.recipientAgentId, `a_${current.taskId}`)]);

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

  it("rejects repository path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-path-"));
    const store = new LocalAgentStore(root);
    await expect(store.getTask("../../outside")).rejects.toThrow("escapes workspace");
  });
});
