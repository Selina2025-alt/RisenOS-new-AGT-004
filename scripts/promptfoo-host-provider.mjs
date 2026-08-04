import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let runtimePromise;

async function runtime() {
  if (!process.env.HOST_RUNTIME_MODULE) {
    throw new Error("HOST_RUNTIME_MODULE is required for content evaluation");
  }
  runtimePromise ??= import(
    pathToFileURL(resolve(process.env.HOST_RUNTIME_MODULE)).href
  ).then(async (module) => module.createHostRuntime());
  return runtimePromise;
}

export default class HostRuntimePromptfooProvider {
  id() {
    return "agt-rsn-004:host-runtime";
  }

  async callApi(prompt) {
    const input = JSON.parse(prompt);
    const host = await runtime();
    const requestId = `eval-${Date.now()}`;
    const generated = await host.generateObject({
      schemaName: "channel_variant",
      systemPrompt:
        "Create a content-only channel variant. Preserve the required claim ID. Return JSON only and never add platform account, publishing, scheduling, monitoring or performance fields.",
      input,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "locale", "title", "body", "summary", "claimIdsUsed"],
        properties: {
          channel: { type: "string" },
          locale: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          summary: { type: "string" },
          claimIdsUsed: { type: "array", items: { type: "string" } },
        },
      },
      traceId: requestId,
      requestId,
      idempotencyKey: `${requestId}:channel-variant`,
      promptVersion: "channel-variant-eval-v1",
      maxOutputTokens: 4_000,
      timeoutMs: 60_000,
    });
    return { output: JSON.stringify(generated.output) };
  }
}
