import { describe, expect, it } from "vitest";
import {
  assertOutboundAllowed,
  containsForbiddenDeliveryFields,
} from "../src/index.js";

describe("platform network boundary", () => {
  it("blocks content publishing and monitoring hosts even if allowlisted", () => {
    expect(() =>
      assertOutboundAllowed("https://api.weixin.qq.com/cgi-bin/token", [
        "api.weixin.qq.com",
      ]),
    ).toThrow("cannot connect to content platform host");
    expect(() =>
      assertOutboundAllowed("https://api.x.com/2/tweets", ["api.x.com"]),
    ).toThrow("cannot connect to content platform host");
  });

  it("allows only explicitly allowlisted downstream hosts", () => {
    expect(
      assertOutboundAllowed("https://content-handoff.internal/v1/packages", [
        "content-handoff.internal",
      ]).hostname,
    ).toBe("content-handoff.internal");
    expect(() =>
      assertOutboundAllowed("https://unknown.example/v1", [
        "content-handoff.internal",
      ]),
    ).toThrow("not allowlisted");
  });

  it("detects forbidden platform-operation fields at any depth", () => {
    expect(
      containsForbiddenDeliveryFields({
        content: { title: "ok" },
        nested: { scheduledAt: "2030-01-01T00:00:00Z" },
      }),
    ).toEqual(["nested.scheduledAt"]);
  });
});
