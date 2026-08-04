import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { AgentCheckpoint, AgentTask, ArtifactRef } from "@risen/content-contracts";

import { sha256 } from "./utils.js";

export interface StoredArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

/** Local persistence primitives shared by the headless runtime and CLI. */
export class LocalAgentStore {
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

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    await this.atomicJson(`checkpoints/${checkpoint.id}.json`, checkpoint);
  }

  async saveArtifact(artifact: StoredArtifact): Promise<ArtifactRef> {
    const payload = JSON.stringify(artifact.payload, null, 2) + "\n";
    const payloadHash = sha256(payload);
    if (payloadHash !== artifact.ref.contentHash) {
      throw new Error(`Artifact hash mismatch for ${artifact.ref.artifactId}`);
    }
    await this.atomicText(`artifacts/${artifact.ref.artifactId}.json`, payload);
    await this.atomicJson(`artifacts/${artifact.ref.artifactId}.manifest.json`, artifact.ref);
    return artifact.ref;
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
}
