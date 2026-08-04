import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./utils.js";

export class LocalFileStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  private path(relativePath: string): string {
    if (relativePath.includes("\0") || isAbsolute(relativePath)) throw new Error("Unsafe local repository path");
    const candidate = resolve(this.root, relativePath);
    const outside = relative(this.root, candidate);
    if (outside === ".." || outside.startsWith(`..${join("", "\\")}`) || isAbsolute(outside)) {
      throw new Error("Local repository path escapes workspace");
    }
    return join(this.root, relativePath);
  }

  public async writeJson(relative: string, value: unknown): Promise<{ path: string; contentHash: string }> {
    const target = this.path(relative);
    await mkdir(dirname(target), { recursive: true });
    const serialized = JSON.stringify(value, null, 2) + "\n";
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, serialized, "utf8");
    try {
      await rename(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await writeFile(target, serialized, "utf8");
      await rm(temporary, { force: true });
    }
    return { path: target, contentHash: sha256(serialized) };
  }

  public async readJson<T>(relative: string): Promise<T> {
    return JSON.parse(await readFile(this.path(relative), "utf8")) as T;
  }

  public async writeImmutableVersion(relative: string, value: Record<string, unknown>): Promise<{ path: string; contentHash: string }> {
    const serialized = JSON.stringify(value, null, 2) + "\n";
    const hash = sha256(serialized);
    const target = relative.replace(/\.json$/i, `.${hash.slice(0, 12)}.json`);
    return this.writeJson(target, { ...value, contentHash: hash });
  }

  public async appendAudit(event: Record<string, unknown>): Promise<void> {
    const target = this.path("audit/events.jsonl");
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, JSON.stringify(event) + "\n", "utf8");
  }
}
