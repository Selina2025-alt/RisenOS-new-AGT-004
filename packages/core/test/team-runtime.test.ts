import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertEnforcingHandlersRegistered,
  createDefaultAgentRegistry,
  createV56TeamRuntime,
} from "../src/index.js";

describe("V5.6.0 team runtime bootstrap", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("registers all eight handlers while keeping them in shadow rollout", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-team-"));
    roots.push(root);
    const bundle = await createV56TeamRuntime({
      workspaceRoot: root,
      registryManifestPath: false,
      topicRadar: { async run() { throw new Error("not invoked"); } },
    });
    const health = await bundle.health();
    expect(health.status).toBe("DEGRADED");
    expect(health.registeredHandlers).toHaveLength(8);
    expect(health.registeredHandlers).toContain("packaging-copy-agent");
    expect(health.shadowAgents).toHaveLength(8);
    expect(health.enforcingAgents).toEqual([]);
    expect(health.hostModelAvailable).toBe(false);
    await bundle.close();
  });

  it("loads the sanitized local title corpus only when the full knowledge pack is present", async () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "agt004-title-store-"));
    roots.push(root);
    const bundle = await createV56TeamRuntime({
      workspaceRoot: repositoryRoot,
      storeRoot: root,
      registryManifestPath: false,
      hostModel: { async generateObject() { throw new Error("not invoked"); } },
      topicRadar: { async run() { throw new Error("not invoked"); } },
    });
    const health = await bundle.health();
    expect(health.status).toBe("READY");
    expect(health.titleCorpusAvailable).toBe(true);
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
    const source = JSON.parse(await readFile(new URL("../../../agents/registry.v5.6.json", import.meta.url), "utf8")) as { agents: Array<Record<string, unknown>> };
    const lilith = source.agents.find((agent) => agent.agentId === "lilith")!;
    lilith.rolloutMode = "ENFORCING";
    const manifest = join(root, "registry.json");
    await writeFile(manifest, JSON.stringify(source), "utf8");
    await expect(createV56TeamRuntime({ workspaceRoot: root, registryManifestPath: manifest }))
      .rejects.toThrow("without versioned human rollout approval");

    lilith.rolloutApprovedBy = "user_enterprise_reviewer";
    lilith.rolloutApprovedAt = new Date().toISOString();
    await writeFile(manifest, JSON.stringify(source), "utf8");
    const bundle = await createV56TeamRuntime({
      workspaceRoot: root,
      registryManifestPath: manifest,
      topicRadar: { async run() { throw new Error("not invoked"); } },
    });
    expect((await bundle.health()).enforcingAgents).toContain("lilith");
    await bundle.close();
  });

  it("refuses startup when Shanshan's declared capability boundary differs from runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "agt004-packaging-permission-"));
    roots.push(root);
    const source = JSON.parse(await readFile(new URL("../../../agents/registry.v5.6.json", import.meta.url), "utf8")) as { agents: Array<Record<string, unknown>> };
    const shanshan = source.agents.find((agent) => agent.agentId === "packaging-copy-agent")!;
    shanshan.forbiddenTools = ["platform_publish"];
    const manifest = join(root, "registry.json");
    await writeFile(manifest, JSON.stringify(source), "utf8");
    await expect(createV56TeamRuntime({ workspaceRoot: root, registryManifestPath: manifest }))
      .rejects.toThrow("differs from runtime for packaging-copy-agent");
  });
});
