/// <reference path="./sharp.d.ts" />

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type AttachmentPort,
  type GenerateObjectRequest,
  type HostImagePort,
  type HostGenerationResult,
  type HostModelPort,
  type ImageGenerationRequest,
} from "@risen/content-core";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

/**
 * Implemented by the environment that hosts AGT-RSN-004.
 *
 * Codex and JovaAI choose their own model, credentials, model version, safety
 * configuration and routing. The content agent never receives provider keys.
 */
export interface HostRuntimeExecutor {
  readonly hostId: "codex" | "jovaai" | (string & {});
  healthCheck?(): Promise<void>;
  generateObject(request: GenerateObjectRequest): Promise<HostGenerationResult>;
  generateImage?(
    request: ImageGenerationRequest,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
  prepareAttachmentUpload?(
    request: Parameters<AttachmentPort["prepareUpload"]>[0],
  ): ReturnType<AttachmentPort["prepareUpload"]>;
  scanAttachment?(
    request: Parameters<AttachmentPort["scanAndExtract"]>[0],
  ): ReturnType<AttachmentPort["scanAndExtract"]>;
}

export interface HostRuntimeModule {
  createHostRuntime:
    | (() => HostRuntimeExecutor)
    | (() => Promise<HostRuntimeExecutor>);
}

export class HostRuntimeModelAdapter implements HostModelPort {
  private readonly duration = metrics
    .getMeter("agt-rsn-004-host-runtime")
    .createHistogram("agt004.host.duration_ms", { unit: "ms" });
  private readonly tokens = metrics
    .getMeter("agt-rsn-004-host-runtime")
    .createCounter("agt004.host.tokens");
  private readonly failures = metrics
    .getMeter("agt-rsn-004-host-runtime")
    .createCounter("agt004.host.failures");

  constructor(private readonly runtime: HostRuntimeExecutor) {}

  async generateObject(
    request: GenerateObjectRequest,
  ): Promise<HostGenerationResult> {
    return trace
      .getTracer("agt-rsn-004-host-runtime")
      .startActiveSpan(
        "host.generate_object",
        {
          attributes: {
            "risen.trace_id": request.traceId,
            "risen.schema_name": request.schemaName,
            "risen.host_id": this.runtime.hostId,
          },
        },
        async (span) => {
          try {
            const controller = new AbortController();
            const abort = () => controller.abort(request.signal?.reason);
            request.signal?.addEventListener("abort", abort, { once: true });
            const timeout = setTimeout(
              () => controller.abort(new Error("Host model invocation timed out")),
              request.timeoutMs,
            );
            const result = await Promise.race([
              this.runtime.generateObject({
                ...request,
                signal: controller.signal,
              }),
              new Promise<never>((_resolve, reject) => {
                controller.signal.addEventListener(
                  "abort",
                  () =>
                    reject(
                      controller.signal.reason ??
                        new Error("Host model invocation aborted"),
                    ),
                  { once: true },
                );
              }),
            ]).finally(() => {
              clearTimeout(timeout);
              request.signal?.removeEventListener("abort", abort);
            });
            this.assertResult(result, request);
            this.duration.record(result.metadata.durationMs, {
              schema: request.schemaName,
              host: result.metadata.hostId,
              model: result.metadata.modelId,
            });
            if (result.metadata.inputTokens !== undefined) {
              this.tokens.add(result.metadata.inputTokens, {
                direction: "input",
                host: result.metadata.hostId,
                model: result.metadata.modelId,
              });
            }
            if (result.metadata.outputTokens !== undefined) {
              this.tokens.add(result.metadata.outputTokens, {
                direction: "output",
                host: result.metadata.hostId,
                model: result.metadata.modelId,
              });
            }
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            this.failures.add(1, {
              schema: request.schemaName,
              host: this.runtime.hostId,
            });
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        },
      );
  }

  private assertResult(
    result: HostGenerationResult,
    request: GenerateObjectRequest,
  ): void {
    const metadata = result?.metadata;
    if (
      !metadata ||
      result.output === undefined ||
      metadata.hostId !== this.runtime.hostId ||
      metadata.requestId !== request.requestId ||
      metadata.idempotencyKey !== request.idempotencyKey ||
      metadata.promptVersion !== request.promptVersion
    ) {
      throw new Error(
        "Host runtime returned missing or mismatched generation audit metadata",
      );
    }
  }
}

export interface HostImageStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

const IMAGE_MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

/**
 * Treat model-produced images as untrusted input. Decode and re-encode them to
 * verify the actual format, cap decompression work, auto-orient pixels and strip
 * EXIF/XMP/IPTC metadata before the bytes enter the content asset store.
 */
export async function sanitizeHostImage(
  bytes: Uint8Array,
  declaredMimeType: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error("Host image runtime returned an invalid image size");
  }
  if (!Object.values(IMAGE_MIME_BY_FORMAT).includes(
    declaredMimeType as (typeof IMAGE_MIME_BY_FORMAT)[keyof typeof IMAGE_MIME_BY_FORMAT],
  )) {
    throw new Error("Host image runtime returned an unsupported image type");
  }

