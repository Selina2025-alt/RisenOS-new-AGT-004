import { afterEach, describe, expect, it, vi } from "vitest";
import { OpaHttpPolicyPort } from "../src/opa-policy.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpaHttpPolicyPort", () => {
  it("parses a valid policy decision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ result: { passed: true, issues: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const port = new OpaHttpPolicyPort({ url: "http://opa.internal/v1/data" });
    await expect(
      port.check({} as never, { traceId: "trace" } as never),
    ).resolves.toEqual({ passed: true, issues: [] });
  });

  it("fails closed on an invalid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const port = new OpaHttpPolicyPort({ url: "http://opa.internal/v1/data" });
    await expect(
      port.check({} as never, { traceId: "trace" } as never),
    ).rejects.toThrow("invalid policy result");
  });
});
