import type { OutboxMessage } from "@risen/content-contracts";
import type { ContentRepository } from "@risen/content-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentProtocolDispatcher,
  canonicalJson,
  signAgentEnvelope,
  verifyAgentEnvelope,
} from "../src/agent-protocol.js";

const secret = "test-agent-protocol-secret-32-bytes-minimum";

function outboxMessage(): OutboxMessage {
  const now = new Date().toISOString();
  return {
    id: "outbox_00000001",
    organizationId: "org_00000001",
    createdBy: "user_00000001",
    traceId: "trace_00000001",
    createdAt: now,
    updatedAt: now,
    status: "PENDING",
    protocolVersion: "1.0",
    messageType: "EVIDENCE_REQUEST",
    sender: "AGT-RSN-004",
    recipient: "AGT-RSN-003",
    idempotencyKey: "evidence_request_00000001",
    payload: { nested: { z: 2, a: 1 } },
    attempts: 0,
    nextAttemptAt: now,
  };
}

function dispatcherRepository(message: OutboxMessage) {
  let saved = message;
  const repository = {
    async claimOutboxMessages() {
      return [{ ...saved, status: "PROCESSING" as const }];
    },
    async saveOutboxMessage(value: OutboxMessage) {
      saved = value;
    },
  } as unknown as ContentRepository;
  return { repository, saved: () => saved };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent protocol", () => {
  it("canonicalizes and verifies signed envelopes", () => {
    const envelope = {
      protocolVersion: "1.0" as const,
      messageId: "message_00000001",
      messageType: "REVIEW_DECISION" as const,
      sender: "AGT-RSN-006" as const,
      recipient: "AGT-RSN-004" as const,
      organizationId: "org_00000001",
      traceId: "trace_00000001",
      idempotencyKey: "decision_00000001",
      sentAt: new Date().toISOString(),
      payload: { z: 1, a: { y: 2, b: 3 } },
    };
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    const signature = signAgentEnvelope(envelope, secret);
    expect(verifyAgentEnvelope(envelope, signature, secret)).toEqual(envelope);
    expect(() =>
      verifyAgentEnvelope(envelope, "00".repeat(32), secret),
    ).toThrow("signature");
  });

  it("dispatches an outbox record with an authenticated envelope", async () => {
    const state = dispatcherRepository(outboxMessage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        const signature = new Headers(init?.headers).get("x-risen-signature");
        expect(
          verifyAgentEnvelope(envelope, String(signature), secret),
        ).toMatchObject({
          recipient: "AGT-RSN-003",
          messageType: "EVIDENCE_REQUEST",
        });
        return new Response(null, { status: 202 });
      }),
    );
    const dispatcher = new AgentProtocolDispatcher(state.repository, {
      secret,
      routes: {
        "AGT-RSN-003": "https://agents.internal/evidence-requests",
      },
      allowedHosts: ["agents.internal"],
    });
    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      dead: 0,
    });
    expect(state.saved()).toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("moves an exhausted message to the dead-letter state", async () => {
    const state = dispatcherRepository(outboxMessage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const dispatcher = new AgentProtocolDispatcher(state.repository, {
      secret,
      routes: {
        "AGT-RSN-003": "https://agents.internal/evidence-requests",
      },
      allowedHosts: ["agents.internal"],
      maxAttempts: 1,
    });
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      dead: 1,
    });
    expect(state.saved()).toMatchObject({
      status: "DEAD",
      attempts: 1,
      lastError: "Recipient returned HTTP 503",
    });
  });
});
