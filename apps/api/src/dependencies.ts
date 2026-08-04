import {
  EmbeddedContextPort,
  HostRuntimeImageAdapter,
  HostRuntimeAttachmentAdapter,
  HostRuntimeModelAdapter,
  HttpHandoffPort,
  LocalHandoffPort,
  LocalReviewPort,
  OpaHttpPolicyPort,
  loadHostRuntime,
  type HostRuntimeExecutor,
} from "@risen/content-adapters";
import type {
  ContentRepository,
  HostGenerationResult,
  HostModelPort,
} from "@risen/content-core";
import {
  ContentService,
  InMemoryContentRepository,
  RuleBasedPolicyPort,
} from "@risen/content-core";
import { PostgresContentRepository } from "@risen/content-database";
import { Queue } from "bullmq";

class UnavailableHostModelPort implements HostModelPort {
  async generateObject(): Promise<HostGenerationResult> {
    throw new Error(
      "The deployment host has not attached its model runtime. Configure HOST_RUNTIME_MODULE or inject HostRuntimeExecutor; prototype fallback is forbidden.",
    );
  }
}

export interface DependencyOptions {
  hostRuntime?: HostRuntimeExecutor;
}

export interface DependencyContainer {
  service: ContentService;
  repository: ContentRepository;
  enqueueRun?: (
    runId: string,
    identity: {
      organizationId: string;
      userId: string;
      role: "ADMIN" | "CREATOR" | "REVIEWER" | "VIEWER";
    },
  ) => Promise<void>;
  cancelRunJobs?: (runIds: string[]) => Promise<void>;
  ready(): Promise<{ database: "ok"; queue: "ok" | "disabled" }>;
  close(): Promise<void>;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createDependencies(
  options: DependencyOptions = {},
): Promise<DependencyContainer> {
  const production = process.env.NODE_ENV === "production";
  const databaseUrl = process.env.DATABASE_URL;
  const usePostgres = process.env.REPOSITORY_DRIVER === "postgres" || production;

  if (usePostgres && !databaseUrl) {
    throw new Error("Production/PostgreSQL mode requires DATABASE_URL");
  }
  if (production && !process.env.IDENTITY_HMAC_SECRET) {
    throw new Error("Production mode requires IDENTITY_HMAC_SECRET");
  }
  if (production && !process.env.AGENT_PROTOCOL_HMAC_SECRET) {
    throw new Error("Production mode requires AGENT_PROTOCOL_HMAC_SECRET");
  }
  const repository: ContentRepository =
    usePostgres && databaseUrl
      ? new PostgresContentRepository(databaseUrl)
      : new InMemoryContentRepository();

  const allowedHosts = csv(process.env.ALLOWED_OUTBOUND_HOSTS);
  const hostRuntime =
    options.hostRuntime ??
    (await loadHostRuntime(process.env.HOST_RUNTIME_MODULE));
  const hostModel: HostModelPort = hostRuntime
    ? new HostRuntimeModelAdapter(hostRuntime)
    : new UnavailableHostModelPort();

  if (production && hostModel instanceof UnavailableHostModelPort) {
    throw new Error(
      "Production mode requires a host-owned model bridge via HOST_RUNTIME_MODULE or dependency injection",
    );
  }
  if (production && !hostRuntime?.healthCheck) {
    throw new Error(
      "Production host runtime must provide healthCheck() for readiness verification",
    );
  }

  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET;
  const s3AccessKey = process.env.S3_ACCESS_KEY;
  const s3SecretKey = process.env.S3_SECRET_KEY;
  const image =
    hostRuntime?.generateImage &&
    s3Endpoint &&
    s3Bucket &&
    s3AccessKey &&
    s3SecretKey
      ? new HostRuntimeImageAdapter(hostRuntime, {
            endpoint: s3Endpoint,
            region: process.env.S3_REGION ?? "us-east-1",
            bucket: s3Bucket,
            accessKeyId: s3AccessKey,
            secretAccessKey: s3SecretKey,
        })
      : undefined;
  const attachments =
    hostRuntime?.prepareAttachmentUpload && hostRuntime.scanAttachment
      ? new HostRuntimeAttachmentAdapter(hostRuntime)
      : undefined;
  if (production && hostRuntime?.generateImage && !image) {
    throw new Error(
      "Production host image capability requires complete S3 storage configuration",
    );
  }
  if (production && !attachments) {
    throw new Error(
      "Production host runtime must provide secure attachment upload, malware scanning and text extraction",
    );
  }

  const handoffBaseUrl = process.env.HANDOFF_BASE_URL;
  const handoffApiKey = process.env.HANDOFF_API_KEY;
  const protocolSecret = process.env.AGENT_PROTOCOL_HMAC_SECRET;
  if (production && (!handoffBaseUrl || !protocolSecret)) {
    throw new Error(
      "Production mode requires a real HandoffPort; LocalHandoffPort cannot mark content delivered",
    );
  }
  const handoff =
    handoffBaseUrl && protocolSecret
      ? new HttpHandoffPort({
          baseUrl: handoffBaseUrl,
          ...(handoffApiKey ? { apiKey: handoffApiKey } : {}),
          protocolSecret,
          allowedHosts,
        })
      : new LocalHandoffPort();

  const opaPolicyUrl = process.env.OPA_POLICY_URL;
  if (production && !opaPolicyUrl) {
    throw new Error("Production mode requires OPA_POLICY_URL");
  }
  const policy = opaPolicyUrl
    ? new OpaHttpPolicyPort({ url: opaPolicyUrl })
    : new RuleBasedPolicyPort();
  const review = new LocalReviewPort();

  const service = new ContentService({
    repository,
    hostModel,
    context: new EmbeddedContextPort(),
    policy,
    review,
    handoff,
    ...(image ? { hostImage: image } : {}),
    ...(attachments ? { attachments } : {}),
  });

  const redisUrl = process.env.REDIS_URL;
  if (production && !redisUrl) {
    throw new Error("Production mode requires REDIS_URL");
  }
  const queue = redisUrl
    ? new Queue("agt-rsn-004-content-runs", {
        connection: redisConnection(redisUrl),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      })
    : undefined;

  return {
    service,
    repository,
    ...(queue
      ? {
          enqueueRun: async (
            runId: string,
            identity: {
              organizationId: string;
              userId: string;
              role: "ADMIN" | "CREATOR" | "REVIEWER" | "VIEWER";
            },
          ) => {
            await queue.add(
              "execute-content-run",
              { runId, identity },
              { jobId: runId },
            );
          },
          cancelRunJobs: async (runIds: string[]) => {
            await Promise.all(
              runIds.map(async (runId) => {
                const job = await queue.getJob(runId);
                if (job) await job.remove();
              }),
            );
          },
        }
      : {}),
    async ready() {
      await repository.healthCheck();
      if (queue) await queue.waitUntilReady();
      await hostRuntime?.healthCheck?.();
      return {
        database: "ok",
        queue: queue ? "ok" : "disabled",
      };
    },
    async close() {
      await queue?.close();
      if (repository instanceof PostgresContentRepository) {
        await repository.close();
      }
    },
  };
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
