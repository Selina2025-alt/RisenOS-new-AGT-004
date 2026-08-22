import { appendFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type {
  AgentCheckpoint,
  AgentTask,
  AgentTaskResult,
  ArtifactRef,
  HumanGateDecision,
  TeamRun,
} from "@risen/content-contracts";

import { sha256 } from "./utils.js";

export interface StoredArtifact {
  ref: ArtifactRef;
  payload: unknown;
  organizationId?: string;
}

export interface MissionLock {
  renew(): Promise<void>;
  release(): Promise<void>;
}

export interface AgentTaskStore {
  saveTask(task: AgentTask): Promise<void>;
  getTask(taskId: string): Promise<AgentTask | undefined>;
  listTasks(): Promise<AgentTask[]>;
  saveTaskResult(result: AgentTaskResult): Promise<void>;
  getTaskResult(taskId: string): Promise<AgentTaskResult | undefined>;
  listTaskResults(): Promise<AgentTaskResult[]>;
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void>;
  listCheckpoints(): Promise<AgentCheckpoint[]>;
  saveArtifact(artifact: StoredArtifact): Promise<ArtifactRef>;
  getArtifact(artifactId: string): Promise<StoredArtifact | undefined>;
  listArtifactRefs(): Promise<ArtifactRef[]>;
  saveHumanGateDecision(decision: HumanGateDecision): Promise<void>;
  listHumanGateDecisions(runId?: string): Promise<HumanGateDecision[]>;
  saveTeamRun(run: TeamRun): Promise<void>;
  getTeamRun(runId: string): Promise<TeamRun | undefined>;
  listTeamRuns(): Promise<TeamRun[]>;
  acquireMissionLock(missionId: string, organizationId: string): Promise<MissionLock>;
  appendEvent(event: Record<string, unknown>): Promise<void>;
  close?(): Promise<void>;
}

/** Local persistence primitives shared by the headless runtime and CLI. */
export class LocalAgentStore implements AgentTaskStore {
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly resolvedRoot: string;

  public constructor(root: string) {
    this.resolvedRoot = resolve(root);
  }

  private absolute(relativePath: string): string {
    if (relativePath.includes("\0") || isAbsolute(relativePath)) {
      throw new Error("Unsafe local repository path");
    }
    const candidate = resolve(this.resolvedRoot, relativePath);
    const outside = relative(this.resolvedRoot, candidate);
    if (outside === ".." || outside.startsWith(`..${join("", "\\")}`) || isAbsolute(outside)) {
      throw new Error("Local repository path escapes workspace");
    }
    return join(this.resolvedRoot, relativePath);
  }

  async saveTask(task: AgentTask): Promise<void> {
    await this.atomicJson(`tasks/${task.taskId}.json`, task);
  }

  async getTask(taskId: string): Promise<AgentTask | undefined> {
    return this.readOptional<AgentTask>(`tasks/${taskId}.json`);
  }

  async listTasks(): Promise<AgentTask[]> {
    return this.readJsonDirectory<AgentTask>("tasks");
  }

  async saveTaskResult(result: AgentTaskResult): Promise<void> {
    const existing = await this.getTaskResult(result.taskId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(result)) {
      throw new Error(`TaskResult is immutable for ${result.taskId}`);
    }
    if (!existing) await this.atomicJson(`results/${result.taskId}.json`, result);
  }

  async getTaskResult(taskId: string): Promise<AgentTaskResult | undefined> {
    return this.readOptional<AgentTaskResult>(`results/${taskId}.json`);
  }

  async listTaskResults(): Promise<AgentTaskResult[]> {
    return this.readJsonDirectory<AgentTaskResult>("results");
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    await this.atomicJson(`checkpoints/${checkpoint.id}.json`, checkpoint);
  }

  async listCheckpoints(): Promise<AgentCheckpoint[]> {
    return this.readJsonDirectory<AgentCheckpoint>("checkpoints");
  }

  async saveHumanGateDecision(decision: HumanGateDecision): Promise<void> {
    const existing = await this.readOptional<HumanGateDecision>(`human-gates/${decision.decisionId}.json`);
    if (existing && JSON.stringify(existing) !== JSON.stringify(decision)) {
      throw new Error(`HumanGateDecision is immutable for ${decision.decisionId}`);
    }
    if (!existing) await this.atomicJson(`human-gates/${decision.decisionId}.json`, decision);
  }

  async listHumanGateDecisions(runId?: string): Promise<HumanGateDecision[]> {
    const decisions = await this.readJsonDirectory<HumanGateDecision>("human-gates");
    return runId ? decisions.filter((decision) => decision.runId === runId) : decisions;
  }

  async saveTeamRun(run: TeamRun): Promise<void> {
    await this.atomicJson(`team-runs/${run.runId}.json`, run);
  }

  async getTeamRun(runId: string): Promise<TeamRun | undefined> {
    return this.readOptional<TeamRun>(`team-runs/${runId}.json`);
  }

  async listTeamRuns(): Promise<TeamRun[]> {
    return this.readJsonDirectory<TeamRun>("team-runs");
  }

  async acquireMissionLock(missionId: string, organizationId: string): Promise<MissionLock> {
    const lockName = `${sha256(`${organizationId}:${missionId}`)}.lock`;
    const target = this.absolute(`locks/${lockName}`);
    await mkdir(dirname(target), { recursive: true });
    const existing = await this.readOptional<{ createdAt?: string }>(`locks/${lockName}`);
    if (existing?.createdAt && Date.now() - Date.parse(existing.createdAt) > 5 * 60_000) {
      await rm(target, { force: true });
    }
    const owner = randomUUID();
    try {
      const handle = await open(target, "wx");
      await handle.writeFile(JSON.stringify({ owner, pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Mission ${missionId} is already locked by another process`);
      }
      throw error;
    }
    let released = false;
    return {
      renew: async () => {
        if (released) throw new Error("Mission lock is already released");
        const current = await this.readOptional<{ owner?: string }>(`locks/${lockName}`);
        if (current?.owner !== owner) throw new Error("Mission lock ownership was lost");
        await this.atomicJson(`locks/${lockName}`, { owner, pid: process.pid, createdAt: new Date().toISOString() });
      },
      release: async () => {
        if (released) return;
        const current = await this.readOptional<{ owner?: string }>(`locks/${lockName}`);
        if (current?.owner === owner) await rm(target, { force: true });
        released = true;
      },
    };
  }

  async saveArtifact(artifact: StoredArtifact): Promise<ArtifactRef> {
    const payload = JSON.stringify(artifact.payload, null, 2) + "\n";
    const payloadHash = sha256(payload);
    if (payloadHash !== artifact.ref.contentHash) {
      throw new Error(`Artifact hash mismatch for ${artifact.ref.artifactId}`);
    }
    await this.atomicText(`artifacts/${artifact.ref.artifactId}.json`, payload);
    if (artifact.organizationId) {
      await this.atomicJson(`artifacts/${artifact.ref.artifactId}.organization.json`, {
        organizationId: artifact.organizationId,
      });
    }
    // Manifest is the readiness marker and must be committed last.
    await this.atomicJson(`artifacts/${artifact.ref.artifactId}.manifest.json`, artifact.ref);
    return artifact.ref;
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact | undefined> {
    const ref = await this.readOptional<ArtifactRef>(`artifacts/${artifactId}.manifest.json`);
    if (!ref) return undefined;
    const payload = await this.readOptional<unknown>(`artifacts/${artifactId}.json`);
    if (payload === undefined) throw new Error(`Artifact payload is missing for ${artifactId}`);
    const canonical = JSON.stringify(payload, null, 2) + "\n";
    if (sha256(canonical) !== ref.contentHash) throw new Error(`Artifact hash mismatch for ${artifactId}`);
    const ownership = await this.readOptional<{ organizationId?: string }>(`artifacts/${artifactId}.organization.json`);
    return { ref, payload, ...(ownership?.organizationId ? { organizationId: ownership.organizationId } : {}) };
  }

  async listArtifactRefs(): Promise<ArtifactRef[]> {
    const directory = this.absolute("artifacts");
    try {
      const names = (await readdir(directory))
        .filter((name) => name.endsWith(".manifest.json"))
        .sort();
      const refs: ArtifactRef[] = [];
      for (const name of names) {
        const ref = await this.readOptional<ArtifactRef>(`artifacts/${name}`);
        if (ref) refs.push(ref);
      }
      return refs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async appendEvent(event: Record<string, unknown>): Promise<void> {
    const target = this.absolute("events/events.jsonl");
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, JSON.stringify(event) + "\n", "utf8");
  }

  private async atomicJson(relative: string, value: unknown): Promise<void> {
    await this.atomicText(relative, JSON.stringify(value, null, 2) + "\n");
  }

  private async atomicText(relative: string, value: string): Promise<void> {
    const target = this.absolute(relative);
    const previous = this.writeQueues.get(target) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, value, "utf8");
      // Windows does not replace an existing file with rename(). Prefer the
      // atomic path; the fallback preserves the existing target and is still
      // serialized per target, avoiding a destructive delete window.
      try {
        await rename(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await writeFile(target, value, "utf8");
        await rm(temporary, { force: true });
      }
    });
    this.writeQueues.set(target, operation);
    try {
      await operation;
    } finally {
      if (this.writeQueues.get(target) === operation) this.writeQueues.delete(target);
    }
  }

  private async readOptional<T>(relative: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.absolute(relative), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readJsonDirectory<T>(relativeDirectory: string): Promise<T[]> {
    const directory = this.absolute(relativeDirectory);
    try {
      const names = (await readdir(directory))
        .filter((name) => name.endsWith(".json") && !name.endsWith(".manifest.json"))
        .sort();
      const values: T[] = [];
      for (const name of names) {
        const value = await this.readOptional<T>(`${relativeDirectory}/${name}`);
        if (value !== undefined) values.push(value);
      }
      return values;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
