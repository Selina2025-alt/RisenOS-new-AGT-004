import { loadHostRuntime, HostRuntimeModelAdapter } from "../packages/adapters/src/index.js";
import {
  createV56TeamRuntime,
  renderPackagingReviewBook,
  type TeamRuntimeBundle,
} from "../packages/core/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PackagingFeedbackInputSchema, PackagingOverrideInputSchema, type PackagingChannel } from "../packages/contracts/src/index.js";

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function teamStoreRoot(): string {
  const root = resolve(process.env.AGT004_REPOSITORY_ROOT ?? process.cwd());
  return resolve(process.env.V56_TEAM_STORE_ROOT ?? process.env.V55_TEAM_STORE_ROOT ?? join(root, ".runtime", "v5.6", "team"));
}

async function writePackagingReviewBook(runId: string, organizationId: string, markdown: string): Promise<string> {
  const safeRunDirectory = createHash("sha256").update(`${organizationId}:${runId}`).digest("hex").slice(0, 24);
  const target = join(teamStoreRoot(), "review-books", safeRunDirectory, "PACKAGING-REVIEW-BOOK.md");
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, markdown, "utf8");
  try {
    await rename(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await writeFile(target, markdown, "utf8");
    await rm(temporary, { force: true });
  }
  return target;
}

async function bundle(command: string): Promise<TeamRuntimeBundle> {
  const root = resolve(process.env.AGT004_REPOSITORY_ROOT ?? process.cwd());
  const host = await loadHostRuntime(process.env.HOST_RUNTIME_MODULE);
  const needsExecution = ["run", "resume", "decide", "generate-packaging", "packaging-regenerate"].includes(command);
  if (needsExecution && !host) {
    throw new Error("This command requires the deployment host bridge (HOST_RUNTIME_MODULE); extra model APIs and fallback models are forbidden");
  }
  return createV56TeamRuntime({
    workspaceRoot: root,
    ...((process.env.V56_TEAM_STORE_ROOT ?? process.env.V55_TEAM_STORE_ROOT)
      ? { storeRoot: (process.env.V56_TEAM_STORE_ROOT ?? process.env.V55_TEAM_STORE_ROOT)! }
      : {}),
    ...(host ? { hostModel: new HostRuntimeModelAdapter(host) } : {}),
    autoExecute: needsExecution,
  });
}

async function main(): Promise<void> {
  const [command = "health", ...args] = process.argv.slice(2);
  const team = await bundle(command);
  try {
    if (command === "health" || command === "validate") {
      console.log(JSON.stringify(await team.health(), null, 2));
      return;
    }
    const runId = required(args[0], "runId");
    const organizationId = required(args[1], "organizationId");
    if (command === "show") console.log(JSON.stringify(await team.coordinator.get(runId, organizationId), null, 2));
    else if (command === "show-packaging") console.log(JSON.stringify(await team.coordinator.packaging(runId, organizationId), null, 2));
    else if (command === "show-packaging-book") {
      const markdown = renderPackagingReviewBook(await team.coordinator.packaging(runId, organizationId));
      const outputPath = await writePackagingReviewBook(runId, organizationId, markdown);
      console.log(markdown);
      console.error(`PACKAGING-REVIEW-BOOK.md: ${outputPath}`);
    }
    else if (command === "generate-packaging" || command === "packaging-regenerate") {
      const researchMode = args[2] === "PUBLIC_PATTERN_PACK" ? "PUBLIC_PATTERN_PACK" : "LOCAL_CORPUS";
      console.log(JSON.stringify(await team.coordinator.regeneratePackaging(runId, organizationId, researchMode), null, 2));
    }
    else if (command === "packaging-feedback") {
      const filePath = required(args[2], "feedback JSON path");
      const userId = required(args[3], "userId");
      const body = PackagingFeedbackInputSchema.parse({ ...JSON.parse(await readFile(resolve(filePath), "utf8")), runId });
      console.log(JSON.stringify(await team.coordinator.submitPackagingFeedback(body, { organizationId, userId }), null, 2));
    }
    else if (command === "packaging-override") {
      const filePath = required(args[2], "override JSON path");
      const userId = required(args[3], "userId");
      const body = PackagingOverrideInputSchema.parse({ ...JSON.parse(await readFile(resolve(filePath), "utf8")), runId });
      console.log(JSON.stringify(await team.coordinator.submitPackagingOverride(body, { organizationId, userId }), null, 2));
    }
    else if (command === "pause") console.log(JSON.stringify(await team.coordinator.pause(runId, organizationId), null, 2));
    else if (command === "resume") console.log(JSON.stringify(await team.coordinator.resume(runId, organizationId), null, 2));
    else if (command === "cancel") console.log(JSON.stringify(await team.coordinator.cancel(runId, organizationId), null, 2));
    else if (command === "decide") {
      const [artifactId, artifactHash, gate, decision, userId, idempotencyKey] = args.slice(2);
      const result = await team.coordinator.decide({
        runId,
        artifactId: required(artifactId, "artifactId"),
        artifactHash: required(artifactHash, "artifactHash"),
        gate: required(gate, "gate") as "PERSPECTIVE_CONFIRMED" | "SOURCE_DRAFT_APPROVED" | "FINAL_VARIANTS_APPROVED" | "KNOWLEDGE_CONFLICT_DECIDED",
        decision: required(decision, "decision") as "APPROVED" | "REJECTED",
        idempotencyKey: required(idempotencyKey, "idempotencyKey"),
      }, { organizationId, userId: required(userId, "userId") });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "run") {
      const traceId = required(args[2], "traceId");
      const createdBy = required(args[3], "createdBy");
      const sourceArtifactIds = required(args[4], "comma-separated sourceArtifactIds").split(",").filter(Boolean);
      const requestedChannels = (args[5] ?? "wechat,short_video,xiaohongshu,x,linkedin,youtube,podcast").split(",") as PackagingChannel[];
      const run = await team.coordinator.start({
        missionId: runId,
        organizationId,
        traceId,
        createdBy,
        sourceArtifactIds,
        requestedChannels,
        requiresPublicResearch: true,
        requiresEnterpriseKnowledge: true,
      });
      console.log(JSON.stringify(run, null, 2));
    } else {
      throw new Error(`Unknown command ${command}`);
    }
  } finally {
    await team.close();
  }
}

await main();
