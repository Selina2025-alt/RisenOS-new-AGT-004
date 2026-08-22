import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertEnforcingHandlersRegistered,
  createDefaultAgentRegistry,
  createV55TeamRuntime,
} from "../src/index.js";

describe("V5.5.1 team runtime bootstrap", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("registers all seven handlers while keeping them in shadow rollout", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-team-"));
    roots.push(root);
    const bundle = await createV55TeamRuntime({
      workspaceRoot: root,
      registryManifestPath: false,
      topicRadar: { async run() { throw new Error("not invoked"); } },
    });
    const health = await bundle.health();
    expect(health.status).toBe("DEGRADED");
    expect(health.registeredHandlers).toHaveLength(7);
    expect(health.shadowAgents).toHaveLength(7);
    expect(health.enforcingAgents).toEqual([]);
    expect(health.hostModelAvailable).toBe(false);
    await bundle.close();
  });

  it("fails closed when an enforcing child role has no handler", () => {
    const registry = createDefaultAgentRegistry({ rolloutModes: { lilith: "ENFORCING" } });
    expect(() => assertEnforcingHandlersRegistered(registry, ["topic-radar"]))
      .toThrow("missing enforcing handlers lilith");
  });

  it("requires a versioned human approval before manifest rollout can enforce a child", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-rollout-"));
    roots.push(root);
    const source = JSON.parse(await readFile(new URL("../../../agents/registry.v5.5.json", import.meta.url), "utf8")) as { agents: Array<Record<string, unknown>> };
    const lilith = source.agents.find((agent) => agent.agentId === "lilith")!;
    lilith.rolloutMode = "ENFORCING";
    const manifest = join(root, "registry.json");
    await writeFile(manifest, JSON.stringify(source), "utf8");
    await expect(createV55TeamRuntime({ workspaceRoot: root, registryManifestPath: manifest }))
      .rejects.toThrow("without versioned human rollout approval");

    lilith.rolloutApprovedBy = "user_enterprise_reviewer";
    lilith.rolloutApprovedAt = new Date().toISOString();
    await writeFile(manifest, JSON.stringify(source), "utf8");
    const bundle = await createV55TeamRuntime({
      workspaceRoot: root,
      registryManifestPath: manifest,
      topicRadar: { async run() { throw new Error("not invoked"); } },
    });
    expect((await bundle.health()).enforcingAgents).toContain("lilith");
    await bundle.close();
  });
});
