import { loadHostRuntime, HostRuntimeModelAdapter } from "../packages/adapters/src/index.js";
import {
  createV55TeamRuntime,
  type TeamRuntimeBundle,
} from "../packages/core/src/index.js";
import { resolve } from "node:path";

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function bundle(command: string): Promise<TeamRuntimeBundle> {
  const root = resolve(process.env.AGT004_REPOSITORY_ROOT ?? process.cwd());
  const host = await loadHostRuntime(process.env.HOST_RUNTIME_MODULE);
  const needsExecution = ["run", "resume", "decide"].includes(command);
  if (needsExecution && !host) {
    throw new Error("This command requires the deployment host bridge (HOST_RUNTIME_MODULE); extra model APIs and fallback models are forbidden");
  }
  return createV55TeamRuntime({
    workspaceRoot: root,
    ...(process.env.V55_TEAM_STORE_ROOT ? { storeRoot: process.env.V55_TEAM_STORE_ROOT } : {}),
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
      const requestedChannels = (args[5] ?? "wechat,short_video,xiaohongshu,x,linkedin").split(",") as Array<"wechat" | "short_video" | "xiaohongshu" | "x" | "linkedin">;
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
