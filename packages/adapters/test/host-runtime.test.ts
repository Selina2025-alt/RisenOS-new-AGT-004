import { describe, expect, it } from "vitest";
import {
  HostRuntimeModelAdapter,
  sanitizeHostImage,
  type HostRuntimeExecutor,
} from "../src/host-runtime.js";
import sharp from "sharp";

const request = {
  schemaName: "channel_variant" as const,
  systemPrompt: "test",
  input: {},
  jsonSchema: { type: "object" },
  traceId: "trace_test",
  requestId: "request_test",
  idempotencyKey: "idempotency_test",
  promptVersion: "prompt-v1",
  maxOutputTokens: 100,
  timeoutMs: 1_000,
};

describe("HostRuntimeModelAdapter", () => {
  it("accepts matching host audit metadata", async () => {
    const runtime: HostRuntimeExecutor = {
      hostId: "codex",
      async generateObject(input) {
        return {
          output: { ok: true },
          metadata: {
            hostId: "codex",
            modelId: "codex-host-model",
            modelVersion: "2026-07",
            promptVersion: input.promptVersion,
            durationMs: 2,
            safetyStatus: "PASSED",
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey,
          },
        };
      },
    };
    await expect(
      new HostRuntimeModelAdapter(runtime).generateObject(request),
    ).resolves.toMatchObject({ output: { ok: true } });
  });

  it("rejects mismatched metadata", async () => {
    const runtime: HostRuntimeExecutor = {
      hostId: "jovaai",
      async generateObject(input) {
        return {
          output: {},
          metadata: {
            hostId: "jovaai",
            modelId: "jova-host-model",
            modelVersion: "1",
            promptVersion: input.promptVersion,
            durationMs: 1,
            safetyStatus: "PASSED",
            requestId: "wrong",
            idempotencyKey: input.idempotencyKey,
          },
        };
      },
    };
    await expect(
      new HostRuntimeModelAdapter(runtime).generateObject(request),
    ).rejects.toThrow("mismatched generation audit metadata");
  });
});

describe("sanitizeHostImage", () => {
  it("verifies the declared format and strips embedded metadata", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .withExif({ IFD0: { Copyright: "must-not-survive" } })
      .png()
      .toBuffer();

    const result = await sanitizeHostImage(source, "image/png");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.mimeType).toBe("image/png");
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects a mismatch between bytes and the declared MIME type", async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    await expect(sanitizeHostImage(png, "image/jpeg")).rejects.toThrow(
      "do not match",
    );
  });
});
