import {
  AgentProtocolDispatcher,
  EmbeddedContextPort,
  HostRuntimeModelAdapter,
  HttpHandoffPort,
  LocalHandoffPort,
  LocalReviewPort,
  OpaHttpPolicyPort,
  loadHostRuntime,
} from "@risen/content-adapters";
import {
  ContentService,
  createV55TeamRuntime,
  RuleBasedPolicyPort,
  V55StoreGovernanceGate,
} from "@risen/content-core";
import { PostgresAgentTaskStore, PostgresContentRepository, PostgresV55GovernanceStore } from "@risen/content-database";
import { metrics } from "@opentelemetry/api";
import { Queue, Worker } from "bullmq";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function startWorker(
  telemetry: { shutdown(): Promise<void> } | undefined,
) {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const hostRuntime = await loadHostRuntime(process.env.HOST_RUNTIME_MODULE);
  const production = process.env.NODE_ENV === "production";
  const protocolSecret = process.env.AGENT_PROTOCOL_HMAC_SECRET;
  const evidenceRequestUrl = process.env.AGT003_EVIDENCE_REQUEST_URL;
  const reviewRequestUrl = process.env.AGT006_REVIEW_REQUEST_URL;

  if (!databaseUrl || !redisUrl || !hostRuntime) {
    const message =
      "DATABASE_URL, REDIS_URL and a host-owned HOST_RUNTIME_MODULE are required";
    if (production) {
      throw new Error(`AGT-RSN-004 worker refused startup: ${message}`);
    }
    console.warn(`AGT-RSN-004 worker is disabled. ${message}.`);
    return;
  }
  if (production && !hostRuntime.healthCheck) {
    throw new Error("Production host runtime must provide healthCheck()");
  }
  await hostRuntime.healthCheck?.();

  const allowedHosts = (process.env.ALLOWED_OUTBOUND_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const repository = new PostgresContentRepository(databaseUrl);
  if (
    production &&
    (!protocolSecret || !evidenceRequestUrl || !reviewRequestUrl)
  ) {
    throw new Error(
      "Production worker requires AGENT_PROTOCOL_HMAC_SECRET, AGT003_EVIDENCE_REQUEST_URL and AGT006_REVIEW_REQUEST_URL",
    );
  }
  const hostModel = new HostRuntimeModelAdapter(hostRuntime);
  const handoff =
    process.env.HANDOFF_BASE_URL && protocolSecret
      ? new HttpHandoffPort({
          baseUrl: process.env.HANDOFF_BASE_URL,
          ...(process.env.HANDOFF_API_KEY
            ? { apiKey: process.env.HANDOFF_API_KEY }
            : {}),
          protocolSecret,
          allowedHosts,
        })
      : new LocalHandoffPort();
  if (production && !process.env.OPA_POLICY_URL) {
    throw new Error("Production worker requires OPA_POLICY_URL");
  }
  if (production && !process.env.AGT004_REPOSITORY_ROOT) {
    throw new Error("Production worker requires AGT004_REPOSITORY_ROOT for the versioned knowledge canon");
  }
  const governance = new PostgresV55GovernanceStore(databaseUrl);
  await governance.load();
  const repositoryRoot = resolve(process.env.AGT004_REPOSITORY_ROOT ?? process.cwd());
  const canonRoot = join(repositoryRoot, "knowledge", "canon", "nomos-canon-20260820-v1.0.0");
  const [claimCardsText, conflictsText, sourceManifestText] = await Promise.all([
    readFile(join(canonRoot, "claim-cards.json"), "utf8"),
    readFile(join(canonRoot, "conflicts.json"), "utf8"),
    readFile(join(repositoryRoot, "knowledge", "sources", "ingested", "nomos-canon-20260820-v1.0.0", "source_manifest.json"), "utf8"),
  ]);
  await governance.seedKnowledge(JSON.parse(claimCardsText), JSON.parse(conflictsText));
  const activeNomosSourceHashes = (
    JSON.parse(sourceManifestText).sources as Array<{ binaryHash: string }>
  ).map((source) => source.binaryHash);
  const policy = process.env.OPA_POLICY_URL
    ? new OpaHttpPolicyPort({ url: process.env.OPA_POLICY_URL })
    : new RuleBasedPolicyPort();
  const service = new ContentService({
    repository,
    hostModel,
    context: new EmbeddedContextPort(),
    policy,
    review: new LocalReviewPort(),
    handoff,
    governanceGate: new V55StoreGovernanceGate(governance, activeNomosSourceHashes),
  });
  const teamRuntime = await createV55TeamRuntime({
    workspaceRoot: repositoryRoot,
    hostModel,
    store: new PostgresAgentTaskStore(databaseUrl),
    maxConcurrency: Number.parseInt(process.env.TEAM_AGENT_CONCURRENCY ?? "2", 10),
    maxConcurrencyPerOrganization: Number.parseInt(process.env.TEAM_AGENT_ORG_CONCURRENCY ?? "8", 10),
    autoExecute: false,
    ...(process.env.PYTHON_EXECUTABLE ? { pythonExecutable: process.env.PYTHON_EXECUTABLE } : {}),
  });
  const connection = redisConnection(redisUrl);
  const worker = new Worker<{
    runId: string;
    identity: {
      organizationId: string;
      userId: string;
      role: "ADMIN" | "CREATOR" | "REVIEWER" | "VIEWER";
    };
  }>(
    "agt-rsn-004-content-runs",
    async (job) => service.executeRun(job.data.runId, job.data.identity),
    {
      connection,
      concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? "4", 10),
    },
  );
  const teamWorker = new Worker<{ runId: string; organizationId: string }>(
    "agt-rsn-004-team-runs",
    async (job) => {
      const storedRun = await teamRuntime.store.getTeamRun(job.data.runId);
      if (!storedRun || storedRun.organizationId !== job.data.organizationId) throw new Error("TEAM_RUN_NOT_FOUND");
      const missionLock = await teamRuntime.store.acquireMissionLock(storedRun.missionId, storedRun.organizationId);
      let lockFailure: Error | undefined;
      const heartbeat = setInterval(() => {
        void missionLock.renew().catch((error: unknown) => {
          lockFailure = error instanceof Error ? error : new Error(String(error));
        });
      }, 60_000);
      try {
        await teamRuntime.localRuntime.restore();
        let run = await teamRuntime.coordinator.get(job.data.runId, job.data.organizationId);
        for (let round = 0; round < 8; round += 1) {
          if (lockFailure) throw lockFailure;
          await missionLock.renew();
          teamRuntime.localRuntime.recoverExpiredLeases();
          const pending = run.taskIds
            .map((taskId) => teamRuntime.localRuntime.getTask(taskId))
            .filter((task) => !["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "EXPIRED", "WAITING_HUMAN"].includes(task.status));
          if (!pending.length) break;
          const activeForeignLease = pending.find((task) =>
            task.status === "RUNNING" && !teamRuntime.localRuntime.isLocallyExecuting(task.taskId)
          );
          if (activeForeignLease) throw new Error(`TEAM_TASK_LEASE_ACTIVE:${activeForeignLease.taskId}`);
          teamRuntime.localRuntime.activate(pending.map((task) => task.taskId));
          await Promise.all(pending.map((task) => teamRuntime.localRuntime.await(task.taskId)));
          if (lockFailure) throw lockFailure;
          run = await teamRuntime.coordinator.get(job.data.runId, job.data.organizationId);
        }
        return run;
      } finally {
        clearInterval(heartbeat);
        await missionLock.release();
      }
    },
    {
      connection,
      concurrency: Number.parseInt(process.env.TEAM_RUN_CONCURRENCY ?? "2", 10),
    },
  );

  worker.on("completed", (job) => {
    console.log(`Content run completed: ${job.id}`);
  });
  worker.on("failed", (job, error) => {
    console.error(`Content run failed: ${job?.id ?? "unknown"}`, error);
  });
  teamWorker.on("failed", (job, error) => {
    console.error(`Team run failed: ${job?.id ?? "unknown"}`, error);
  });

  const queueMonitor = new Queue("agt-rsn-004-content-runs", { connection });
  let queueCounts = { waiting: 0, delayed: 0, active: 0, failed: 0 };
  const queueGauge = metrics
    .getMeter("agt-rsn-004-worker")
    .createObservableGauge("agt004.queue.jobs");
  queueGauge.addCallback((observation) => {
    Object.entries(queueCounts).forEach(([state, value]) =>
      observation.observe(value, { state }),
    );
  });
  const updateQueueCounts = async () => {
    const counts = await queueMonitor.getJobCounts(
      "waiting",
      "delayed",
      "active",
      "failed",
    );
    queueCounts = {
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  };
  const queueMetricsTimer = setInterval(
    () => void updateQueueCounts().catch((error) =>
      console.error("Queue metrics collection failed", error),
    ),
    10_000,
  );
  void updateQueueCounts();

  const dispatcher =
    protocolSecret && (evidenceRequestUrl || reviewRequestUrl)
      ? new AgentProtocolDispatcher(repository, {
          secret: protocolSecret,
          routes: {
            ...(evidenceRequestUrl
              ? { "AGT-RSN-003": evidenceRequestUrl }
              : {}),
            ...(reviewRequestUrl
              ? { "AGT-RSN-006": reviewRequestUrl }
              : {}),
          },
          allowedHosts,
        })
      : undefined;
  let dispatching = false;
  const dispatch = async () => {
    if (!dispatcher || dispatching) return;
    dispatching = true;
    try {
      await dispatcher.dispatchBatch(
        Number.parseInt(process.env.OUTBOX_BATCH_SIZE ?? "20", 10),
      );
    } catch (error) {
      console.error("Agent protocol outbox dispatch failed", error);
    } finally {
      dispatching = false;
    }
  };
  const dispatchTimer = dispatcher
    ? setInterval(
        () => void dispatch(),
        Number.parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? "2000", 10),
      )
    : undefined;
  void dispatch();

  const shutdown = async () => {
    if (dispatchTimer) clearInterval(dispatchTimer);
    clearInterval(queueMetricsTimer);
    await worker.close();
    await teamWorker.close();
    await queueMonitor.close();
    await governance.close();
    await teamRuntime.close();
    await repository.close();
    await telemetry?.shutdown();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function redisConnection(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || "6379", 10),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1
      ? { db: Number.parseInt(url.pathname.slice(1), 10) }
      : {}),
  };
}
