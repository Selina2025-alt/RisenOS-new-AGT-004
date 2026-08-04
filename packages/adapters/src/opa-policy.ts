import type {
  PolicyCheckResult,
  PolicyPort,
} from "@risen/content-core";
import { protectSensitiveData } from "@risen/content-core";
import type {
  ContentMission,
  ContentVersion,
} from "@risen/content-contracts";

export interface OpaPolicyOptions {
  url: string;
  timeoutMs?: number;
}

/** Executes brand and content policy in OPA. Failure is fail-closed. */
export class OpaHttpPolicyPort implements PolicyPort {
  constructor(private readonly options: OpaPolicyOptions) {}

  async check(
    mission: ContentMission,
    version: ContentVersion,
  ): Promise<PolicyCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 5_000,
    );
    try {
      const protectedInput = protectSensitiveData({ mission, version });
      if (protectedInput.blocked) {
        throw new Error("OPA input contains blocked sensitive data");
      }
      const response = await fetch(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": version.traceId,
        },
        body: JSON.stringify({ input: protectedInput.sanitized }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OPA policy request failed with ${response.status}`);
      }
      const payload = (await response.json()) as {
        result?: PolicyCheckResult;
      };
      if (
        !payload.result ||
        typeof payload.result.passed !== "boolean" ||
        !Array.isArray(payload.result.issues)
      ) {
        throw new Error("OPA returned an invalid policy result");
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