  const input = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
    animated: false,
  });
  const metadata = await input.metadata();
  const actualMimeType =
    metadata.format &&
    IMAGE_MIME_BY_FORMAT[
      metadata.format as keyof typeof IMAGE_MIME_BY_FORMAT
    ];
  if (!actualMimeType || actualMimeType !== declaredMimeType) {
    throw new Error("Host image bytes do not match the declared image type");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > 10_000 ||
    metadata.height > 10_000 ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error("Host image dimensions or page count are not allowed");
  }

  const pipeline = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
    animated: false,
  }).rotate();
  const sanitized =
    metadata.format === "jpeg"
      ? await pipeline.jpeg({ quality: 92 }).toBuffer()
      : metadata.format === "webp"
        ? await pipeline.webp({ quality: 92 }).toBuffer()
        : await pipeline.png().toBuffer();
  return { bytes: sanitized, mimeType: actualMimeType };
}

/**
 * The host creates the image; this adapter only persists the returned bytes in
 * AGT-RSN-004's content asset store.
 */
export class HostRuntimeImageAdapter implements HostImagePort {
  private readonly storage: S3Client;

  constructor(
    private readonly runtime: HostRuntimeExecutor,
    private readonly options: HostImageStorageOptions,
  ) {
    if (!runtime.generateImage) {
      throw new Error(
        `Host runtime "${runtime.hostId}" does not expose image generation`,
      );
    }
    this.storage = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<{ uri: string; mimeType: string; checksum: string }> {
    const generateImage = this.runtime.generateImage;
    if (!generateImage) {
      throw new Error(
        `Host runtime "${this.runtime.hostId}" does not expose image generation`,
      );
    }
    const result = await generateImage.call(this.runtime, request);
    if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength === 0) {
      throw new Error("Host image runtime returned no image bytes");
    }
    const sanitized = await sanitizeHostImage(result.bytes, result.mimeType);
    const checksum = createHash("sha256").update(sanitized.bytes).digest("hex");
    const extension =
      sanitized.mimeType === "image/jpeg"
        ? "jpg"
        : sanitized.mimeType === "image/webp"
          ? "webp"
          : "png";
    const key = `${request.traceId}/${checksum}.${extension}`;
    await this.storage.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: sanitized.bytes,
        ContentType: sanitized.mimeType,
        Metadata: {
          traceId: request.traceId,
          checksum,
          hostId: this.runtime.hostId,
        },
      }),
    );
    return {
      uri: `s3://${this.options.bucket}/${key}`,
      mimeType: sanitized.mimeType,
      checksum,
    };
  }
}

export class HostRuntimeAttachmentAdapter implements AttachmentPort {
  constructor(private readonly runtime: HostRuntimeExecutor) {
    if (!runtime.prepareAttachmentUpload || !runtime.scanAttachment) {
      throw new Error(
        `Host runtime "${runtime.hostId}" does not expose secure attachment upload and scanning`,
      );
    }
  }

  async prepareUpload(
    request: Parameters<AttachmentPort["prepareUpload"]>[0],
  ): ReturnType<AttachmentPort["prepareUpload"]> {
    const prepare = this.runtime.prepareAttachmentUpload;
    if (!prepare) throw new Error("Host attachment upload capability is unavailable");
    const result = await prepare.call(this.runtime, request);
    const expiresAt = Date.parse(result.uploadExpiresAt);
    if (
      !result.objectKey ||
      !URL.canParse(result.uploadUrl) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw new Error("Host returned an invalid attachment upload grant");
    }
    return result;
  }

  async scanAndExtract(
    request: Parameters<AttachmentPort["scanAndExtract"]>[0],
  ): ReturnType<AttachmentPort["scanAndExtract"]> {
    const scan = this.runtime.scanAttachment;
    if (!scan) throw new Error("Host attachment scanning capability is unavailable");
    const result = await scan.call(this.runtime, request);
    if (
      !result.engine ||
      !result.signatureVersion ||
      !/^[a-f0-9]{64}$/i.test(result.observedChecksum) ||
      !Number.isInteger(result.observedByteSize) ||
      result.observedByteSize < 0
    ) {
      throw new Error("Host returned an invalid attachment scan result");
    }
    return result;
  }
}

/**
 * Loads a host-owned bridge module. A relative path is resolved from the
 * process working directory; package specifiers are passed to the JS loader.
 */
export async function loadHostRuntime(
  moduleSpecifier: string | undefined,
): Promise<HostRuntimeExecutor | undefined> {
  if (!moduleSpecifier) {
    return undefined;
  }
  const importSpecifier =
    isAbsolute(moduleSpecifier) || moduleSpecifier.startsWith(".")
      ? pathToFileURL(resolve(moduleSpecifier)).href
      : moduleSpecifier;
  const loaded = (await import(importSpecifier)) as Partial<HostRuntimeModule>;
  if (typeof loaded.createHostRuntime !== "function") {
    throw new Error(
      `Host runtime module "${moduleSpecifier}" must export createHostRuntime()`,
    );
  }
  const runtime = await loaded.createHostRuntime();
  if (!runtime?.hostId || typeof runtime.generateObject !== "function") {
    throw new Error(
      `Host runtime module "${moduleSpecifier}" returned an invalid runtime`,
    );
  }
  return runtime;
}
