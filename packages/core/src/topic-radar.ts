import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  TopicRadarRequestSchema,
  TopicRadarResultSchema,
  type TopicRadarRequest,
  type TopicRadarResult,
} from "@risen/content-contracts";

export interface TopicRadarPort {
  run(request: TopicRadarRequest, signal?: AbortSignal): Promise<TopicRadarResult>;
}

export interface LocalTopicRadarOptions {
  workspaceRoot: string;
  pythonExecutable?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, candidate: string): string {
  const target = resolve(root, candidate);
  const pathFromRoot = relative(resolve(root), target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith("..\\") || pathFromRoot.startsWith("../") || isAbsolute(pathFromRoot)) {
    throw new Error("Topic radar output path escapes the configured workspace");
  }
  return target;
}

async function runFile(input: {
  executable: string;
  script: string;
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
  signal?: AbortSignal;
}): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile(
      input.executable,
      [input.script],
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: input.maxBuffer,
        windowsHide: true,
        shell: false,
        env: {
          PATH: process.env.PATH,
          PATHEXT: process.env.PATHEXT,
          SYSTEMROOT: process.env.SYSTEMROOT,
          WINDIR: process.env.WINDIR,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      },
      (error) => error ? reject(error) : resolvePromise(),
    );
    const abort = () => child.kill();
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("exit", () => input.signal?.removeEventListener("abort", abort));
  });
}

export class LocalTopicRadarPort implements TopicRadarPort {
  private readonly workspaceRoot: string;
  private readonly intelligenceRoot: string;
  private readonly script: string;
  private readonly pythonExecutable: string;
  private readonly timeoutMs: number;
  private readonly maxBuffer: number;

  public constructor(options: LocalTopicRadarOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.intelligenceRoot = inside(this.workspaceRoot, "intelligence");
    this.script = inside(this.workspaceRoot, "tools/build_daily_radar.py");
    this.pythonExecutable = options.pythonExecutable ?? "python";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxBuffer = options.maxBufferBytes ?? 65_536;
  }

  async run(input: TopicRadarRequest, signal?: AbortSignal): Promise<TopicRadarResult> {
    TopicRadarRequestSchema.parse(input);
    await runFile({
      executable: this.pythonExecutable,
      script: this.script,
      cwd: this.workspaceRoot,
      timeoutMs: this.timeoutMs,
      maxBuffer: this.maxBuffer,
      ...(signal ? { signal } : {}),
    });
    const latestPath = inside(this.intelligenceRoot, "topic-radar/latest.json");
    const latest = JSON.parse(await readFile(latestPath, "utf8")) as Record<string, unknown>;
    const radarId = String(latest.radarId ?? "");
    const inputHash = String(latest.inputHash ?? "").toLowerCase();
    const topicPoolPath = inside(this.intelligenceRoot, String(latest.topicPool ?? ""));
    const topicReportPath = inside(this.intelligenceRoot, String(latest.topicReport ?? ""));
    const radarDirectory = resolve(topicPoolPath, "..");
    const ready = (await readFile(inside(radarDirectory, "READY"), "utf8")).trim().toLowerCase();
    if (ready !== inputHash) throw new Error("Topic radar READY marker does not match latest inputHash");
    const [poolText, reportText] = await Promise.all([
      readFile(topicPoolPath, "utf8"),
      readFile(topicReportPath, "utf8"),
    ]);
    const pool = JSON.parse(poolText) as Record<string, unknown>;
    if (String(pool.radarId ?? "") !== radarId || String(pool.inputHash ?? "").toLowerCase() !== inputHash) {
      throw new Error("Topic radar latest and topic pool metadata do not match");
    }
    const topics = Array.isArray(pool.topics) ? pool.topics : [];
    const sourceHealth = Array.isArray(pool.sourceHealth)
      ? pool.sourceHealth.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
    return TopicRadarResultSchema.parse({
      radarId,
      inputHash,
      topicPoolArtifact: { uri: topicPoolPath, contentHash: sha256(poolText) },
      topicReportArtifact: { uri: topicReportPath, contentHash: sha256(reportText) },
      sourceHealth,
      candidateCount: topics.length,
    });
  }
}
