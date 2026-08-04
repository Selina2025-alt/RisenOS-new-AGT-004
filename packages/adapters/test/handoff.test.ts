import type { ContentPackage } from "@risen/content-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signAgentEnvelope, verifyAgentEnvelope } from "../src/agent-protocol.js";
import { HttpHandoffPort } from "../src/handoff.js";

const secret = "handoff-protocol-secret-at-least-32-bytes";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP handoff protocol", () => {
  it("requires a signed and matching receipt from AGT-RSN-005", async () => {
    const contentPackage = {
      id: "package_00000001",
      organizationId: "org_00000001",
      traceId: "trace_00000001",
      contentHash: "1234567890abcdef1234567890abcdef",
    } as ContentPackage;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const outbound = JSON.parse(String(init?.body));
        const outboundSignature = new Headers(init?.headers).get(
          "x-risen-signature",
        );
        expect(
          verifyAgentEnvelope(outbound, String(outboundSignature), secret),
        ).toMatchObject({
          messageType: "CONTENT_PACKAGE",
          recipient: "AGT-RSN-005",
        });
        const receipt = {
          receiptId: "receipt_00000001",
          packageId: contentPackage.id,
          contentHash: contentPackage.contentHash,
          acceptedAt: new Date().toISOString(),
          receiver: "AGT-RSN-005",
        };
        const responseEnvelope = {
          protocolVersion: "1.0" as const,
          messageId: "receipt_message_00000001",
          messageType: "HANDOFF_RECEIPT" as const,
          sender: "AGT-RSN-005" as const,
          recipient: "AGT-RSN-004" as const,
          organizationId: contentPackage.organizationId,
          traceId: contentPackage.traceId,
          idempotencyKey: contentPackage.id,
          sentAt: new Date().toISOString(),
          payload: { receipt },
        };
        return new Response(JSON.stringify(responseEnvelope), {
          status: 202,
          headers: {
            "content-type": "application/json",
            "x-risen-signature": signAgentEnvelope(responseEnvelope, secret),
          },
        });
      }),
    );
    const handoff = new HttpHandoffPort({
      baseUrl: "https://agt005.internal",
      protocolSecret: secret,
      allowedHosts: ["agt005.internal"],
    });
    await expect(
      handoff.deliver(contentPackage, "AGT-RSN-005"),
    ).resolves.toMatchObject({
      packageId: contentPackage.id,
      contentHash: contentPackage.contentHash,
    });
  });
});
